/**
 * The per-listing knowledge base (`info_items`).
 *
 * Two consumers: the owner's info-base editor in the panel (§5.O10) and the AI
 * draft action (§5.O9), which is grounded on exactly these rows and nothing
 * else. That is the point of keeping it a table rather than free text — an
 * owner curates the answers, and the model is only allowed to repeat them.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { infoItems, listings } from "@/db/schema";
import type { Executor } from "@/db/queries/availability";
import { DomainError } from "@/lib/errors";

export type InfoItem = typeof infoItems.$inferSelect;

export async function listInfoItems(
  listingId: number,
  executor: Executor = db,
): Promise<InfoItem[]> {
  return executor
    .select()
    .from(infoItems)
    .where(eq(infoItems.listingId, listingId))
    .orderBy(asc(infoItems.sortOrder), asc(infoItems.id));
}

/** Idempotent on `(listing_id, question)` so re-asking updates the answer. */
export async function upsertInfoItem(
  input: { listingId: number; question: string; answer: string; sortOrder?: number },
  executor: Executor = db,
): Promise<InfoItem> {
  const question = input.question.trim();
  const answer = input.answer.trim();
  if (question.length < 3) {
    throw new DomainError("La pregunta es demasiado corta", "invalid_amount");
  }
  if (answer.length < 2) {
    throw new DomainError("La respuesta es demasiado corta", "invalid_amount");
  }
  await executor
    .insert(infoItems)
    .values({
      listingId: input.listingId,
      question,
      answer,
      sortOrder: input.sortOrder ?? 0,
    })
    .onDuplicateKeyUpdate({ set: { answer, sortOrder: input.sortOrder ?? 0 } });

  const [row] = await executor
    .select()
    .from(infoItems)
    .where(and(eq(infoItems.listingId, input.listingId), eq(infoItems.question, question)))
    .limit(1);
  if (!row) throw new DomainError("No se pudo guardar la respuesta", "not_found");
  return row;
}

export async function deleteInfoItem(id: number, executor: Executor = db): Promise<void> {
  await executor.delete(infoItems).where(eq(infoItems.id, id));
}

export async function getInfoItem(id: number, executor: Executor = db) {
  const [row] = await executor.select().from(infoItems).where(eq(infoItems.id, id)).limit(1);
  return row ?? null;
}

/** How complete each listing's info base is — the onboarding checklist reads this (#19). */
export async function infoItemCounts(
  listingIds: number[],
  executor: Executor = db,
): Promise<Map<number, number>> {
  if (listingIds.length === 0) return new Map();
  const rows = await executor
    .select({ listingId: infoItems.listingId, id: infoItems.id })
    .from(infoItems)
    .where(inArray(infoItems.listingId, listingIds));
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.listingId, (counts.get(row.listingId) ?? 0) + 1);
  return counts;
}

/** Listing title + info base in one round trip — what the AI draft is grounded on. */
export async function loadDraftGrounding(listingId: number, executor: Executor = db) {
  const [listing] = await executor
    .select({
      id: listings.id,
      title: listings.title,
      vertical: listings.vertical,
      description: listings.description,
      cancellationPolicy: listings.cancellationPolicy,
    })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!listing) {
    throw new DomainError("La publicación no existe", "not_found", { listingId });
  }
  return { listing, items: await listInfoItems(listingId, executor) };
}
