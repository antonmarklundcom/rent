/**
 * Extras (#10) and promo codes (#18) — the lookup half of the price engine.
 * The arithmetic lives in `src/lib/pricing.ts`; this file only fetches rows.
 */
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  extras,
  listings,
  promoCodes,
  type DiscountType,
  type ExtraScope,
  type Vertical,
} from "@/db/schema";
import type { Executor } from "@/db/queries/availability";
import { DomainError } from "@/lib/errors";
import { toMoney, toNumber } from "@/lib/money";
import type { ExtraSelection, PromoInput } from "@/lib/pricing";

/** Active extras offered for a listing: its own plus its vertical's. */
export async function listExtrasForListing(
  listing: { id: number; vertical: Vertical },
  executor: Executor = db,
) {
  return executor
    .select()
    .from(extras)
    .where(
      and(
        eq(extras.isActive, true),
        or(
          and(eq(extras.scope, "listing"), eq(extras.listingId, listing.id)),
          and(eq(extras.scope, "vertical"), eq(extras.vertical, listing.vertical)),
        ),
      ),
    )
    .orderBy(asc(extras.name));
}

export type ExtraRequest = { extraId: number; qty: number };

/**
 * Turn `{extraId, qty}` requests into priced selections, rejecting anything
 * that is not actually offered for this listing. Never trust a client id.
 */
export async function resolveExtraSelections(
  listing: { id: number; vertical: Vertical },
  requests: ExtraRequest[],
  executor: Executor = db,
): Promise<ExtraSelection[]> {
  if (requests.length === 0) return [];
  const offered = await listExtrasForListing(listing, executor);
  const byId = new Map(offered.map((extra) => [extra.id, extra]));
  return requests.map((request) => {
    const extra = byId.get(request.extraId);
    if (!extra) {
      throw new DomainError(
        "Ese adicional no está disponible para esta publicación",
        "extra_invalid",
        { extraId: request.extraId, listingId: listing.id },
      );
    }
    return {
      extraId: extra.id,
      name: extra.name,
      unitPrice: extra.price,
      qty: request.qty,
      perUnit: extra.perUnit,
    };
  });
}

async function findPromoByCode(
  code: string,
  executor: Executor = db,
): Promise<PromoInput | null> {
  const normalised = code.trim().toUpperCase();
  if (!normalised) return null;
  const [row] = await executor
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.code, normalised))
    .limit(1);
  return row ?? null;
}

/** Load a promo by code and fail loudly when it does not exist. */
export async function requirePromoByCode(
  code: string,
  executor: Executor = db,
): Promise<PromoInput> {
  const promo = await findPromoByCode(code, executor);
  if (!promo) {
    throw new DomainError(`El código ${code.trim().toUpperCase()} no existe`, "promo_invalid", {
      code,
    });
  }
  return promo;
}

/**
 * Claim one use of a promo. Conditional UPDATE, so two concurrent bookings can
 * never push `used_count` past `max_uses` — the row lock does the arbitration.
 */
export async function claimPromoUse(
  promoId: number,
  executor: Executor = db,
): Promise<void> {
  const result = await executor
    .update(promoCodes)
    .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
    .where(
      and(
        eq(promoCodes.id, promoId),
        eq(promoCodes.isActive, true),
        or(
          sql`${promoCodes.maxUses} is null`,
          sql`${promoCodes.usedCount} < ${promoCodes.maxUses}`,
        ),
      ),
    );
  const affected = (result as unknown as { affectedRows?: number }[])[0]?.affectedRows ?? 0;
  if (affected === 0) {
    throw new DomainError("El código promocional ya no tiene usos disponibles", "promo_exhausted", {
      promoId,
    });
  }
}

/** Give a use back when a booking that had claimed one is cancelled. */
export async function releasePromoUse(
  promoId: number,
  executor: Executor = db,
): Promise<void> {
  await executor
    .update(promoCodes)
    .set({ usedCount: sql`greatest(${promoCodes.usedCount} - 1, 0)` })
    .where(eq(promoCodes.id, promoId));
}

/* -------------------------------------------------------------------------- */
/* Admin CRUD (plan §5.O11 — every §3 feature reachable through the UI)        */
/* -------------------------------------------------------------------------- */

export async function listAllExtras(executor: Executor = db) {
  return executor
    .select({ extra: extras, listingTitle: listings.title })
    .from(extras)
    .leftJoin(listings, eq(listings.id, extras.listingId))
    .orderBy(asc(extras.scope), asc(extras.name));
}

export type UpsertExtraInput = {
  id?: number | null;
  name: string;
  description?: string | null;
  price: string;
  scope: ExtraScope;
  vertical?: Vertical | null;
  listingId?: number | null;
  perUnit?: boolean;
  isActive?: boolean;
};

export async function upsertExtra(
  input: UpsertExtraInput,
  executor: Executor = db,
): Promise<number> {
  const name = input.name.trim();
  if (name.length < 2) throw new DomainError("El nombre es demasiado corto", "invalid_amount");
  if (toNumber(input.price) < 0) {
    throw new DomainError("El precio no puede ser negativo", "invalid_amount");
  }
  // A `listing`-scoped extra without a listing would be offered to nobody; a
  // `vertical`-scoped one without a vertical would be offered to everybody.
  if (input.scope === "listing" && !input.listingId) {
    throw new DomainError("Elegí la publicación para este adicional", "extra_invalid");
  }
  if (input.scope === "vertical" && !input.vertical) {
    throw new DomainError("Elegí el vertical para este adicional", "extra_invalid");
  }

  const values = {
    name,
    description: input.description?.trim() || null,
    price: toMoney(input.price),
    scope: input.scope,
    vertical: input.scope === "vertical" ? (input.vertical ?? null) : null,
    listingId: input.scope === "listing" ? (input.listingId ?? null) : null,
    perUnit: input.perUnit ?? false,
    isActive: input.isActive ?? true,
  };

  if (input.id) {
    await executor.update(extras).set(values).where(eq(extras.id, input.id));
    return input.id;
  }
  const [inserted] = await executor.insert(extras).values(values).$returningId();
  return inserted?.id ?? 0;
}

export async function setExtraActive(
  id: number,
  isActive: boolean,
  executor: Executor = db,
): Promise<void> {
  await executor.update(extras).set({ isActive }).where(eq(extras.id, id));
}

export async function listPromoCodes(executor: Executor = db) {
  return executor.select().from(promoCodes).orderBy(desc(promoCodes.id));
}

export type UpsertPromoInput = {
  id?: number | null;
  code: string;
  discountType: DiscountType;
  discountValue: string;
  validFrom?: Date | null;
  validUntil?: Date | null;
  maxUses?: number | null;
  vertical?: Vertical | null;
  isActive?: boolean;
};

export async function upsertPromoCode(
  input: UpsertPromoInput,
  executor: Executor = db,
): Promise<number> {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,40}$/.test(code)) {
    throw new DomainError("El código usa letras, números y guiones (3 a 40)", "promo_invalid");
  }
  const value = toNumber(input.discountValue);
  if (value <= 0) {
    throw new DomainError("El descuento tiene que ser mayor que cero", "invalid_amount");
  }
  if (input.discountType === "percent" && value > 100) {
    throw new DomainError("Un descuento porcentual no puede pasar de 100", "invalid_amount");
  }
  if (input.validFrom && input.validUntil && input.validUntil <= input.validFrom) {
    throw new DomainError("La vigencia termina antes de empezar", "invalid_range");
  }

  const values = {
    code,
    discountType: input.discountType,
    discountValue: toMoney(input.discountValue),
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    maxUses: input.maxUses ?? null,
    vertical: input.vertical ?? null,
    isActive: input.isActive ?? true,
  };

  if (input.id) {
    await executor.update(promoCodes).set(values).where(eq(promoCodes.id, input.id));
    return input.id;
  }
  // `used_count` is deliberately never written here: editing a code must not
  // reset how many times it has already been redeemed.
  const [inserted] = await executor.insert(promoCodes).values(values).$returningId();
  return inserted?.id ?? 0;
}

export async function setPromoActive(
  id: number,
  isActive: boolean,
  executor: Executor = db,
): Promise<void> {
  await executor.update(promoCodes).set({ isActive }).where(eq(promoCodes.id, id));
}
