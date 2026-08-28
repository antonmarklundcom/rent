import { count } from "drizzle-orm";
import { db } from "@/db";
import { bookings, cleaningTasks, listings, users } from "@/db/schema";
import { countOpenTasks } from "@/db/queries/cleaning";
import { listPendingDocuments } from "@/db/queries/documents";
import { countOpenTickets } from "@/db/queries/maintenance";
import { listDueReminders } from "@/db/queries/reminders";
import { listLowStock } from "@/db/queries/supplies";

/** Minimal admin overview — the real analytics land in phase O-4 (§5.O10). */
export async function adminCounts() {
  const [[u], [l], [b], [c]] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(listings),
    db.select({ value: count() }).from(bookings),
    db.select({ value: count() }).from(cleaningTasks),
  ]);
  return {
    users: u?.value ?? 0,
    listings: l?.value ?? 0,
    bookings: b?.value ?? 0,
    cleaningTasks: c?.value ?? 0,
  };
}

/**
 * What needs a human today (plan §5.O6/O8). One call so the admin landing page
 * can show the operational backlog without four round trips of its own.
 */
export async function operationsCounts(options: { listingIds?: number[] } = {}) {
  const [openTasks, openTickets, lowStock, dueReminders, pendingDocuments] = await Promise.all([
    countOpenTasks(options),
    countOpenTickets(options),
    listLowStock(options),
    listDueReminders({ listingIds: options.listingIds }),
    listPendingDocuments({ listingIds: options.listingIds }),
  ]);
  return {
    openTasks,
    openTickets,
    lowStock: lowStock.length,
    dueReminders: dueReminders.length,
    pendingDocuments: pendingDocuments.length,
  };
}
