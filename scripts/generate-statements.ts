/**
 * Monthly owner statements (#3, plan §5.O7) — idempotent, cron-ready.
 *
 *   npm run statements                  # previous month, every active owner
 *   npm run statements -- 2026-07       # that period, every active owner
 *   npm run statements -- 2026-07 3     # that period, owner id 3 only
 *
 * Runs on the 1st of each month. Re-running any period is safe and produces
 * byte-identical totals: see the idempotency note in
 * `src/db/queries/statements.ts`.
 */
import "dotenv/config";
import { asc } from "drizzle-orm";
import { closePool, db } from "../src/db";
import { owners } from "../src/db/schema";
import { generateStatement, ownersWithActivity } from "../src/db/queries/statements";
import { formatMoney } from "../src/lib/money";

/** `YYYY-MM` of the month before `reference`. */
export function previousPeriod(reference: Date = new Date()): string {
  const d = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - 1, 1),
  );
  return d.toISOString().slice(0, 7);
}

async function main() {
  const periodArg = process.argv[2];
  const ownerArg = process.argv[3];
  const period = periodArg && /^\d{4}-\d{2}$/.test(periodArg) ? periodArg : previousPeriod();

  let ownerIds: number[];
  if (ownerArg) {
    ownerIds = [Number.parseInt(ownerArg, 10)];
  } else {
    const active = await ownersWithActivity(period);
    if (active.length > 0) {
      ownerIds = active;
    } else {
      // No activity at all — still issue zeroed statements so every owner has
      // a document for the month rather than a silent gap.
      const all = await db.select({ id: owners.id }).from(owners).orderBy(asc(owners.id));
      ownerIds = all.map((row) => row.id);
    }
  }

  console.log(`Generando estados de cuenta para ${period} (${ownerIds.length} propietario/s)…`);
  let failures = 0;
  for (const ownerId of ownerIds) {
    try {
      const detail = await generateStatement(ownerId, period);
      const s = detail.statement;
      console.log(
        `  ${detail.owner.displayName.padEnd(20)} ` +
          `bruto ${formatMoney(s.grossTotal, s.currency)} · ` +
          `comisión ${formatMoney(s.commissionTotal, s.currency)} · ` +
          `gastos ${formatMoney(s.expensesTotal, s.currency)} · ` +
          `NETO ${formatMoney(s.netTotal, s.currency)} ` +
          `(${s.bookingCount} reserva/s)`,
      );
    } catch (error) {
      failures += 1;
      console.error(
        `  propietario ${ownerId}: ERROR — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
