import { count } from "drizzle-orm";
import { db } from "@/db";
import { bookings, cleaningTasks, listings, users } from "@/db/schema";

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
