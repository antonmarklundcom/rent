/**
 * Price and commission calculators (plan §5.O4 + §5.O7).
 *
 * Pure and database-free so `scripts/verify-logic.ts` can pin the arithmetic
 * without a MySQL instance. Every amount in and out is a `decimal(14,2)`
 * string handled through `src/lib/money.ts` — never a bare float (plan §9,
 * O-1 judgment call 2).
 *
 * The two money decisions this file encodes, both recorded in plan §9:
 *
 *   1. A promo discount applies to the BASE total only. Extras are ancillary
 *      services sold at cost alongside the rental; discounting them would let
 *      a percentage code give away a transfer or a GPS for free.
 *   2. Commission is charged on the OWNER GROSS = base − discount. Extras are
 *      the operator's own service revenue and never enter the owner's gross,
 *      so they are neither paid out nor commissioned. `COMMISSION_BASE`
 *      isolates that choice in one function: changing it later is a one-line
 *      edit plus a re-generation of unbilled statements, not a rewrite.
 */
import {
  PRICE_UNITS,
  type Vertical,
  type PriceUnit,
} from "@/db/schema";
import { assertValidRange, daysBetween, monthsBetween, nightsBetween } from "@/lib/dates";
import { DomainError } from "@/lib/errors";
import { addMoney, multiplyMoney, percentOf, toMoney, toNumber } from "@/lib/money";

/* -------------------------------------------------------------------------- */
/* Units                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Billable units for a range. `per_night` counts calendar nights (a stay), and
 * `per_day` counts started 24h periods (a car handed back late costs a day).
 */
export function computeUnits(priceUnit: PriceUnit, startAt: Date, endAt: Date): number {
  switch (priceUnit) {
    case "per_night":
      return nightsBetween(startAt, endAt);
    case "per_day":
      return daysBetween(startAt, endAt);
    case "per_month":
      return monthsBetween(startAt, endAt);
    default: {
      const exhaustive: never = priceUnit;
      throw new DomainError(
        `Unidad de precio desconocida: ${String(exhaustive)}`,
        "invalid_range",
      );
    }
  }
}

export function isPriceUnit(value: string): value is PriceUnit {
  return (PRICE_UNITS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/* Extras (#10)                                                                */
/* -------------------------------------------------------------------------- */

/** The shape the calculator needs from an `extras` row plus a chosen qty. */
export type ExtraSelection = {
  extraId: number;
  name: string;
  unitPrice: string;
  qty: number;
  /** `extras.per_unit` — multiply by the booking's units as well as by qty. */
  perUnit: boolean;
};

export type PricedExtraLine = ExtraSelection & { lineTotal: string };

export function priceExtraLine(extra: ExtraSelection, units: number): PricedExtraLine {
  if (!Number.isInteger(extra.qty) || extra.qty < 1) {
    throw new DomainError(
      `Cantidad inválida para "${extra.name}"`,
      "extra_invalid",
      { extraId: extra.extraId, qty: extra.qty },
    );
  }
  const multiplier = extra.perUnit ? extra.qty * units : extra.qty;
  return { ...extra, lineTotal: multiplyMoney(extra.unitPrice, multiplier) };
}

/* -------------------------------------------------------------------------- */
/* Promo codes (#18)                                                           */
/* -------------------------------------------------------------------------- */

/** The shape the calculator needs from a `promo_codes` row. */
export type PromoInput = {
  id: number;
  code: string;
  discountType: "percent" | "fixed";
  discountValue: string;
  validFrom: Date | null;
  validUntil: Date | null;
  maxUses: number | null;
  usedCount: number;
  vertical: Vertical | null;
  isActive: boolean;
};

/**
 * Validate a promo against the booking it is being applied to. Throws a
 * `DomainError` whose code names the exact reason — the caller renders it.
 */
export function assertPromoUsable(
  promo: PromoInput,
  context: { vertical: Vertical; now?: Date },
): void {
  const now = context.now ?? new Date();
  if (!promo.isActive) {
    throw new DomainError(`El código ${promo.code} no está activo`, "promo_invalid", {
      code: promo.code,
    });
  }
  if (promo.validFrom && now.getTime() < promo.validFrom.getTime()) {
    throw new DomainError(`El código ${promo.code} todavía no es válido`, "promo_expired", {
      code: promo.code,
      validFrom: promo.validFrom,
    });
  }
  if (promo.validUntil && now.getTime() >= promo.validUntil.getTime()) {
    throw new DomainError(`El código ${promo.code} venció`, "promo_expired", {
      code: promo.code,
      validUntil: promo.validUntil,
    });
  }
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
    throw new DomainError(
      `El código ${promo.code} alcanzó su límite de usos`,
      "promo_exhausted",
      { code: promo.code, maxUses: promo.maxUses, usedCount: promo.usedCount },
    );
  }
  if (promo.vertical && promo.vertical !== context.vertical) {
    throw new DomainError(
      `El código ${promo.code} no aplica a esta categoría`,
      "promo_wrong_vertical",
      { code: promo.code, promoVertical: promo.vertical, vertical: context.vertical },
    );
  }
  if (promo.discountType === "percent") {
    const pct = toNumber(promo.discountValue);
    if (pct <= 0 || pct > 100) {
      throw new DomainError(
        `El descuento de ${promo.code} es inválido (${promo.discountValue}%)`,
        "promo_invalid",
        { code: promo.code },
      );
    }
  } else if (toNumber(promo.discountValue) <= 0) {
    throw new DomainError(
      `El descuento de ${promo.code} es inválido`,
      "promo_invalid",
      { code: promo.code },
    );
  }
}

/**
 * Discount amount for a promo, clamped to the base total — a fixed code larger
 * than the stay never produces a negative booking, and never eats the extras.
 */
export function discountFor(promo: PromoInput | null, baseTotal: string): string {
  if (!promo) return toMoney(0);
  const raw =
    promo.discountType === "percent"
      ? percentOf(baseTotal, promo.discountValue)
      : toMoney(promo.discountValue);
  return toNumber(raw) > toNumber(baseTotal) ? toMoney(baseTotal) : raw;
}

/* -------------------------------------------------------------------------- */
/* Booking price                                                               */
/* -------------------------------------------------------------------------- */

export type PriceQuoteInput = {
  vertical: Vertical;
  priceUnit: PriceUnit;
  unitPrice: string;
  startAt: Date;
  endAt: Date;
  extras?: ExtraSelection[];
  promo?: PromoInput | null;
  now?: Date;
};

export type PriceQuote = {
  unitPrice: string;
  units: number;
  baseTotal: string;
  extrasTotal: string;
  discountTotal: string;
  total: string;
  /** Owner-facing gross: what the commission is charged on. */
  ownerGross: string;
  extraLines: PricedExtraLine[];
  promoId: number | null;
};

/**
 * The single price calculator (plan §5.O4): base × units + extras − discount.
 * The result is snapshotted onto the booking and never recomputed afterwards.
 */
export function quoteBooking(input: PriceQuoteInput): PriceQuote {
  if (toNumber(input.unitPrice) < 0) {
    throw new DomainError("El precio no puede ser negativo", "invalid_amount");
  }
  // Validate the range here as well as in the data layer: a quote is served to
  // the public before anything is written, so an inverted range must be
  // rejected by the calculator itself, not only by the availability check.
  assertValidRange(input.startAt, input.endAt);
  const units = computeUnits(input.priceUnit, input.startAt, input.endAt);
  const unitPrice = toMoney(input.unitPrice);
  const baseTotal = multiplyMoney(unitPrice, units);

  const extraLines = (input.extras ?? []).map((extra) => priceExtraLine(extra, units));
  const extrasTotal = addMoney(...extraLines.map((line) => line.lineTotal));

  let promo = input.promo ?? null;
  if (promo) {
    assertPromoUsable(promo, { vertical: input.vertical, now: input.now });
  } else {
    promo = null;
  }
  const discountTotal = discountFor(promo, baseTotal);

  const ownerGross = toMoney(toNumber(baseTotal) - toNumber(discountTotal));
  const total = addMoney(ownerGross, extrasTotal);

  return {
    unitPrice,
    units,
    baseTotal,
    extrasTotal,
    discountTotal,
    total,
    ownerGross,
    extraLines,
    promoId: promo?.id ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Commission (#3)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The commission base for one booking. Isolated deliberately: see the header.
 * Takes the snapshot columns so it works on a stored booking as well as a quote.
 */
export function COMMISSION_BASE(booking: {
  baseTotal: string;
  discountTotal: string;
  extrasTotal?: string;
}): string {
  return toMoney(toNumber(booking.baseTotal) - toNumber(booking.discountTotal));
}

/** Listing override → owner default (plan §5.O7). Never guesses a rate. */
export function resolveCommissionPct(
  listingCommissionPct: string | null | undefined,
  ownerDefaultCommissionPct: string | null | undefined,
): string {
  const listing = listingCommissionPct?.trim();
  if (listing !== undefined && listing !== "") return toMoney(listing);
  const owner = ownerDefaultCommissionPct?.trim();
  if (owner !== undefined && owner !== "") return toMoney(owner);
  throw new DomainError(
    "No hay comisión configurada para esta publicación ni para el propietario",
    "invalid_amount",
  );
}

export type CommissionResult = {
  commissionPct: string;
  commissionBase: string;
  commissionAmount: string;
  /** What the owner is owed for this booking before expenses. */
  ownerNet: string;
};

export function computeCommission(
  booking: { baseTotal: string; discountTotal: string; extrasTotal?: string },
  commissionPct: string,
): CommissionResult {
  const pct = toNumber(commissionPct);
  if (pct < 0 || pct > 100) {
    throw new DomainError(`Comisión fuera de rango: ${commissionPct}%`, "invalid_amount");
  }
  const commissionBase = COMMISSION_BASE(booking);
  const commissionAmount = percentOf(commissionBase, commissionPct);
  return {
    commissionPct: toMoney(commissionPct),
    commissionBase,
    commissionAmount,
    ownerNet: toMoney(toNumber(commissionBase) - toNumber(commissionAmount)),
  };
}
