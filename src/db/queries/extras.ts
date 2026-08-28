/**
 * Extras (#10) and promo codes (#18) — the lookup half of the price engine.
 * The arithmetic lives in `src/lib/pricing.ts`; this file only fetches rows.
 */
import { and, asc, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { extras, promoCodes, type Vertical } from "@/db/schema";
import type { Executor } from "@/db/queries/availability";
import { DomainError } from "@/lib/errors";
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
/* Admin reads (#10, #18) — what is on offer and what has been used            */
/* -------------------------------------------------------------------------- */

/** Every extra, including inactive ones — the admin catalogue. */
export async function listAllExtras(executor: Executor = db) {
  return executor.select().from(extras).orderBy(asc(extras.scope), asc(extras.name));
}

/** Every promo code with its usage — `used_count` is claimed at booking (#18). */
export async function listPromoCodes(executor: Executor = db) {
  return executor.select().from(promoCodes).orderBy(asc(promoCodes.code));
}
