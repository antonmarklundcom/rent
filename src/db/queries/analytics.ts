/**
 * Business analytics (#12 — plan §5.O10).
 *
 * Every metric here is scoped by a listing-id set, so the same functions serve
 * the admin dashboard (all listings) and the owner panel (their own) with no
 * second implementation and no way for an owner to see someone else's numbers.
 *
 * Occupancy is computed from THE availability engine's own conflict list
 * (`listOccupiedRanges` + `occupiedMillis`) rather than a second SQL sum: if a
 * booking or an iCal block occupies the calendar, it occupies the occupancy
 * figure, by construction.
 */
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  carDetails,
  expenses,
  listings,
  locations,
  type BookingSource,
  type Vertical,
} from "@/db/schema";
import { listOccupiedRanges, occupiedMillis, type Executor } from "@/db/queries/availability";
import { MS_PER_DAY, type DateRange } from "@/lib/dates";
import { addMoney, toMoney, toNumber } from "@/lib/money";

/** The window every metric on the dashboard is measured over. */
export function defaultWindow(now: Date = new Date(), days = 30): DateRange {
  const endAt = new Date(now);
  const startAt = new Date(now.getTime() - days * MS_PER_DAY);
  return { startAt, endAt };
}

export type OccupancyRow = {
  listingId: number;
  title: string;
  vertical: Vertical;
  occupiedDays: number;
  windowDays: number;
  occupancyPct: number;
};

/**
 * Occupancy % per listing over a window, and the portfolio average.
 *
 * `published` listings only: a draft that nobody could book would otherwise
 * drag the average toward zero and make the number meaningless.
 */
export async function occupancyByListing(
  window: DateRange,
  options: { listingIds?: number[]; vertical?: Vertical } = {},
  executor: Executor = db,
): Promise<{ rows: OccupancyRow[]; averagePct: number }> {
  if (options.listingIds && options.listingIds.length === 0) {
    return { rows: [], averagePct: 0 };
  }
  const target = await executor
    .select({ id: listings.id, title: listings.title, vertical: listings.vertical })
    .from(listings)
    .where(
      and(
        eq(listings.status, "published"),
        options.vertical ? eq(listings.vertical, options.vertical) : undefined,
        options.listingIds ? inArray(listings.id, options.listingIds) : undefined,
      ),
    );

  const windowDays = Math.max(
    1,
    Math.round((window.endAt.getTime() - window.startAt.getTime()) / MS_PER_DAY),
  );

  const rows: OccupancyRow[] = [];
  for (const listing of target) {
    const conflicts = await listOccupiedRanges(listing.id, window, executor);
    const occupiedDays = occupiedMillis(conflicts, window) / MS_PER_DAY;
    rows.push({
      listingId: listing.id,
      title: listing.title,
      vertical: listing.vertical,
      occupiedDays: Math.round(occupiedDays * 100) / 100,
      windowDays,
      occupancyPct: Math.round((occupiedDays / windowDays) * 1000) / 10,
    });
  }
  rows.sort((a, b) => b.occupancyPct - a.occupancyPct);
  const averagePct =
    rows.length === 0
      ? 0
      : Math.round((rows.reduce((sum, row) => sum + row.occupancyPct, 0) / rows.length) * 10) / 10;
  return { rows, averagePct };
}

export type RevenueRow = {
  listingId: number;
  title: string;
  vertical: Vertical;
  currency: string;
  bookingCount: number;
  gross: string;
  commission: string;
  expenses: string;
  /** gross − commission − expenses: what the owner is left with. */
  ownerNet: string;
  /** expenses ÷ gross, as a percentage. */
  expenseRatioPct: number;
};

/**
 * Revenue per listing (#12), on the same basis owner statements use: a booking
 * counts in the period its `end_at` falls in, and only once it is `completed`.
 * The dashboard and the statement must never disagree about a number an owner
 * can see twice.
 */
export async function revenueByListing(
  window: DateRange,
  options: { listingIds?: number[] } = {},
  executor: Executor = db,
): Promise<RevenueRow[]> {
  if (options.listingIds && options.listingIds.length === 0) return [];
  const scope = options.listingIds ? inArray(listings.id, options.listingIds) : undefined;

  const bookingRows = await executor
    .select({
      listingId: listings.id,
      title: listings.title,
      vertical: listings.vertical,
      currency: bookings.currency,
      baseTotal: bookings.baseTotal,
      discountTotal: bookings.discountTotal,
      commissionAmount: bookings.commissionAmount,
    })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(
      and(
        eq(bookings.status, "completed"),
        gte(bookings.endAt, window.startAt),
        lt(bookings.endAt, window.endAt),
        scope,
      ),
    );

  const expenseRows = await executor
    .select({
      listingId: expenses.listingId,
      currency: expenses.currency,
      amount: expenses.amount,
    })
    .from(expenses)
    .innerJoin(listings, eq(listings.id, expenses.listingId))
    .where(
      and(
        gte(expenses.incurredOn, window.startAt.toISOString().slice(0, 10)),
        lt(expenses.incurredOn, window.endAt.toISOString().slice(0, 10)),
        scope,
      ),
    );

  const byListing = new Map<number, RevenueRow>();
  const ensure = (
    listingId: number,
    title: string,
    vertical: Vertical,
    currency: string,
  ): RevenueRow => {
    let row = byListing.get(listingId);
    if (!row) {
      row = {
        listingId,
        title,
        vertical,
        currency,
        bookingCount: 0,
        gross: "0.00",
        commission: "0.00",
        expenses: "0.00",
        ownerNet: "0.00",
        expenseRatioPct: 0,
      };
      byListing.set(listingId, row);
    }
    return row;
  };

  for (const booking of bookingRows) {
    const row = ensure(booking.listingId, booking.title, booking.vertical, booking.currency);
    row.bookingCount += 1;
    // Owner gross = base − discount (plan §9, O-2 judgment call 3): extras are
    // the operator's own revenue and are neither paid out nor commissioned.
    row.gross = addMoney(row.gross, toMoney(toNumber(booking.baseTotal) - toNumber(booking.discountTotal)));
    row.commission = addMoney(row.commission, booking.commissionAmount ?? "0");
  }

  for (const expense of expenseRows) {
    if (!byListing.has(expense.listingId)) {
      // An expense on a listing with no completed bookings in the window still
      // belongs on the report — silently dropping it would flatter the numbers.
      const [listing] = await executor
        .select({ title: listings.title, vertical: listings.vertical })
        .from(listings)
        .where(eq(listings.id, expense.listingId))
        .limit(1);
      if (!listing) continue;
      ensure(expense.listingId, listing.title, listing.vertical, expense.currency);
    }
    const target = byListing.get(expense.listingId);
    if (!target) continue;
    target.expenses = addMoney(target.expenses, expense.amount);
  }

  for (const row of byListing.values()) {
    row.ownerNet = toMoney(
      toNumber(row.gross) - toNumber(row.commission) - toNumber(row.expenses),
    );
    row.expenseRatioPct =
      toNumber(row.gross) === 0
        ? 0
        : Math.round((toNumber(row.expenses) / toNumber(row.gross)) * 1000) / 10;
  }

  return [...byListing.values()].sort((a, b) => toNumber(b.gross) - toNumber(a.gross));
}

export type FleetUtilisation = {
  vehicles: number;
  rentedDays: number;
  availableDays: number;
  utilisationPct: number;
};

/** Fleet utilisation (#12) — the car half of the occupancy figure. Read
 *  through `analyticsDashboard`. */
async function fleetUtilisation(
  window: DateRange,
  options: { listingIds?: number[] } = {},
  executor: Executor = db,
): Promise<FleetUtilisation> {
  const { rows } = await occupancyByListing(
    window,
    { ...options, vertical: "car" },
    executor,
  );
  const rentedDays = rows.reduce((sum, row) => sum + row.occupiedDays, 0);
  const availableDays = rows.reduce((sum, row) => sum + row.windowDays, 0);
  return {
    vehicles: rows.length,
    rentedDays: Math.round(rentedDays * 100) / 100,
    availableDays,
    utilisationPct:
      availableDays === 0 ? 0 : Math.round((rentedDays / availableDays) * 1000) / 10,
  };
}

export type LocationRow = {
  locationId: number | null;
  name: string;
  parentName: string | null;
  listingCount: number;
  bookingCount: number;
};

/** Top barrios/ciudades by booking volume (#12). Read through
 *  `analyticsDashboard`. */
async function topLocations(
  window: DateRange,
  options: { listingIds?: number[]; limit?: number } = {},
  executor: Executor = db,
): Promise<LocationRow[]> {
  if (options.listingIds && options.listingIds.length === 0) return [];
  const parent = sql<string | null>`(
    select p.name from ${locations} p where p.id = ${locations.parentId}
  )`;
  const rows = await executor
    .select({
      locationId: locations.id,
      name: locations.name,
      parentName: parent,
      listingCount: sql<number>`count(distinct ${listings.id})`,
      bookingCount: sql<number>`count(${bookings.id})`,
    })
    .from(listings)
    .innerJoin(locations, eq(locations.id, listings.locationId))
    .leftJoin(
      bookings,
      and(
        eq(bookings.listingId, listings.id),
        gte(bookings.startAt, window.startAt),
        lt(bookings.startAt, window.endAt),
      ),
    )
    .where(options.listingIds ? inArray(listings.id, options.listingIds) : undefined)
    .groupBy(locations.id, locations.name, locations.parentId)
    .orderBy(sql`count(${bookings.id}) desc`)
    .limit(options.limit ?? 10);

  return rows.map((row) => ({
    locationId: row.locationId,
    name: row.name,
    parentName: row.parentName,
    listingCount: Number(row.listingCount),
    bookingCount: Number(row.bookingCount),
  }));
}

export type SourceRow = { source: BookingSource; bookingCount: number; gross: string };

/** Where bookings come from (#12) — `web | whatsapp | manual`. */
export async function bookingSources(
  window: DateRange,
  options: { listingIds?: number[] } = {},
  executor: Executor = db,
): Promise<SourceRow[]> {
  if (options.listingIds && options.listingIds.length === 0) return [];
  const rows = await executor
    .select({
      source: bookings.source,
      bookingCount: sql<number>`count(*)`,
      gross: sql<string>`coalesce(sum(${bookings.total}), 0)`,
    })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(
      and(
        gte(bookings.createdAt, window.startAt),
        lt(bookings.createdAt, window.endAt),
        options.listingIds ? inArray(listings.id, options.listingIds) : undefined,
      ),
    )
    .groupBy(bookings.source)
    .orderBy(sql`count(*) desc`);

  return rows.map((row) => ({
    source: row.source,
    bookingCount: Number(row.bookingCount),
    gross: toMoney(row.gross),
  }));
}

export type DashboardTotals = {
  gross: string;
  commission: string;
  expenses: string;
  ownerNet: string;
  expenseRatioPct: number;
  bookingCount: number;
  currency: string;
};

export function totalsFrom(rows: RevenueRow[]): DashboardTotals {
  const totals = rows.reduce(
    (acc, row) => ({
      gross: addMoney(acc.gross, row.gross),
      commission: addMoney(acc.commission, row.commission),
      expenses: addMoney(acc.expenses, row.expenses),
      bookingCount: acc.bookingCount + row.bookingCount,
    }),
    { gross: "0.00", commission: "0.00", expenses: "0.00", bookingCount: 0 },
  );
  return {
    ...totals,
    ownerNet: toMoney(
      toNumber(totals.gross) - toNumber(totals.commission) - toNumber(totals.expenses),
    ),
    expenseRatioPct:
      toNumber(totals.gross) === 0
        ? 0
        : Math.round((toNumber(totals.expenses) / toNumber(totals.gross)) * 1000) / 10,
    currency: rows[0]?.currency ?? "PYG",
  };
}

/** One call for the whole dashboard (#12) — admin-wide or owner-scoped. */
export async function analyticsDashboard(
  window: DateRange,
  options: { listingIds?: number[] } = {},
) {
  const [occupancy, revenue, fleet, locationRows, sources] = await Promise.all([
    occupancyByListing(window, options),
    revenueByListing(window, options),
    fleetUtilisation(window, options),
    topLocations(window, options),
    bookingSources(window, options),
  ]);
  return {
    window,
    occupancy,
    revenue,
    totals: totalsFrom(revenue),
    fleet,
    locations: locationRows,
    sources,
  };
}

/** How many cars are in the fleet at all — context for the utilisation figure. */
export async function fleetSize(
  options: { listingIds?: number[] } = {},
  executor: Executor = db,
): Promise<number> {
  if (options.listingIds && options.listingIds.length === 0) return 0;
  const [row] = await executor
    .select({ value: sql<number>`count(*)` })
    .from(carDetails)
    .innerJoin(listings, eq(listings.id, carDetails.listingId))
    .where(options.listingIds ? inArray(listings.id, options.listingIds) : undefined);
  return Number(row?.value ?? 0);
}
