import "dotenv/config";
/**
 * The scheduled-message processor (#4, plan §5.O9) — cron-ready, idempotent.
 *
 *   npm run messages            # flip everything due as of now
 *   npm run messages -- --dry   # report what would flip, change nothing
 *
 * It does NOT send anything. Plan §1.5 keeps auto-send out of v1, so the job's
 * whole responsibility is moving `scheduled` rows whose time has come to `due`,
 * which is what puts them in the admin outbox for a human to send with one tap.
 * Running it twice in a row is a no-op; missing a run only delays a message.
 *
 * Suggested schedule: every 15 minutes (see README).
 */
import { and, eq, lte } from "drizzle-orm";
import { closePool, db } from "../src/db";
import { bookings, listings, scheduledMessages } from "../src/db/schema";
import { markDueMessages } from "../src/db/queries/messages";
import { formatLocalDateTime } from "../src/lib/messaging";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env first.");
  }
  const dryRun = process.argv.slice(2).includes("--dry");
  const now = new Date();

  const pending = await db
    .select({
      id: scheduledMessages.id,
      templateKey: scheduledMessages.templateKey,
      sendAfter: scheduledMessages.sendAfter,
      reference: bookings.reference,
      guestName: bookings.guestName,
      listingTitle: listings.title,
    })
    .from(scheduledMessages)
    .innerJoin(bookings, eq(bookings.id, scheduledMessages.bookingId))
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(
      and(eq(scheduledMessages.status, "scheduled"), lte(scheduledMessages.sendAfter, now)),
    )
    .orderBy(scheduledMessages.sendAfter);

  if (pending.length === 0) {
    console.log(`Nothing due as of ${now.toISOString()}.`);
    return;
  }

  for (const row of pending) {
    console.log(
      `  ${row.reference}  ${row.templateKey.padEnd(20)} ${formatLocalDateTime(row.sendAfter)}  ` +
        `${row.guestName} — ${row.listingTitle}`,
    );
  }

  if (dryRun) {
    console.log(`\n${pending.length} message(s) would move to "due". (--dry: nothing changed.)`);
    return;
  }

  const { due } = await markDueMessages(now);
  console.log(`\n${due} message(s) moved to "due" — visible now in /admin/mensajes.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
