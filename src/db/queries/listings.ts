import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  carDetails,
  listingImages,
  listings,
  locations,
  stayDetails,
  type CancellationPolicy,
  type ListingStatus,
  type PriceUnit,
  type PropertyType,
  type VehicleType,
  type Vertical,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { listingScope } from "@/lib/scope";
import { AuthError, isAdmin, type SessionUser } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";
import { toMoney, toNumber } from "@/lib/money";
import { randomToken, slugify } from "@/lib/tokens";

/**
 * All Drizzle lives under `src/db/queries/` — Window 2 (Sonnet) consumes these
 * functions and never writes queries of its own (plan §5.O11).
 */
export type BrowseFilters = {
  /** Ciudad or barrio id — a ciudad matches its barrios too. */
  locationId?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  /** Stays: minimum sleeping capacity. */
  guests?: number | null;
  bedrooms?: number | null;
  propertyType?: PropertyType | null;
  /** Cars. */
  vehicleType?: VehicleType | null;
  seats?: number | null;
  limit?: number;
};

/**
 * The public browse query (plan §5.O11). Published listings only, filtered.
 *
 * A ciudad filter includes its barrios: somebody searching "Asunción" means the
 * city, and a listing filed under Villa Morra is in Asunción.
 */
export async function listPublishedListings(
  vertical: Vertical,
  filters: BrowseFilters = {},
  executor: Executor = db,
) {
  const locationFilter = filters.locationId
    ? or(
        eq(listings.locationId, filters.locationId),
        inArray(
          listings.locationId,
          executor
            .select({ id: locations.id })
            .from(locations)
            .where(eq(locations.parentId, filters.locationId)),
        ),
      )
    : undefined;

  return executor
    .select({
      id: listings.id,
      slug: listings.slug,
      title: listings.title,
      description: listings.description,
      price: listings.price,
      priceUnit: listings.priceUnit,
      currency: listings.currency,
      locationName: locations.name,
      locationId: listings.locationId,
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
    })
    .from(listings)
    .leftJoin(locations, eq(locations.id, listings.locationId))
    .leftJoin(stayDetails, eq(stayDetails.listingId, listings.id))
    .leftJoin(carDetails, eq(carDetails.listingId, listings.id))
    .where(
      and(
        eq(listings.vertical, vertical),
        eq(listings.status, "published"),
        locationFilter,
        filters.minPrice ? gte(listings.price, String(filters.minPrice)) : undefined,
        filters.maxPrice ? lte(listings.price, String(filters.maxPrice)) : undefined,
        filters.guests ? gte(stayDetails.maxGuests, filters.guests) : undefined,
        filters.bedrooms ? gte(stayDetails.bedrooms, filters.bedrooms) : undefined,
        filters.propertyType ? eq(stayDetails.propertyType, filters.propertyType) : undefined,
        filters.vehicleType ? eq(carDetails.vehicleType, filters.vehicleType) : undefined,
        filters.seats ? gte(carDetails.seats, filters.seats) : undefined,
      ),
    )
    .orderBy(desc(listings.publishedAt))
    .limit(filters.limit ?? 60);
}

/** Locations that actually have something published — the home page's links. */
export async function listLocationsWithListings(
  vertical?: Vertical,
  executor: Executor = db,
) {
  return executor
    .select({
      id: locations.id,
      name: locations.name,
      slug: locations.slug,
      parentId: locations.parentId,
      listingCount: sql<number>`count(${listings.id})`,
    })
    .from(locations)
    .innerJoin(
      listings,
      and(
        eq(listings.locationId, locations.id),
        eq(listings.status, "published"),
        vertical ? eq(listings.vertical, vertical) : undefined,
      ),
    )
    .groupBy(locations.id, locations.name, locations.slug, locations.parentId)
    .orderBy(sql`count(${listings.id}) desc`);
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

/* -------------------------------------------------------------------------- */
/* Owner-facing CRUD (plan §5.O10)                                             */
/* -------------------------------------------------------------------------- */

/**
 * The publish flow, decided in phase O-4 (plan §9).
 *
 * An owner moves their own listing between `draft` and `paused` freely, but
 * only an admin sets `published`. alquilar.com.py is a managed service
 * (plan §1.1): the operator's brand carries every listing, the onboarding
 * checklist treats "first listing published" as an operator milestone (#19),
 * and an owner publishing unreviewed copy and photos straight to the public
 * site is exactly what that model is meant to prevent. An owner asks; an admin
 * publishes.
 */
export const OWNER_SETTABLE_STATUSES: readonly ListingStatus[] = ["draft", "paused"];

export type ListingWriteInput = {
  title: string;
  description?: string | null;
  price: string;
  priceUnit: PriceUnit;
  currency?: string;
  locationId?: number | null;
  cancellationPolicy?: CancellationPolicy;
  /** Stay-only. */
  propertyType?: PropertyType;
  bedrooms?: number | null;
  bathrooms?: number | null;
  maxGuests?: number | null;
  areaM2?: number | null;
  /** Car-only. */
  vehicleType?: VehicleType;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  transmission?: string | null;
  fuel?: string | null;
  seats?: number | null;
  plate?: string | null;
  dailyKmLimit?: number | null;
};

function assertWritable(input: ListingWriteInput): void {
  if (input.title.trim().length < 4) {
    throw new DomainError("El título es demasiado corto", "invalid_amount");
  }
  if (toNumber(input.price) <= 0) {
    throw new DomainError("El precio tiene que ser mayor que cero", "invalid_amount");
  }
}

/** A slug that is unique even when two listings share a title. */
async function uniqueSlug(title: string, executor: Executor): Promise<string> {
  const base = slugify(title) || "publicacion";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await executor
      .select({ id: listings.id })
      .from(listings)
      .where(eq(listings.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  return `${base}-${randomToken(4)}`;
}

/**
 * Create a listing with its typed detail row, in one transaction: a `listings`
 * row whose `stay_details`/`car_details` sibling failed to insert would break
 * every read that joins them.
 */
export async function createListing(
  input: ListingWriteInput & { vertical: Vertical; ownerId: number },
  actor: SessionUser,
): Promise<typeof listings.$inferSelect> {
  assertWritable(input);
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(input.title, tx);
    await tx.insert(listings).values({
      slug,
      vertical: input.vertical,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      price: toMoney(input.price),
      priceUnit: input.priceUnit,
      currency: input.currency ?? "PYG",
      locationId: input.locationId ?? null,
      status: "draft",
      ownerId: input.ownerId,
      cancellationPolicy: input.cancellationPolicy ?? "moderate",
      icalExportToken: randomToken(24),
      updatedBy: actor.id,
    });
    const [row] = await tx.select().from(listings).where(eq(listings.slug, slug)).limit(1);
    if (!row) throw new DomainError("No se pudo crear la publicación", "not_found");

    if (input.vertical === "stay") {
      await tx.insert(stayDetails).values({
        listingId: row.id,
        propertyType: input.propertyType ?? "casa",
        bedrooms: input.bedrooms ?? null,
        bathrooms: input.bathrooms ?? null,
        maxGuests: input.maxGuests ?? null,
        areaM2: input.areaM2 ?? null,
      });
    } else {
      await tx.insert(carDetails).values({
        listingId: row.id,
        vehicleType: input.vehicleType ?? "auto",
        make: input.make ?? null,
        model: input.model ?? null,
        year: input.year ?? null,
        transmission: input.transmission ?? null,
        fuel: input.fuel ?? null,
        seats: input.seats ?? null,
        plate: input.plate ?? null,
        dailyKmLimit: input.dailyKmLimit ?? null,
      });
    }

    await logActivity(
      {
        entity: "listing",
        entityId: row.id,
        action: "listing.created",
        userId: actor.id,
        meta: { slug, vertical: input.vertical, ownerId: input.ownerId },
      },
      tx,
    );
    return row;
  });
}

/** Edit a listing. The caller has already scoped it with `assertCanAccessListing`. */
export async function updateListing(
  listingId: number,
  input: ListingWriteInput,
  actor: SessionUser,
): Promise<void> {
  assertWritable(input);
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(listings).where(eq(listings.id, listingId)).limit(1);
    if (!current) {
      throw new DomainError("La publicación no existe", "not_found", { listingId });
    }
    await tx
      .update(listings)
      .set({
        title: input.title.trim(),
        description: input.description?.trim() || null,
        price: toMoney(input.price),
        priceUnit: input.priceUnit,
        locationId: input.locationId ?? null,
        cancellationPolicy: input.cancellationPolicy ?? current.cancellationPolicy,
        updatedBy: actor.id,
      })
      .where(eq(listings.id, listingId));

    if (current.vertical === "stay") {
      await tx
        .update(stayDetails)
        .set({
          propertyType: input.propertyType ?? "casa",
          bedrooms: input.bedrooms ?? null,
          bathrooms: input.bathrooms ?? null,
          maxGuests: input.maxGuests ?? null,
          areaM2: input.areaM2 ?? null,
        })
        .where(eq(stayDetails.listingId, listingId));
    } else {
      await tx
        .update(carDetails)
        .set({
          vehicleType: input.vehicleType ?? "auto",
          make: input.make ?? null,
          model: input.model ?? null,
          year: input.year ?? null,
          transmission: input.transmission ?? null,
          fuel: input.fuel ?? null,
          seats: input.seats ?? null,
          plate: input.plate ?? null,
          dailyKmLimit: input.dailyKmLimit ?? null,
        })
        .where(eq(carDetails.listingId, listingId));
    }

    await logActivity(
      {
        entity: "listing",
        entityId: listingId,
        action: "listing.updated",
        userId: actor.id,
        meta: { price: toMoney(input.price) },
      },
      tx,
    );
  });
}

/** Publish/pause. Only an admin may reach `published` — see the note above. */
export async function setListingStatus(
  listingId: number,
  status: ListingStatus,
  actor: SessionUser,
): Promise<void> {
  if (!isAdmin(actor) && !OWNER_SETTABLE_STATUSES.includes(status)) {
    throw new AuthError(
      "Un administrador revisa y publica la publicación. Podés dejarla lista como borrador.",
      "forbidden",
    );
  }
  const [current] = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  if (!current) {
    throw new DomainError("La publicación no existe", "not_found", { listingId });
  }
  await db
    .update(listings)
    .set({
      status,
      // `published_at` is stamped once, on the first publication: it is the
      // listing's age on the public site, not the date of the last edit.
      publishedAt:
        status === "published" ? (current.publishedAt ?? new Date()) : current.publishedAt,
      updatedBy: actor.id,
    })
    .where(eq(listings.id, listingId));
  await logActivity({
    entity: "listing",
    entityId: listingId,
    action: `listing.${status}`,
    userId: actor.id,
    meta: { from: current.status },
  });
}

/** One listing with its typed detail row — the edit form and the public page. */
export async function getListingDetail(listingId: number, executor: Executor = db) {
  const [row] = await executor
    .select({
      listing: listings,
      stay: stayDetails,
      car: carDetails,
      locationName: locations.name,
      locationSlug: locations.slug,
      locationParentId: locations.parentId,
    })
    .from(listings)
    .leftJoin(stayDetails, eq(stayDetails.listingId, listings.id))
    .leftJoin(carDetails, eq(carDetails.listingId, listings.id))
    .leftJoin(locations, eq(locations.id, listings.locationId))
    .where(eq(listings.id, listingId))
    .limit(1);
  return row ?? null;
}

export async function getListingDetailBySlug(slug: string, executor: Executor = db) {
  const [row] = await executor
    .select({ id: listings.id })
    .from(listings)
    .where(eq(listings.slug, slug))
    .limit(1);
  return row ? getListingDetail(row.id, executor) : null;
}

export async function listListingImages(listingId: number, executor: Executor = db) {
  return executor
    .select()
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId))
    .orderBy(desc(listingImages.isCover), asc(listingImages.sortOrder), asc(listingImages.id));
}

/** Ciudades with their barrios — the location picker and the SEO route map. */
export async function listLocations(executor: Executor = db) {
  return executor.select().from(locations).orderBy(asc(locations.parentId), asc(locations.name));
}
