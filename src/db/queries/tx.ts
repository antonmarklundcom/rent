/**
 * One transaction, one connection.
 *
 * Phase O-3 composes O-2's engines: recording a return inspection can open a
 * maintenance ticket, which creates an expense, and can deduct a deposit — all
 * of which must commit or roll back together. Every such function therefore
 * takes an OPTIONAL executor: given one it joins the caller's transaction,
 * given none it opens its own.
 *
 * Calling `db.transaction()` from inside another transaction would check out a
 * SECOND pooled connection and wait on locks the first one holds — a deadlock
 * against ourselves. This helper is what keeps that from happening.
 */
import { db } from "@/db";
import type { Executor } from "@/db/queries/availability";

export async function inTransaction<T>(
  executor: Executor | undefined | null,
  fn: (tx: Executor) => Promise<T>,
): Promise<T> {
  if (executor) return fn(executor);
  return db.transaction(async (tx) => fn(tx));
}
