import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

/**
 * Single shared pool, created LAZILY on first query.
 *
 * Lazy matters: `next build` imports every route module, and a build must
 * succeed on a machine with no DATABASE_URL at all (plan §4.5). Creating the
 * pool at import time turns a missing env var into a failed build.
 *
 * Hostinger's MySQL caps concurrent connections per user, so `connectionLimit`
 * stays small; `timezone: "Z"` makes every datetime we read and write UTC,
 * which the whole availability engine depends on.
 */
const globalForDb = globalThis as unknown as {
  __alquilarPool?: mysql.Pool;
  __alquilarDb?: MySql2Database<typeof schema>;
};

export function getPool(): mysql.Pool {
  if (globalForDb.__alquilarPool) return globalForDb.__alquilarPool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  globalForDb.__alquilarPool = mysql.createPool({
    uri: url,
    connectionLimit: 8,
    timezone: "Z",
    enableKeepAlive: true,
  });
  return globalForDb.__alquilarPool;
}

export function getDb(): MySql2Database<typeof schema> {
  if (!globalForDb.__alquilarDb) {
    globalForDb.__alquilarDb = drizzle(getPool(), { schema, mode: "default" });
  }
  return globalForDb.__alquilarDb;
}

/** Close the pool if one was ever opened — safe to call from a script's finally. */
export async function closePool(): Promise<void> {
  const existing = globalForDb.__alquilarPool;
  if (!existing) return;
  globalForDb.__alquilarPool = undefined;
  globalForDb.__alquilarDb = undefined;
  await existing.end();
}

function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop, receiver) {
      const instance = resolve();
      const value = Reflect.get(instance as object, prop, receiver);
      return typeof value === "function" ? value.bind(instance) : value;
    },
    has: (_target, prop) => prop in (resolve() as object),
  });
}

export const db: MySql2Database<typeof schema> = lazyProxy(getDb);
export const pool: mysql.Pool = lazyProxy(getPool);
export { schema };
