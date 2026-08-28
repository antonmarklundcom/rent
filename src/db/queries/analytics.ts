/**
 * Business analytics (plan §5.O10, feature #12).
 *
 * Read-only aggregates over the same rows the engine writes — no separate
 * reporting store, no denormalised counters that can drift. Every function
 * takes a window and an optional `listingIds` scope so the admin dashboard and
 * a future owner-scoped view share one implementation.
 *
 * Occupancy is computed the same way availability is (`src/lib/dates.ts`
 * half-open ranges, `OCCUPYING_STATUSES`), so "the calendar says booked" and
 * "the dashboard says occupied" can never disagree.
 */
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  carDetails,
  expenses,
  listings,
  locations,
  type Vertical,
} from "@/db/schema";
import type { Executor } from "@/db/queries/availability";
import { OCCUPYING_STATUSES } from "@/lib/booking-state";
import { MS_PER_DAY, type DateRange } from "@/lib/dates";
import { round2, toMoney, toNumber } from "@/lib/money";

export type AnalyticsWindow = DateRange;

/** Last `days` days ending now — the dashboard's default window. */
export function trailingWindow(days = 90, now: Date = new Date()): AnalyticsWindow {
  return { startAt: new Date(now.getTime() - days * MS_PER_DAY), endAt: now };
}

type Scope = { listingIds?: number[]; vertical?: Vertical };

/** `expenses.incurred_on` is a DATE column read as a string, so compare strings. */
const ymd = (date: Date) => date.toISOString().slice(0, 10);

function scopeFilter(scope: Scope) {
  return and(
    scope.listingIds ? inArray(listings.id, scope.listingIds) : undefined,
    scope.vertical ? eq(listings.vertical, scope.vertical) : undefined,
  );
}

/** Bookings that overlap the window at all — half-open, like everything else. */
function overlapsWindow(window: AnalyticsWindow) {
  return and(lt(bookings.startAt, window.endAt), gte(bookings.endAt, window.startAt));
}

/* -------------------------------------------------------------------------- */
/* Occupancy + revenue per listing                                            */
/* -------------------------------------------------------------------------- */

export type ListingPerformance = {
  listingId: number;
  title: string;
  vertical: Vertical;
  locationName: string | null;
  /** 0–100, share of the window the listing was occupied. */
  occupancyPct: number;
  occupiedDays: number;
  windowDays: number;
  bookingCount: number;
  revenue: string;
  commission: string;
  expenses: string;
  /** revenue − expenses, as the operator sees it before payouts. */
  netAfterExpenses: string;
  /** expenses ÷ revenue × 100, `null` when there is no revenue to divide by. */
  expenseRatioPct: number | null;
};

/**
 * Per-listing performance over a window.
 *
 * Occupied time is CLIPPED to the window: a booking that starts before it or
 * ends after it contributes only its overlapping hours, so occupancy can never
 * exceed 100% and two adjacent windows sum to the whole.
 */
export async function listingPerformance(
  window: AnalyticsWindow,
  scope: Scope = {},
  executor: Executor = db,
): Promise<ListingPerformance[]> {
  if (scope.listingIds && scope.listingIds.length === 0) return [];
  const windowMs = Math.max(1, window.endAt.getTime() - window.startAt.getTime());
  const windowDays = round2(windowMs / MS_PER_DAY);

  const listingRows = await executor
    .select({
      id: listings.id,
      title: listings.title,
      vertical: listings.vertical,
      locationName: locations.name,
    })
    .from(listings)
    .leftJoin(locations, eq(locations.id, listings.locationId))
    .where(scopeFilter(scope));
  if (listingRows.length === 0) return [];

  const ids = listingRows.map((row) => row.id);

  const bookingRows = await executor
    .select({
      listingId: bookings.listingId,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      total: bookings.total,
      commissionAmount: bookings.commissionAmount,
      status: bookings.status,
    })
    .from(bookings)
    .where(
      and(
        inArray(bookings.listingId, ids),
        inArray(bookings.status, [...OCCUPYING_STATUSES]),
        overlapsWindow(window),
      ),
    );

  const expenseRows = await executor
    .select({
      listingId: expenses.listingId,
      total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
    })
    .from(expenses)
    .where(
      and(
        inArray(expenses.listingId, ids),
        gte(expenses.incurredOn, ymd(window.startAt)),
        lt(expenses.incurredOn, ymd(window.endAt)),
      ),
    )
    .groupBy(expenses.listingId);
  const expenseByListing = new Map(expenseRows.map((row) => [row.listingId, row.total]));

  const perListing = new Map<
    number,
    { occupiedMs: number; count: number; revenue: number; commission: number }
  >();
  for (const row of bookingRows) {
    const start = Math.max(new Date(row.startAt).getTime(), window.startAt.getTime());
    const end = Math.min(new Date(row.endAt).getTime(), window.endAt.getTime());
    const entry =
      perListing.get(row.listingId) ??
      { occupiedMs: 0, count: 0, revenue: 0, commission: 0 };
    entry.occupiedMs += Math.max(0, end - start);
    entry.count += 1;
    entry.revenue += toNumber(row.total);
    entry.commission += toNumber(row.commissionAmount);
    perListing.set(row.listingId, entry);
  }

  return listingRows
    .map((listing) => {
      const stats =
        perListing.get(listing.id) ?? { occupiedMs: 0, count: 0, revenue: 0, commission: 0 };
      const revenue = toMoney(stats.revenue);
      const spent = expenseByListing.get(listing.id) ?? "0";
      return {
        listingId: listing.id,
        title: listing.title,
        vertical: listing.vertical,
        locationName: listing.locationName,
        occupancyPct: round2((stats.occupiedMs / windowMs) * 100),
        occupiedDays: round2(stats.occupiedMs / MS_PER_DAY),
        windowDays,
        bookingCount: stats.count,
        revenue,
        commission: toMoney(stats.commission),
        expenses: toMoney(spent),
        netAfterExpenses: toMoney(toNumber(revenue) - toNumber(spent)),
        expenseRatioPct:
          toNumber(revenue) > 0
            ? round2((toNumber(spent) / toNumber(revenue)) * 100)
            : null,
      };
    })
    .sort((a, b) => toNumber(b.revenue) - toNumber(a.revenue));
}

/* -------------------------------------------------------------------------- */
/* Portfolio roll-up                                                          */
/* -------------------------------------------------------------------------- */

export type PortfolioSummary = {
  listings: number;
  bookings: number;
  revenue: string;
  commission: string;
  expenses: string;
  /** Average occupancy across listings — the portfolio's utilisation. */
  occupancyPct: number;
  expenseRatioPct: number | null;
};

export function summarise(rows: ListingPerformance[]): PortfolioSummary {
  const revenue = rows.reduce((sum, row) => sum + toNumber(row.revenue), 0);
  const spent = rows.reduce((sum, row) => sum + toNumber(row.expenses), 0);
  const occupancy =
    rows.length === 0
      ? 0
      : rows.reduce((sum, row) => sum + row.occupancyPct, 0) / rows.length;
  return {
    listings: rows.length,
    bookings: rows.reduce((sum, row) => sum + row.bookingCount, 0),
    revenue: toMoney(revenue),
    commission: toMoney(rows.reduce((sum, row) => sum + toNumber(row.commission), 0)),
    expenses: toMoney(spent),
    occupancyPct: round2(occupancy),
    expenseRatioPct: revenue > 0 ? round2((spent / revenue) * 100) : null,
  };
}

/**
 * Fleet utilisation (#12) — the autos counterpart to occupancy. Same number,
 * restricted to cars, which is the figure that decides whether to buy another.
 */
export async function fleetUtilisation(
  window: AnalyticsWindow,
  scope: Scope = {},
  executor: Executor = db,
): Promise<PortfolioSummary & { vehicles: number }> {
  const rows = await listingPerformance(window, { ...scope, vertical: "car" }, executor);
  return { ...summarise(rows), vehicles: rows.length };
}

/* -------------------------------------------------------------------------- */
/* Breakdowns                                                                 */
/* -------------------------------------------------------------------------- */

export type LocationPerformance = {
  locationId: number | null;
  locationName: string;
  listings: number;
  bookings: number;
  revenue: string;
};

/** Top barrios/ciudades by revenue (#12) — feeds the SEO location strategy. */
export async function topLocations(
  window: AnalyticsWindow,
  scope: Scope = {},
  limit = 10,
  executor: Executor = db,
): Promise<LocationPerformance[]> {
  if (scope.listingIds && scope.listingIds.length === 0) return [];
  const rows = await executor
    .select({
      locationId: listings.locationId,
      locationName: locations.name,
      listings: sql<number>`COUNT(DISTINCT ${listings.id})`,
      bookings: sql<number>`COUNT(${bookings.id})`,
      revenue: sql<string>`COALESCE(SUM(${bookings.total}), 0)`,
    })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .leftJoin(locations, eq(locations.id, listings.locationId))
    .where(
      and(
        scopeFilter(scope),
        inArray(bookings.status, [...OCCUPYING_STATUSES]),
        overlapsWindow(window),
      ),
    )
    .groupBy(listings.locationId, locations.name)
    .orderBy(sql`SUM(${bookings.total}) DESC`)
    .limit(limit);

  return rows.map((row) => ({
    locationId: row.locationId,
    locationName: row.locationName ?? "Sin ubicación",
    listings: Number(row.listings),
    bookings: Number(row.bookings),
    revenue: toMoney(row.revenue),
  }));
}

export type SourceBreakdown = {
  source: string;
  bookings: number;
  revenue: string;
  /** Share of bookings in the window, 0–100. */
  sharePct: number;
};

/**
 * Where bookings come from (#12).
 *
 * Counts EVERY booking including inquiries — an inquiry that never converted
 * still tells you which channel produced it, which is the whole point of the
 * question. Revenue only counts what occupies the calendar.
 */
export async function bookingSources(
  window: AnalyticsWindow,
  scope: Scope = {},
  executor: Executor = db,
): Promise<SourceBreakdown[]> {
  if (scope.listingIds && scope.listingIds.length === 0) return [];
  const rows = await executor
    .select({
      source: bookings.source,
      count: sql<number>`COUNT(*)`,
      revenue: sql<string>`COALESCE(SUM(CASE WHEN ${bookings.status} IN ('confirmed','active','completed')
        THEN ${bookings.total} ELSE 0 END), 0)`,
    })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(and(scopeFilter(scope), overlapsWindow(window)))
    .groupBy(bookings.source);

  const total = rows.reduce((sum, row) => sum + Number(row.count), 0);
  return rows
    .map((row) => ({
      source: row.source,
      bookings: Number(row.count),
      revenue: toMoney(row.revenue),
      sharePct: total > 0 ? round2((Number(row.count) / total) * 100) : 0,
    }))
    .sort((a, b) => b.bookings - a.bookings);
}

export type StatusBreakdown = { status: string; count: number };

export async function bookingStatusMix(
  window: AnalyticsWindow,
  scope: Scope = {},
  executor: Executor = db,
): Promise<StatusBreakdown[]> {
  if (scope.listingIds && scope.listingIds.length === 0) return [];
  const rows = await executor
    .select({ status: bookings.status, count: sql<number>`COUNT(*)` })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(and(scopeFilter(scope), overlapsWindow(window)))
    .groupBy(bookings.status);
  return rows.map((row) => ({ status: row.status, count: Number(row.count) }));
}

export type ExpenseBreakdown = { category: string; total: string; sharePct: number };

export async function expenseMix(
  window: AnalyticsWindow,
  scope: Scope = {},
  executor: Executor = db,
): Promise<ExpenseBreakdown[]> {
  if (scope.listingIds && scope.listingIds.length === 0) return [];
  const rows = await executor
    .select({
      category: expenses.category,
      total: sql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
    })
    .from(expenses)
    .innerJoin(listings, eq(listings.id, expenses.listingId))
    .where(
      and(
        scopeFilter(scope),
        gte(expenses.incurredOn, ymd(window.startAt)),
        lt(expenses.incurredOn, ymd(window.endAt)),
      ),
    )
    .groupBy(expenses.category);

  const total = rows.reduce((sum, row) => sum + toNumber(row.total), 0);
  return rows
    .map((row) => ({
      category: row.category,
      total: toMoney(row.total),
      sharePct: total > 0 ? round2((toNumber(row.total) / total) * 100) : 0,
    }))
    .sort((a, b) => toNumber(b.total) - toNumber(a.total));
}

/** Everything the admin dashboard needs, in one call. */
export async function analyticsOverview(
  window: AnalyticsWindow,
  scope: Scope = {},
  executor: Executor = db,
) {
  const [perListing, locationsTop, sources, statuses, expensesMix] = await Promise.all([
    listingPerformance(window, scope, executor),
    topLocations(window, scope, 10, executor),
    bookingSources(window, scope, executor),
    bookingStatusMix(window, scope, executor),
    expenseMix(window, scope, executor),
  ]);
  const stays = perListing.filter((row) => row.vertical === "stay");
  const cars = perListing.filter((row) => row.vertical === "car");
  return {
    window,
    portfolio: summarise(perListing),
    stays: { ...summarise(stays), listings: stays.length },
    fleet: { ...summarise(cars), vehicles: cars.length },
    perListing,
    topLocations: locationsTop,
    sources,
    statuses,
    expenses: expensesMix,
  };
}

/** Cars with no booking in the window — the "why is this sitting there" list. */
export async function idleVehicles(
  window: AnalyticsWindow,
  scope: Scope = {},
  executor: Executor = db,
) {
  const rows = await listingPerformance(window, { ...scope, vertical: "car" }, executor);
  const idle = rows.filter((row) => row.bookingCount === 0);
  if (idle.length === 0) return [];
  const details = await executor
    .select({
      listingId: carDetails.listingId,
      make: carDetails.make,
      model: carDetails.model,
      year: carDetails.year,
    })
    .from(carDetails)
    .where(inArray(carDetails.listingId, idle.map((row) => row.listingId)));
  const byListing = new Map(details.map((row) => [row.listingId, row]));
  return idle.map((row) => ({ ...row, car: byListing.get(row.listingId) ?? null }));
}
