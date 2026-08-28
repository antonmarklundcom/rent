/**
 * The booking engine (plan §5.O4).
 *
 * One create path, one transition path, both wrapped in a transaction that
 * takes the availability lock before it writes. Web requests, admin manual
 * bookings and any future importer go through these functions — nothing else
 * inserts into `bookings`.
 */
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bookingExtras,
  bookings,
  carDetails,
  listings,
  owners,
  stayDetails,
  type BookingSource,
  type BookingStatus,
  type CancellationPolicy,
  type Vertical,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import { assertAvailable, type Executor } from "@/db/queries/availability";
import {
  claimPromoUse,
  releasePromoUse,
  requirePromoByCode,
  resolveExtraSelections,
  type ExtraRequest,
} from "@/db/queries/extras";
import type { SessionUser } from "@/lib/auth-core";
import {
  assertTransition,
  occupiesCalendar,
  transitionClaimsDates,
  transitionReleasesDates,
} from "@/lib/booking-state";
import { assertValidRange, atClock, parseYmd } from "@/lib/dates";
import { DomainError } from "@/lib/errors";
import {
  computeCommission,
  quoteBooking,
  resolveCommissionPct,
  type PriceQuote,
} from "@/lib/pricing";
import { bookingReference } from "@/lib/tokens";

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

export type BookingContext = {
  listing: typeof listings.$inferSelect;
  vertical: Vertical;
  checkInTime: string;
  checkOutTime: string;
  ownerDefaultCommissionPct: string | null;
};

/** Everything the price and availability engines need about one listing. */
async function loadBookingContext(
  listingId: number,
  executor: Executor = db,
): Promise<BookingContext> {
  const [row] = await executor
    .select({
      listing: listings,
      checkInTime: stayDetails.checkInTime,
      checkOutTime: stayDetails.checkOutTime,
      ownerDefaultCommissionPct: owners.defaultCommissionPct,
    })
    .from(listings)
    .leftJoin(stayDetails, eq(stayDetails.listingId, listings.id))
    .leftJoin(owners, eq(owners.id, listings.ownerId))
    .where(eq(listings.id, listingId))
    .limit(1);

  if (!row) {
    throw new DomainError("La publicación no existe", "not_found", { listingId });
  }
  return {
    listing: row.listing,
    vertical: row.listing.vertical,
    checkInTime: row.checkInTime ?? "14:00",
    checkOutTime: row.checkOutTime ?? "11:00",
    ownerDefaultCommissionPct: row.ownerDefaultCommissionPct,
  };
}

/** The public surface only ever touches published listings. */
function assertBookable(context: BookingContext, requirePublished?: boolean): void {
  if (requirePublished && context.listing.status !== "published") {
    throw new DomainError(
      "Esta publicación no está disponible",
      "listing_unbookable",
      { listingId: context.listing.id, listingStatus: context.listing.status },
    );
  }
}

/**
 * Normalise a requested range into the UTC datetime range the engine stores
 * (plan §9, O-1 judgment call 1). Stays may be given as `YYYY-MM-DD` and are
 * materialised at the listing's check-in/check-out clock times; cars are
 * always given as instants.
 */
function normaliseRange(
  context: Pick<BookingContext, "vertical" | "checkInTime" | "checkOutTime">,
  input: { startAt: Date | string; endAt: Date | string },
): { startAt: Date; endAt: Date } {
  const toDate = (value: Date | string, clock: string): Date => {
    if (value instanceof Date) return value;
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return atClock(parseYmd(trimmed), clock);
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new DomainError(`Fecha inválida: ${value}`, "invalid_range", { value });
    }
    return parsed;
  };
  const startAt = toDate(input.startAt, context.vertical === "stay" ? context.checkInTime : "00:00");
  const endAt = toDate(input.endAt, context.vertical === "stay" ? context.checkOutTime : "00:00");
  return assertValidRange(startAt, endAt);
}

/* -------------------------------------------------------------------------- */
/* Quoting                                                                     */
/* -------------------------------------------------------------------------- */

export type QuoteRequest = {
  listingId: number;
  startAt: Date | string;
  endAt: Date | string;
  extras?: ExtraRequest[];
  promoCode?: string | null;
  now?: Date;
  /**
   * Refuse anything but a `published` listing. Set by the PUBLIC actions only:
   * a draft listing must not be priceable by a stranger who guessed its id,
   * while an operator may legitimately record a booking on a listing that is
   * still being onboarded.
   */
  requirePublished?: boolean;
};

export type BookingQuote = PriceQuote & {
  listingId: number;
  currency: string;
  startAt: Date;
  endAt: Date;
  commissionPct: string;
  commissionAmount: string;
  ownerNet: string;
  cancellationPolicy: CancellationPolicy;
};

/**
 * Price a prospective booking without writing anything — the public detail
 * page and the admin form both quote before they submit.
 */
export async function quoteForListing(
  request: QuoteRequest,
  executor: Executor = db,
): Promise<BookingQuote> {
  const context = await loadBookingContext(request.listingId, executor);
  assertBookable(context, request.requirePublished);
  const { startAt, endAt } = normaliseRange(context, request);

  const extras = await resolveExtraSelections(
    { id: context.listing.id, vertical: context.vertical },
    request.extras ?? [],
    executor,
  );
  const promo = request.promoCode
    ? await requirePromoByCode(request.promoCode, executor)
    : null;

  const quote = quoteBooking({
    vertical: context.vertical,
    priceUnit: context.listing.priceUnit,
    unitPrice: context.listing.price,
    startAt,
    endAt,
    extras,
    promo,
    now: request.now,
  });
  const commissionPct = resolveCommissionPct(
    context.listing.commissionPct,
    context.ownerDefaultCommissionPct,
  );
  const commission = computeCommission(quote, commissionPct);

  return {
    ...quote,
    listingId: context.listing.id,
    currency: context.listing.currency,
    startAt,
    endAt,
    commissionPct: commission.commissionPct,
    commissionAmount: commission.commissionAmount,
    ownerNet: commission.ownerNet,
    cancellationPolicy: context.listing.cancellationPolicy,
  };
}

/* -------------------------------------------------------------------------- */
/* Creating                                                                    */
/* -------------------------------------------------------------------------- */

export type CreateBookingInput = {
  listingId: number;
  guestName: string;
  guestPhone?: string | null;
  guestEmail?: string | null;
  startAt: Date | string;
  endAt: Date | string;
  /** `inquiry` (public request) or `confirmed` (admin books it outright). */
  status?: Extract<BookingStatus, "inquiry" | "confirmed">;
  source?: BookingSource;
  extras?: ExtraRequest[];
  promoCode?: string | null;
  guestCount?: number | null;
  notes?: string | null;
  now?: Date;
  /** See `QuoteRequest.requirePublished` — set by the public actions only. */
  requirePublished?: boolean;
};

export type CreatedBooking = {
  booking: typeof bookings.$inferSelect;
  quote: BookingQuote;
};

/**
 * Create a booking.
 *
 * An `inquiry` is a lead and does NOT hold dates, so it is only price-checked.
 * Anything that occupies the calendar is inserted inside a transaction that
 * first takes `FOR UPDATE` locks over the conflicting range — the check and
 * the insert cannot be interleaved by a second request.
 */
export async function createBooking(
  input: CreateBookingInput,
  actor?: SessionUser | null,
): Promise<CreatedBooking> {
  const status = input.status ?? "inquiry";
  const guestName = input.guestName.trim();
  if (!guestName) {
    throw new DomainError("Falta el nombre del huésped", "invalid_amount");
  }

  return db.transaction(async (tx) => {
    const context = await loadBookingContext(input.listingId, tx);
    assertBookable(context, input.requirePublished);
    const { startAt, endAt } = normaliseRange(context, input);

    if (occupiesCalendar(status)) {
      await assertAvailable(
        { listingId: context.listing.id, startAt, endAt, lock: true },
        tx,
      );
    }

    const extras = await resolveExtraSelections(
      { id: context.listing.id, vertical: context.vertical },
      input.extras ?? [],
      tx,
    );
    const promo = input.promoCode ? await requirePromoByCode(input.promoCode, tx) : null;
    const priced = quoteBooking({
      vertical: context.vertical,
      priceUnit: context.listing.priceUnit,
      unitPrice: context.listing.price,
      startAt,
      endAt,
      extras,
      promo,
      now: input.now,
    });
    const commissionPct = resolveCommissionPct(
      context.listing.commissionPct,
      context.ownerDefaultCommissionPct,
    );
    const commission = computeCommission(priced, commissionPct);

    if (promo) await claimPromoUse(promo.id, tx);

    const inserted = await insertBookingRow(tx, {
      listingId: context.listing.id,
      guestName,
      guestPhone: input.guestPhone?.trim() || null,
      guestEmail: input.guestEmail?.trim().toLowerCase() || null,
      startAt,
      endAt,
      status,
      unitPrice: priced.unitPrice,
      units: priced.units,
      baseTotal: priced.baseTotal,
      extrasTotal: priced.extrasTotal,
      discountTotal: priced.discountTotal,
      total: priced.total,
      currency: context.listing.currency,
      commissionPct: commission.commissionPct,
      commissionAmount: commission.commissionAmount,
      source: input.source ?? "web",
      promoCodeId: priced.promoId,
      cancellationPolicy: context.listing.cancellationPolicy,
      guestCount: input.guestCount ?? null,
      notes: input.notes?.trim() || null,
      createdBy: actor?.id ?? null,
    });

    if (priced.extraLines.length > 0) {
      await tx.insert(bookingExtras).values(
        priced.extraLines.map((line) => ({
          bookingId: inserted.id,
          extraId: line.extraId,
          nameSnapshot: line.name,
          unitPrice: line.unitPrice,
          qty: line.qty,
          lineTotal: line.lineTotal,
        })),
      );
    }

    await logActivity(
      {
        entity: "booking",
        entityId: inserted.id,
        action: `booking.created.${status}`,
        userId: actor?.id ?? null,
        meta: {
          reference: inserted.reference,
          listingId: context.listing.id,
          total: priced.total,
          commissionAmount: commission.commissionAmount,
          promoCodeId: priced.promoId,
        },
      },
      tx,
    );

    return {
      booking: inserted,
      quote: {
        ...priced,
        listingId: context.listing.id,
        currency: context.listing.currency,
        startAt,
        endAt,
        commissionPct: commission.commissionPct,
        commissionAmount: commission.commissionAmount,
        ownerNet: commission.ownerNet,
        cancellationPolicy: context.listing.cancellationPolicy,
      },
    };
  });
}

/** Insert with a fresh reference, retrying the (astronomically rare) collision. */
async function insertBookingRow(
  tx: Executor,
  values: Omit<typeof bookings.$inferInsert, "reference">,
): Promise<typeof bookings.$inferSelect> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = bookingReference();
    try {
      await tx.insert(bookings).values({ ...values, reference });
      const [row] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.reference, reference))
        .limit(1);
      if (row) return row;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "ER_DUP_ENTRY") throw error;
    }
  }
  throw new DomainError("No se pudo generar una referencia de reserva", "invalid_amount");
}

/* -------------------------------------------------------------------------- */
/* Transitions                                                                 */
/* -------------------------------------------------------------------------- */

export type TransitionResult = {
  booking: typeof bookings.$inferSelect;
  from: BookingStatus;
  to: BookingStatus;
};

/**
 * Move a booking through the state machine (`src/lib/booking-state.ts`).
 *
 * Claiming dates (inquiry → confirmed) re-runs the availability check under a
 * lock: an inquiry never held the calendar, so the dates may well be gone.
 * Releasing them (→ cancelled) hands a promo use back.
 */
export async function transitionBooking(
  bookingId: number,
  to: BookingStatus,
  actor?: SessionUser | null,
  options: { reason?: string } = {},
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1)
      .for("update");
    if (!current) {
      throw new DomainError("La reserva no existe", "not_found", { bookingId });
    }
    const from = current.status;
    assertTransition(from, to);

    const patch: Partial<typeof bookings.$inferInsert> = { status: to };

    if (transitionClaimsDates(from, to)) {
      await assertAvailable(
        {
          listingId: current.listingId,
          startAt: current.startAt,
          endAt: current.endAt,
          excludeBookingId: current.id,
          lock: true,
        },
        tx,
      );
      // The commission rate is re-resolved at confirmation (plan §5.O2): an
      // inquiry can sit for weeks and the contracted rate may have moved.
      const context = await loadBookingContext(current.listingId, tx);
      const commissionPct = resolveCommissionPct(
        context.listing.commissionPct,
        context.ownerDefaultCommissionPct,
      );
      const commission = computeCommission(current, commissionPct);
      patch.commissionPct = commission.commissionPct;
      patch.commissionAmount = commission.commissionAmount;
    }

    if (transitionReleasesDates(from, to) || (to === "cancelled" && current.promoCodeId)) {
      if (current.promoCodeId) await releasePromoUse(current.promoCodeId, tx);
    }

    await tx.update(bookings).set(patch).where(eq(bookings.id, current.id));
    const [updated] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, current.id))
      .limit(1);

    await logActivity(
      {
        entity: "booking",
        entityId: current.id,
        action: `booking.${to}`,
        userId: actor?.id ?? null,
        meta: {
          reference: current.reference,
          from,
          to,
          reason: options.reason ?? null,
          commissionAmount: patch.commissionAmount ?? current.commissionAmount,
        },
      },
      tx,
    );

    return { booking: updated ?? current, from, to };
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function getBookingById(bookingId: number, executor: Executor = db) {
  const [row] = await executor
    .select({
      booking: bookings,
      listingTitle: listings.title,
      listingSlug: listings.slug,
      vertical: listings.vertical,
      ownerId: listings.ownerId,
    })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row ?? null;
}

export async function getBookingByReference(reference: string, executor: Executor = db) {
  const [row] = await executor
    .select()
    .from(bookings)
    .where(eq(bookings.reference, reference.trim().toUpperCase()))
    .limit(1);
  return row ?? null;
}

export async function listBookingExtras(bookingId: number, executor: Executor = db) {
  return executor
    .select()
    .from(bookingExtras)
    .where(eq(bookingExtras.bookingId, bookingId))
    .orderBy(asc(bookingExtras.id));
}

/** Bookings for a set of listings — callers scope the ids with `src/lib/scope.ts`. */
export async function listBookingsForListings(
  listingIds: number[],
  options: { statuses?: BookingStatus[]; from?: Date; limit?: number } = {},
  executor: Executor = db,
) {
  if (listingIds.length === 0) return [];
  return executor
    .select({
      booking: bookings,
      listingTitle: listings.title,
      vertical: listings.vertical,
    })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(
      and(
        inArray(bookings.listingId, listingIds),
        options.statuses?.length ? inArray(bookings.status, options.statuses) : undefined,
        options.from ? gte(bookings.endAt, options.from) : undefined,
      ),
    )
    .orderBy(desc(bookings.startAt))
    .limit(options.limit ?? 200);
}
