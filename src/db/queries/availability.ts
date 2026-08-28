/**
 * THE availability engine (plan §5.O4).
 *
 * Exactly one overlap check exists in this codebase and it lives here. Public
 * booking requests, admin manual bookings, owner blocked dates and the iCal
 * importer all call `assertAvailable` — there is no second implementation to
 * drift out of sync.
 *
 * Availability = occupying bookings (`confirmed | active | completed`, see
 * `src/lib/booking-state.ts`) + every `availability_blocks` row, whatever its
 * reason, including `external_ical` rows written by `scripts/sync-ical.ts`.
 *
 * Ranges are half-open `[startAt, endAt)`, so the SQL predicate is always
 * `start_at < :end AND end_at > :start` and a back-to-back handover is legal.
 */
import { and, eq, gt, inArray, lt, ne } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { db, type schema } from "@/db";
import {
  availabilityBlocks,
  bookings,
  type BlockReason,
  type BookingStatus,
} from "@/db/schema";
import { OCCUPYING_STATUSES } from "@/lib/booking-state";
import { assertValidRange, type DateRange } from "@/lib/dates";
import { DomainError } from "@/lib/errors";

type Database = MySql2Database<typeof schema>;
/** A transaction handle has the same query surface as the pool-backed db. */
export type Executor =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

export type BookingConflict = {
  kind: "booking";
  id: number;
  reference: string;
  status: BookingStatus;
  startAt: Date;
  endAt: Date;
};

export type BlockConflict = {
  kind: "block";
  id: number;
  reason: BlockReason;
  note: string | null;
  startAt: Date;
  endAt: Date;
};

export type Conflict = BookingConflict | BlockConflict;

export type AvailabilityQuery = {
  listingId: number;
  startAt: Date;
  endAt: Date;
  /** Ignore this booking — used when a booking re-claims its own dates. */
  excludeBookingId?: number;
  /** Ignore this block — used when an existing block is being moved. */
  excludeBlockId?: number;
  /** Lock the matched rows (`FOR UPDATE`); only valid inside a transaction. */
  lock?: boolean;
};

/**
 * Every conflicting booking and block for a range. The one place the overlap
 * predicate is written in SQL.
 */
export async function findConflicts(
  query: AvailabilityQuery,
  executor: Executor = db,
): Promise<Conflict[]> {
  const { startAt, endAt } = assertValidRange(query.startAt, query.endAt);

  const bookingWhere = and(
    eq(bookings.listingId, query.listingId),
    inArray(bookings.status, [...OCCUPYING_STATUSES]),
    lt(bookings.startAt, endAt),
    gt(bookings.endAt, startAt),
    query.excludeBookingId ? ne(bookings.id, query.excludeBookingId) : undefined,
  );
  const blockWhere = and(
    eq(availabilityBlocks.listingId, query.listingId),
    lt(availabilityBlocks.startAt, endAt),
    gt(availabilityBlocks.endAt, startAt),
    query.excludeBlockId ? ne(availabilityBlocks.id, query.excludeBlockId) : undefined,
  );

  const bookingSelect = executor
    .select({
      id: bookings.id,
      reference: bookings.reference,
      status: bookings.status,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
    })
    .from(bookings)
    .where(bookingWhere);
  const blockSelect = executor
    .select({
      id: availabilityBlocks.id,
      reason: availabilityBlocks.reason,
      note: availabilityBlocks.note,
      startAt: availabilityBlocks.startAt,
      endAt: availabilityBlocks.endAt,
    })
    .from(availabilityBlocks)
    .where(blockWhere);

  // FOR UPDATE takes the index-range (gap) locks that stop a concurrent
  // request from slipping a booking into the same dates between our check and
  // our insert. Sequential inside the transaction on purpose — two locking
  // reads on one connection cannot be issued in parallel.
  const bookingRows = query.lock ? await bookingSelect.for("update") : await bookingSelect;
  const blockRows = query.lock ? await blockSelect.for("update") : await blockSelect;

  return [
    ...bookingRows.map((row): BookingConflict => ({ kind: "booking", ...row })),
    ...blockRows.map((row): BlockConflict => ({ kind: "block", ...row })),
  ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export async function isAvailable(
  query: AvailabilityQuery,
  executor: Executor = db,
): Promise<boolean> {
  return (await findConflicts(query, executor)).length === 0;
}

/**
 * Reject the range if anything already occupies it. THE guard — every write
 * path that claims dates calls this, inside the same transaction as its insert.
 */
export async function assertAvailable(
  query: AvailabilityQuery,
  executor: Executor = db,
): Promise<void> {
  const conflicts = await findConflicts(query, executor);
  if (conflicts.length === 0) return;
  throw new DomainError(
    "Esas fechas ya no están disponibles",
    "unavailable",
    {
      listingId: query.listingId,
      conflicts: conflicts.map((conflict) =>
        conflict.kind === "booking"
          ? { kind: conflict.kind, reference: conflict.reference, status: conflict.status }
          : { kind: conflict.kind, reason: conflict.reason, id: conflict.id },
      ),
    },
  );
}

/**
 * Everything occupying a listing between two instants — the calendar feed for
 * the owner panel, the public detail page and the iCal export alike.
 */
export async function listOccupiedRanges(
  listingId: number,
  window: DateRange,
  executor: Executor = db,
): Promise<Conflict[]> {
  return findConflicts(
    { listingId, startAt: window.startAt, endAt: window.endAt },
    executor,
  );
}

/** Occupied ranges for several listings at once (owner calendar, admin views). */
export async function listOccupiedRangesForListings(
  listingIds: number[],
  window: DateRange,
  executor: Executor = db,
): Promise<Map<number, Conflict[]>> {
  const out = new Map<number, Conflict[]>();
  if (listingIds.length === 0) return out;
  const { startAt, endAt } = assertValidRange(window.startAt, window.endAt);

  const [bookingRows, blockRows] = await Promise.all([
    executor
      .select({
        listingId: bookings.listingId,
        id: bookings.id,
        reference: bookings.reference,
        status: bookings.status,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
      })
      .from(bookings)
      .where(
        and(
          inArray(bookings.listingId, listingIds),
          inArray(bookings.status, [...OCCUPYING_STATUSES]),
          lt(bookings.startAt, endAt),
          gt(bookings.endAt, startAt),
        ),
      ),
    executor
      .select({
        listingId: availabilityBlocks.listingId,
        id: availabilityBlocks.id,
        reason: availabilityBlocks.reason,
        note: availabilityBlocks.note,
        startAt: availabilityBlocks.startAt,
        endAt: availabilityBlocks.endAt,
      })
      .from(availabilityBlocks)
      .where(
        and(
          inArray(availabilityBlocks.listingId, listingIds),
          lt(availabilityBlocks.startAt, endAt),
          gt(availabilityBlocks.endAt, startAt),
        ),
      ),
  ]);

  for (const id of listingIds) out.set(id, []);
  for (const row of bookingRows) {
    const { listingId, ...rest } = row;
    out.get(listingId)?.push({ kind: "booking", ...rest });
  }
  for (const row of blockRows) {
    const { listingId, ...rest } = row;
    out.get(listingId)?.push({ kind: "block", ...rest });
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  }
  return out;
}

/**
 * Count of nights/days a listing is occupied inside a window — the raw input
 * for the occupancy metric in §5.O10. Clipped to the window on both sides.
 */
export function occupiedMillis(conflicts: Conflict[], window: DateRange): number {
  const merged: DateRange[] = [];
  const clipped = conflicts
    .map((conflict) => ({
      startAt: new Date(Math.max(conflict.startAt.getTime(), window.startAt.getTime())),
      endAt: new Date(Math.min(conflict.endAt.getTime(), window.endAt.getTime())),
    }))
    .filter((range) => range.endAt.getTime() > range.startAt.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  for (const range of clipped) {
    const last = merged[merged.length - 1];
    if (last && range.startAt.getTime() <= last.endAt.getTime()) {
      if (range.endAt.getTime() > last.endAt.getTime()) last.endAt = range.endAt;
    } else {
      merged.push({ ...range });
    }
  }
  return merged.reduce(
    (total, range) => total + (range.endAt.getTime() - range.startAt.getTime()),
    0,
  );
}
