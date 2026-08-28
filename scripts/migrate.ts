/**
 * Apply pending Drizzle migrations. Run with `npm run db:migrate`.
 * tsx does NOT auto-load .env — `dotenv/config` at the top is load-bearing
 * (see the nextjs-deploy-hostinger skill's tsx gotcha).
 */
import "dotenv/config";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { closePool, db } from "../src/db";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env first.");
  }
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
