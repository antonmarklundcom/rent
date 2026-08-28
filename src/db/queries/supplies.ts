/**
 * Inventory & supplies (#17, plan §5.O6).
 *
 * Stock is per (supply, listing). A completed cleaning task consumes
 * `supplies.consumed_per_cleaning` units at that listing — the decrement runs
 * inside the task's own transaction, so "the task is ready" and "the towels
 * are gone" are one fact, not two that can disagree.
 *
 * Stock never goes negative: a level that would go below zero is clamped at 0
 * and reported as a shortfall. A cleaner who used the last towel should see a
 * low-stock alert, not a task that refuses to close.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { listings, supplies, supplyLevels } from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { inTransaction } from "@/db/queries/tx";
import type { SessionUser } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                   */
/* -------------------------------------------------------------------------- */

export type UpsertSupplyInput = {
  name: string;
  unit?: string;
  consumedPerCleaning?: number;
};

export async function upsertSupply(
  input: UpsertSupplyInput,
  executor: Executor = db,
): Promise<typeof supplies.$inferSelect> {
  const name = input.name.trim();
  if (!name) throw new DomainError("El insumo necesita un nombre", "invalid_amount");
  const consumed = Math.max(0, Math.trunc(input.consumedPerCleaning ?? 0));
  await executor
    .insert(supplies)
    .values({ name, unit: input.unit?.trim() || "unidad", consumedPerCleaning: consumed })
    .onDuplicateKeyUpdate({
      set: { unit: input.unit?.trim() || "unidad", consumedPerCleaning: consumed },
    });
  const [row] = await executor.select().from(supplies).where(eq(supplies.name, name)).limit(1);
  return row!;
}

export async function listSupplies(executor: Executor = db) {
  return executor.select().from(supplies).orderBy(asc(supplies.name));
}

/* -------------------------------------------------------------------------- */
/* Levels                                                                      */
/* -------------------------------------------------------------------------- */

export type SetSupplyLevelInput = {
  supplyId: number;
  listingId: number;
  qty: number;
  lowThreshold?: number;
};

/** Set the stock a listing holds — a restock, or the initial count. */
export async function setSupplyLevel(
  input: SetSupplyLevelInput,
  actor?: SessionUser | null,
  executor: Executor = db,
): Promise<typeof supplyLevels.$inferSelect> {
  const qty = Math.max(0, Math.trunc(input.qty));
  const lowThreshold = Math.max(0, Math.trunc(input.lowThreshold ?? 0));
  await executor
    .insert(supplyLevels)
    .values({ supplyId: input.supplyId, listingId: input.listingId, qty, lowThreshold })
    .onDuplicateKeyUpdate({ set: { qty, lowThreshold } });
  const [row] = await executor
    .select()
    .from(supplyLevels)
    .where(
      and(
        eq(supplyLevels.supplyId, input.supplyId),
        eq(supplyLevels.listingId, input.listingId),
      ),
    )
    .limit(1);
  await logActivity(
    {
      entity: "supply_level",
      entityId: row?.id ?? null,
      action: "supply.level_set",
      userId: actor?.id ?? null,
      meta: { supplyId: input.supplyId, listingId: input.listingId, qty, lowThreshold },
    },
    executor,
  );
  return row!;
}

export type SupplyConsumption = {
  supplyId: number;
  supplyName: string;
  requested: number;
  consumed: number;
  remaining: number;
  lowThreshold: number;
  /** True once the remaining stock is at or below the threshold. */
  low: boolean;
  /** Units the listing could not cover — stock is clamped at zero. */
  shortfall: number;
};

/**
 * Consume one cleaning's worth of every stocked supply at a listing.
 *
 * The UPDATE is conditional (`qty = GREATEST(qty - n, 0)`) and runs in the
 * caller's transaction, so two tasks closing at once cannot both read "12" and
 * both write "10".
 */
export async function consumeSuppliesForCleaning(
  listingId: number,
  executor: Executor,
  options: { multiplier?: number } = {},
): Promise<SupplyConsumption[]> {
  const multiplier = Math.max(1, Math.trunc(options.multiplier ?? 1));
  const rows = await executor
    .select({
      levelId: supplyLevels.id,
      qty: supplyLevels.qty,
      lowThreshold: supplyLevels.lowThreshold,
      supplyId: supplies.id,
      supplyName: supplies.name,
      perCleaning: supplies.consumedPerCleaning,
    })
    .from(supplyLevels)
    .innerJoin(supplies, eq(supplies.id, supplyLevels.supplyId))
    .where(eq(supplyLevels.listingId, listingId))
    .orderBy(asc(supplies.name));

  const results: SupplyConsumption[] = [];
  for (const row of rows) {
    const requested = row.perCleaning * multiplier;
    if (requested <= 0) continue;
    await executor
      .update(supplyLevels)
      .set({ qty: sql`GREATEST(${supplyLevels.qty} - ${requested}, 0)` })
      .where(eq(supplyLevels.id, row.levelId));
    const consumed = Math.min(requested, row.qty);
    const remaining = Math.max(0, row.qty - requested);
    results.push({
      supplyId: row.supplyId,
      supplyName: row.supplyName,
      requested,
      consumed,
      remaining,
      lowThreshold: row.lowThreshold,
      low: remaining <= row.lowThreshold,
      shortfall: Math.max(0, requested - row.qty),
    });
  }
  return results;
}

/** Everything at or below its low threshold — the admin restock list. */
export async function listLowStock(
  options: { listingIds?: number[] } = {},
  executor: Executor = db,
) {
  if (options.listingIds && options.listingIds.length === 0) return [];
  return executor
    .select({
      levelId: supplyLevels.id,
      listingId: supplyLevels.listingId,
      listingTitle: listings.title,
      supplyId: supplies.id,
      supplyName: supplies.name,
      unit: supplies.unit,
      qty: supplyLevels.qty,
      lowThreshold: supplyLevels.lowThreshold,
    })
    .from(supplyLevels)
    .innerJoin(supplies, eq(supplies.id, supplyLevels.supplyId))
    .innerJoin(listings, eq(listings.id, supplyLevels.listingId))
    .where(
      and(
        lte(supplyLevels.qty, supplyLevels.lowThreshold),
        options.listingIds ? inArray(supplyLevels.listingId, options.listingIds) : undefined,
      ),
    )
    .orderBy(asc(listings.title), asc(supplies.name));
}

export async function listSupplyLevels(
  options: { listingIds?: number[] } = {},
  executor: Executor = db,
) {
  if (options.listingIds && options.listingIds.length === 0) return [];
  return executor
    .select({
      levelId: supplyLevels.id,
      listingId: supplyLevels.listingId,
      listingTitle: listings.title,
      supplyId: supplies.id,
      supplyName: supplies.name,
      unit: supplies.unit,
      perCleaning: supplies.consumedPerCleaning,
      qty: supplyLevels.qty,
      lowThreshold: supplyLevels.lowThreshold,
    })
    .from(supplyLevels)
    .innerJoin(supplies, eq(supplies.id, supplyLevels.supplyId))
    .innerJoin(listings, eq(listings.id, supplyLevels.listingId))
    .where(options.listingIds ? inArray(supplyLevels.listingId, options.listingIds) : undefined)
    .orderBy(asc(listings.title), asc(supplies.name));
}

/** Restock one level by a delta — the "+12" button next to a low-stock row. */
export async function adjustSupplyLevel(
  levelId: number,
  delta: number,
  actor?: SessionUser | null,
): Promise<typeof supplyLevels.$inferSelect> {
  const step = Math.trunc(delta);
  if (step === 0) throw new DomainError("Indicá una cantidad distinta de cero", "invalid_amount");
  return inTransaction(undefined, async (tx) => {
    const [row] = await tx
      .select()
      .from(supplyLevels)
      .where(eq(supplyLevels.id, levelId))
      .limit(1)
      .for("update");
    if (!row) throw new DomainError("El stock no existe", "not_found", { levelId });
    const qty = Math.max(0, row.qty + step);
    await tx.update(supplyLevels).set({ qty }).where(eq(supplyLevels.id, levelId));
    await logActivity(
      {
        entity: "supply_level",
        entityId: levelId,
        action: "supply.adjusted",
        userId: actor?.id ?? null,
        meta: { listingId: row.listingId, supplyId: row.supplyId, from: row.qty, to: qty },
      },
      tx,
    );
    const [updated] = await tx.select().from(supplyLevels).where(eq(supplyLevels.id, levelId));
    return updated!;
  });
}
