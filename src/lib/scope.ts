import { and, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bookings, listings } from "@/db/schema";
import { AuthError, isAdmin } from "@/lib/auth-core";
import type { SessionUser } from "@/lib/auth-core";

/**
 * Owner scoping (plan §2): admins and super_admins see everything; an `owner`
 * only ever sees rows whose listing belongs to them. Every owner-facing query
 * composes this into its WHERE clause — no UI-level filtering.
 */
export function listingScope(user: SessionUser, extra?: SQL): SQL | undefined {
  if (isAdmin(user)) return extra;
  if (user.role !== "owner" || !user.ownerId) {
    throw new AuthError("No tenés permiso para esta acción", "forbidden");
  }
  const own = eq(listings.ownerId, user.ownerId);
  return extra ? and(own, extra) : own;
}

/** Listing ids the user may touch — used to scope child entities. */
export async function ownedListingIds(user: SessionUser): Promise<number[]> {
  const rows = await db
    .select({ id: listings.id })
    .from(listings)
    .where(listingScope(user));
  return rows.map((r) => r.id);
}

export async function assertCanAccessListing(
  user: SessionUser,
  listingId: number,
): Promise<void> {
  if (isAdmin(user)) return;
  const [row] = await db
    .select({ ownerId: listings.ownerId })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!row || row.ownerId !== user.ownerId) {
    throw new AuthError("No tenés permiso sobre esta publicación", "forbidden");
  }
}

export async function assertCanAccessBooking(
  user: SessionUser,
  bookingId: number,
): Promise<void> {
  if (isAdmin(user)) return;
  const [row] = await db
    .select({ ownerId: listings.ownerId })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row || row.ownerId !== user.ownerId) {
    throw new AuthError("No tenés permiso sobre esta reserva", "forbidden");
  }
}
