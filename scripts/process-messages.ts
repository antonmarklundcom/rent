import "dotenv/config";
/**
 * Flip queued messages to `due` (plan §5.O9, feature #4).
 *
 * This is the ONLY thing the cron does — it does not send anything (plan §1.5).
 * A message becoming `due` means "a human should send this now"; the admin
 * outbox at `/admin/mensajes` is where that happens.
 *
 *   npm run messages            # process everything due as of now
 *   npm run messages -- --dry   # report what would flip, change nothing
 *
 * Suggested cron: every 15 minutes. Re-running is always safe: the update is
 * conditional on `status = 'scheduled'`, so two overlapping runs cannot both
 * claim a row and a run with nothing to do costs one query.
 */
import { closePool } from "../src/db";
import { countDueMessages, listOutbox, markDueMessages } from "../src/db/queries/messages";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env first.");
  }
  const dryRun = process.argv.slice(2).includes("--dry");
  const now = new Date();

  if (dryRun) {
    const pending = await listOutbox({ statuses: ["scheduled"], limit: 500 });
    const ready = pending.filter((row) => row.sendAfter.getTime() <= now.getTime());
    console.log(`[dry] ${ready.length} mensaje(s) pasarían a "due":`);
    for (const row of ready) {
      console.log(`  ${row.reference}  ${row.templateKey}  ${row.sendAfter.toISOString()}`);
    }
    return;
  }

  const flipped = await markDueMessages(now);
  const due = await countDueMessages();
  console.log(`${flipped} mensaje(s) marcados como "due". Total pendiente de envío: ${due}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
