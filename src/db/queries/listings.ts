import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  carDetails,
  listingImages,
  listings,
  locations,
  stayDetails,
  type PropertyType,
  type VehicleType,
  type Vertical,
} from "@/db/schema";
import { listingScope } from "@/lib/scope";
import type { SessionUser } from "@/lib/auth-core";
import type { Executor } from "@/db/queries/availability";

/**
 * All Drizzle lives under `src/db/queries/` — Window 2 (Sonnet) consumes these
 * functions and never writes queries of its own (plan §5.O11).
 */

/** Owner-scoped: an `owner` only ever gets their own rows (plan §2). */
export async function listListingsForUser(user: SessionUser) {
  return db
    .select({
      id: listings.id,
      slug: listings.slug,
      title: listings.title,
      vertical: listings.vertical,
      status: listings.status,
      price: listings.price,
      currency: listings.currency,
      commissionPct: listings.commissionPct,
      ownerId: listings.ownerId,
    })
    .from(listings)
    .where(listingScope(user))
    .orderBy(desc(listings.createdAt));
}


/** The vertical a listing belongs to — used when a booking request becomes a lead. */
export async function verticalOfListing(listingId: number): Promise<Vertical | null> {
  const [row] = await db
    .select({ vertical: listings.vertical })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  return row?.vertical ?? null;
}

/* -------------------------------------------------------------------------- */
/* Public browse + detail (plan §5.O11 — Sonnet never writes Drizzle)          */
/* -------------------------------------------------------------------------- */

export type BrowseFilters = {
  vertical: Vertical;
  /** Ciudad or barrio slug. A ciudad also matches every barrio under it. */
  locationSlug?: string | null;
  propertyType?: PropertyType | null;
  vehicleType?: VehicleType | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  /** Stay-only: minimum sleeping capacity. */
  guests?: number | null;
  bedrooms?: number | null;
  /** Car-only: minimum seats. */
  seats?: number | null;
  sort?: "recent" | "price_asc" | "price_desc";
  limit?: number;
};

export type BrowseResult = {
  id: number;
  slug: string;
  title: string;
  price: string;
  priceUnit: string;
  currency: string;
  locationName: string | null;
  locationSlug: string | null;
  coverUrl: string | null;
  propertyType: PropertyType | null;
  bedrooms: number | null;
  bathrooms: number | null;
  maxGuests: number | null;
  areaM2: number | null;
  vehicleType: VehicleType | null;
  make: string | null;
  model: string | null;
  year: number | null;
  transmission: string | null;
  seats: number | null;
};

/** Location ids a slug covers: the ciudad itself plus its barrios. */
export async function locationIdsForSlug(
  slug: string,
  executor: Executor = db,
): Promise<number[]> {
  const [row] = await executor
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  if (!row) return [];
  const children = await executor
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.parentId, row.id));
  return [row.id, ...children.map((child) => child.id)];
}

/**
 * The public browse query (#§5.O11). Only `published` listings ever come out of
 * here — the status check lives in the query, not in a caller's filter, so a
 * new page cannot accidentally leak a draft.
 */
export async function browseListings(
  filters: BrowseFilters,
  executor: Executor = db,
): Promise<BrowseResult[]> {
  const locationIds = filters.locationSlug
    ? await locationIdsForSlug(filters.locationSlug, executor)
    : null;
  // An unknown location slug matches nothing — never "everything".
  if (locationIds && locationIds.length === 0) return [];

  const rows = await executor
    .select({
      id: listings.id,
      slug: listings.slug,
      title: listings.title,
      price: listings.price,
      priceUnit: listings.priceUnit,
      currency: listings.currency,
      locationName: locations.name,
      locationSlug: locations.slug,
      propertyType: stayDetails.propertyType,
      bedrooms: stayDetails.bedrooms,
      bathrooms: stayDetails.bathrooms,
      maxGuests: stayDetails.maxGuests,
      areaM2: stayDetails.areaM2,
      vehicleType: carDetails.vehicleType,
      make: carDetails.make,
      model: carDetails.model,
      year: carDetails.year,
      transmission: carDetails.transmission,
      seats: carDetails.seats,
      publishedAt: listings.publishedAt,
    })
    .from(listings)
    .leftJoin(locations, eq(locations.id, listings.locationId))
    .leftJoin(stayDetails, eq(stayDetails.listingId, listings.id))
    .leftJoin(carDetails, eq(carDetails.listingId, listings.id))
    .where(
      and(
        eq(listings.vertical, filters.vertical),
        eq(listings.status, "published"),
        locationIds ? inArray(listings.locationId, locationIds) : undefined,
        filters.propertyType ? eq(stayDetails.propertyType, filters.propertyType) : undefined,
        filters.vehicleType ? eq(carDetails.vehicleType, filters.vehicleType) : undefined,
        filters.minPrice ? gte(listings.price, String(filters.minPrice)) : undefined,
        filters.maxPrice ? lte(listings.price, String(filters.maxPrice)) : undefined,
        filters.guests ? gte(stayDetails.maxGuests, filters.guests) : undefined,
        filters.bedrooms ? gte(stayDetails.bedrooms, filters.bedrooms) : undefined,
        filters.seats ? gte(carDetails.seats, filters.seats) : undefined,
      ),
    )
    .orderBy(
      filters.sort === "price_asc"
        ? asc(listings.price)
        : filters.sort === "price_desc"
          ? desc(listings.price)
          : desc(listings.publishedAt),
    )
    .limit(filters.limit ?? 60);
  if (rows.length === 0) return [];

  const covers = await executor
    .select({ listingId: listingImages.listingId, url: listingImages.url, isCover: listingImages.isCover })
    .from(listingImages)
    .where(inArray(listingImages.listingId, rows.map((row) => row.id)))
    .orderBy(desc(listingImages.isCover), asc(listingImages.sortOrder));
  const coverByListing = new Map<number, string>();
  for (const image of covers) {
    if (!coverByListing.has(image.listingId)) coverByListing.set(image.listingId, image.url);
  }

  return rows.map(({ publishedAt: _publishedAt, ...row }) => ({
    ...row,
    coverUrl: coverByListing.get(row.id) ?? null,
  }));
}

/** Ciudades with at least one published listing in a vertical — the filter menu. */
export async function browseLocations(vertical: Vertical, executor: Executor = db) {
  return executor
    .select({
      id: locations.id,
      name: locations.name,
      slug: locations.slug,
      parentId: locations.parentId,
      listings: sql<number>`COUNT(${listings.id})`,
    })
    .from(listings)
    .innerJoin(locations, eq(locations.id, listings.locationId))
    .where(and(eq(listings.vertical, vertical), eq(listings.status, "published")))
    .groupBy(locations.id, locations.name, locations.slug, locations.parentId)
    .orderBy(desc(sql`COUNT(${listings.id})`));
}

/**
 * One public listing with its typed details, images and info base.
 *
 * Returns `null` for anything not `published` — the public detail page must
 * never render a draft, and this is the single place that decides it.
 * `carDetails.plate` is deliberately NOT selected: it is private (plan §2).
 */
export async function getPublicListing(slug: string, executor: Executor = db) {
  const [row] = await executor
    .select({
      listing: listings,
      locationName: locations.name,
      locationSlug: locations.slug,
      stay: stayDetails,
      carVehicleType: carDetails.vehicleType,
      carMake: carDetails.make,
      carModel: carDetails.model,
      carYear: carDetails.year,
      carTransmission: carDetails.transmission,
      carFuel: carDetails.fuel,
      carSeats: carDetails.seats,
      carDailyKmLimit: carDetails.dailyKmLimit,
      carInsuranceTerms: carDetails.insuranceTerms,
    })
    .from(listings)
    .leftJoin(locations, eq(locations.id, listings.locationId))
    .leftJoin(stayDetails, eq(stayDetails.listingId, listings.id))
    .leftJoin(carDetails, eq(carDetails.listingId, listings.id))
    .where(and(eq(listings.slug, slug), eq(listings.status, "published")))
    .limit(1);
  if (!row) return null;

  const images = await executor
    .select()
    .from(listingImages)
    .where(eq(listingImages.listingId, row.listing.id))
    .orderBy(desc(listingImages.isCover), asc(listingImages.sortOrder));

  return { ...row, images };
}
