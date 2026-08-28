/**
 * The owner panel's read layer (plan §5.O10).
 *
 * Everything here is owner-scoped through `src/lib/scope.ts`. An `owner` sees
 * exactly the rows whose listing they own; an admin sees the same shapes for
 * anybody. UI hiding is never the boundary (plan §2), so every function takes
 * the session and composes the scope into its WHERE clause — none of them
 * accept a raw `ownerId` from a caller.
 */
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  availabilityBlocks,
  bookings,
  carDetails,
  listingImages,
  listings,
  locations,
  stayDetails,
  type ListingStatus,
  type Vertical,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { listBookingsForListings } from "@/db/queries/bookings";
import { expenseTotalsByListing } from "@/db/queries/expenses";
import { listStatementsForOwner } from "@/db/queries/statements";
import { AuthError, isAdmin, type SessionUser } from "@/lib/auth-core";
import { OCCUPYING_STATUSES } from "@/lib/booking-state";
import { DomainError } from "@/lib/errors";
import { addMoney, toMoney, toNumber } from "@/lib/money";
import { listingScope, ownedListingIds } from "@/lib/scope";

/* -------------------------------------------------------------------------- */
/* Listings                                                                   */
/* -------------------------------------------------------------------------- */

export type PanelListing = {
  id: number;
  slug: string;
  title: string;
  vertical: Vertical;
  status: ListingStatus;
  price: string;
  currency: string;
  locationName: string | null;
  imageCount: number;
  icalExportToken: string | null;
};

export async function listPanelListings(
  user: SessionUser,
  executor: Executor = db,
): Promise<PanelListing[]> {
  const rows = await executor
    .select({
      id: listings.id,
      slug: listings.slug,
      title: listings.title,
      vertical: listings.vertical,
      status: listings.status,
      price: listings.price,
      currency: listings.currency,
      locationName: locations.name,
      icalExportToken: listings.icalExportToken,
    })
    .from(listings)
    .leftJoin(locations, eq(locations.id, listings.locationId))
    .where(listingScope(user))
    .orderBy(desc(listings.updatedAt));
  if (rows.length === 0) return [];

  const images = await executor
    .select({ listingId: listingImages.listingId })
    .from(listingImages)
    .where(inArray(listingImages.listingId, rows.map((row) => row.id)));
  const counts = new Map<number, number>();
  for (const row of images) counts.set(row.listingId, (counts.get(row.listingId) ?? 0) + 1);

  return rows.map((row) => ({ ...row, imageCount: counts.get(row.id) ?? 0 }));
}

/** One listing plus its typed details — the panel's edit screen. */
export async function getPanelListing(
  user: SessionUser,
  listingId: number,
  executor: Executor = db,
) {
  const [row] = await executor
    .select({
      listing: listings,
      locationName: locations.name,
      stay: stayDetails,
      car: carDetails,
    })
    .from(listings)
    .leftJoin(locations, eq(locations.id, listings.locationId))
    .leftJoin(stayDetails, eq(stayDetails.listingId, listings.id))
    .leftJoin(carDetails, eq(carDetails.listingId, listings.id))
    .where(and(eq(listings.id, listingId), listingScope(user)))
    .limit(1);
  return row ?? null;
}

export type UpdateListingInput = {
  title?: string;
  description?: string | null;
  price?: string;
  status?: ListingStatus;
  cancellationPolicy?: "flexible" | "moderate" | "strict";
};

/**
 * Owner-editable listing fields.
 *
 * Deliberately NOT editable here: `commission_pct` (that is the contract, and
 * §5.O7 puts it behind an admin), `owner_id`, `slug` (a live URL) and
 * `vertical` (it would orphan the typed detail row). An owner who needs one of
 * those changed talks to an admin — which is the point of a managed service.
 *
 * PUBLISHING: an owner may publish and pause their own listing directly
 * (§9 records this as O-4's judgment call). The gate that matters commercially
 * is the onboarding checklist, which is visible to admins, not a second
 * approval queue nobody staffs.
 */
export async function updatePanelListing(
  user: SessionUser,
  listingId: number,
  input: UpdateListingInput,
  executor: Executor = db,
): Promise<void> {
  const existing = await getPanelListing(user, listingId, executor);
  if (!existing) {
    throw new AuthError("No tenés permiso sobre esta publicación", "forbidden");
  }
  const patch: Partial<typeof listings.$inferInsert> = { updatedBy: user.id };
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title.length < 4) throw new DomainError("El título es muy corto", "invalid_amount");
    patch.title = title;
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.price !== undefined) {
    const price = toMoney(input.price);
    if (toNumber(price) <= 0) throw new DomainError("El precio tiene que ser mayor a cero", "invalid_amount");
    patch.price = price;
  }
  if (input.cancellationPolicy !== undefined) {
    patch.cancellationPolicy = input.cancellationPolicy;
  }
  if (input.status !== undefined && input.status !== existing.listing.status) {
    patch.status = input.status;
    // `published_at` is the SEO/ordering signal — stamp it on the first
    // publish and never move it, so pausing and republishing does not shuffle
    // a listing back to the top of every browse page.
    if (input.status === "published" && !existing.listing.publishedAt) {
      patch.publishedAt = new Date();
    }
  }

  await executor.update(listings).set(patch).where(eq(listings.id, listingId));
  await logActivity(
    {
      entity: "listing",
      entityId: listingId,
      action: patch.status ? `listing.${patch.status}` : "listing.updated",
      userId: user.id,
      meta: { fields: Object.keys(patch).filter((key) => key !== "updatedBy") },
    },
    executor,
  );
}

/* -------------------------------------------------------------------------- */
/* Calendar + upcoming                                                        */
/* -------------------------------------------------------------------------- */

export type CalendarEntry = {
  kind: "booking" | "block";
  id: number;
  listingId: number;
  listingTitle: string;
  startAt: Date;
  endAt: Date;
  label: string;
  status: string;
};

/**
 * One merged calendar feed for the panel: bookings that occupy the calendar
 * plus owner/maintenance/iCal blocks, in the same shape, sorted by start.
 *
 * Blocks and bookings look identical to availability (#15), so the panel shows
 * them identically — an owner who blocked a week should see it exactly where a
 * booking would be.
 */
export async function panelCalendar(
  user: SessionUser,
  window: { startAt: Date; endAt: Date },
  executor: Executor = db,
): Promise<CalendarEntry[]> {
  const ids = await ownedListingIds(user);
  if (ids.length === 0) return [];

  const [bookingRows, blockRows] = await Promise.all([
    executor
      .select({
        id: bookings.id,
        listingId: bookings.listingId,
        listingTitle: listings.title,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        status: bookings.status,
        reference: bookings.reference,
        guestName: bookings.guestName,
      })
      .from(bookings)
      .innerJoin(listings, eq(listings.id, bookings.listingId))
      .where(
        and(
          inArray(bookings.listingId, ids),
          inArray(bookings.status, [...OCCUPYING_STATUSES]),
          lt(bookings.startAt, window.endAt),
          gte(bookings.endAt, window.startAt),
        ),
      ),
    executor
      .select({
        id: availabilityBlocks.id,
        listingId: availabilityBlocks.listingId,
        listingTitle: listings.title,
        startAt: availabilityBlocks.startAt,
        endAt: availabilityBlocks.endAt,
        reason: availabilityBlocks.reason,
        note: availabilityBlocks.note,
      })
      .from(availabilityBlocks)
      .innerJoin(listings, eq(listings.id, availabilityBlocks.listingId))
      .where(
        and(
          inArray(availabilityBlocks.listingId, ids),
          lt(availabilityBlocks.startAt, window.endAt),
          gte(availabilityBlocks.endAt, window.startAt),
        ),
      ),
  ]);

  const entries: CalendarEntry[] = [
    ...bookingRows.map((row) => ({
      kind: "booking" as const,
      id: row.id,
      listingId: row.listingId,
      listingTitle: row.listingTitle,
      startAt: row.startAt,
      endAt: row.endAt,
      label: `${row.reference} — ${row.guestName}`,
      status: row.status,
    })),
    ...blockRows.map((row) => ({
      kind: "block" as const,
      id: row.id,
      listingId: row.listingId,
      listingTitle: row.listingTitle,
      startAt: row.startAt,
      endAt: row.endAt,
      label: row.note ?? "Bloqueo",
      status: row.reason,
    })),
  ];
  return entries.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export async function upcomingBookings(
  user: SessionUser,
  limit = 20,
  executor: Executor = db,
) {
  const ids = await ownedListingIds(user);
  return listBookingsForListings(
    ids,
    { statuses: ["inquiry", "confirmed", "active"], from: new Date(), limit },
    executor,
  );
}

export async function panelBlocks(user: SessionUser, executor: Executor = db) {
  const ids = await ownedListingIds(user);
  if (ids.length === 0) return [];
  return executor
    .select({
      block: availabilityBlocks,
      listingTitle: listings.title,
    })
    .from(availabilityBlocks)
    .innerJoin(listings, eq(listings.id, availabilityBlocks.listingId))
    .where(
      and(
        inArray(availabilityBlocks.listingId, ids),
        gte(availabilityBlocks.endAt, new Date()),
      ),
    )
    .orderBy(asc(availabilityBlocks.startAt))
    .limit(100);
}

/* -------------------------------------------------------------------------- */
/* Earnings                                                                   */
/* -------------------------------------------------------------------------- */

export type PanelEarnings = {
  /** Only `completed` bookings — money that is actually earned. */
  gross: string;
  commission: string;
  expenses: string;
  net: string;
  bookings: number;
  /** Confirmed/active bookings not yet completed: what is still coming. */
  pipeline: string;
};

/**
 * What the owner is owed, computed the same way the statement generator does
 * (`gross − commission − expenses`), so the panel figure and the PDF agree.
 * The statement is still the authority — this is the running view between
 * statements.
 */
export async function panelEarnings(
  user: SessionUser,
  window: { startAt: Date; endAt: Date },
  executor: Executor = db,
): Promise<PanelEarnings> {
  const ids = await ownedListingIds(user);
  if (ids.length === 0) {
    return { gross: "0.00", commission: "0.00", expenses: "0.00", net: "0.00", bookings: 0, pipeline: "0.00" };
  }
  const rows = await executor
    .select({
      status: bookings.status,
      total: bookings.total,
      commissionAmount: bookings.commissionAmount,
    })
    .from(bookings)
    .where(
      and(
        inArray(bookings.listingId, ids),
        inArray(bookings.status, [...OCCUPYING_STATUSES]),
        gte(bookings.endAt, window.startAt),
        lt(bookings.endAt, window.endAt),
      ),
    );

  let gross = "0.00";
  let commission = "0.00";
  let pipeline = "0.00";
  let count = 0;
  for (const row of rows) {
    if (row.status === "completed") {
      gross = addMoney(gross, row.total);
      commission = addMoney(commission, row.commissionAmount ?? 0);
      count += 1;
    } else {
      pipeline = addMoney(pipeline, row.total);
    }
  }

  const expenseRows = await expenseTotalsByListing({ listingIds: ids }, executor);
  const spent = expenseRows.reduce((sum, row) => addMoney(sum, row.total), "0.00");

  return {
    gross,
    commission,
    expenses: spent,
    net: toMoney(toNumber(gross) - toNumber(commission) - toNumber(spent)),
    bookings: count,
    pipeline,
  };
}

/** An owner's statements; admins pass an explicit `ownerId`. */
export async function panelStatements(
  user: SessionUser,
  ownerId?: number,
  executor: Executor = db,
) {
  const target = isAdmin(user) ? ownerId : user.ownerId;
  if (!target) return [];
  if (!isAdmin(user) && target !== user.ownerId) {
    throw new AuthError("No tenés permiso sobre estos estados", "forbidden");
  }
  return listStatementsForOwner(target, executor);
}
