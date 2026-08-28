import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { carDetails, listings, locations, stayDetails, type Vertical } from "@/db/schema";
import { listingScope } from "@/lib/scope";
import type { SessionUser } from "@/lib/auth-core";

/**
 * All Drizzle lives under `src/db/queries/` — Window 2 (Sonnet) consumes these
 * functions and never writes queries of its own (plan §5.O11).
 */
export async function listPublishedListings(vertical: Vertical) {
  return db
    .select({
      id: listings.id,
      slug: listings.slug,
      title: listings.title,
      price: listings.price,
      priceUnit: listings.priceUnit,
      currency: listings.currency,
      locationName: locations.name,
      propertyType: stayDetails.propertyType,
      vehicleType: carDetails.vehicleType,
    })
    .from(listings)
    .leftJoin(locations, eq(locations.id, listings.locationId))
    .leftJoin(stayDetails, eq(stayDetails.listingId, listings.id))
    .leftJoin(carDetails, eq(carDetails.listingId, listings.id))
    .where(and(eq(listings.vertical, vertical), eq(listings.status, "published")))
    .orderBy(desc(listings.publishedAt));
}

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

export async function getListingBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(listings)
    .where(eq(listings.slug, slug))
    .limit(1);
  return row ?? null;
}
