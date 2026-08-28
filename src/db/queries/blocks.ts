/**
 * Availability blocks — owner blocked dates (#15), maintenance holds, and the
 * rows `scripts/sync-ical.ts` writes for imported calendars (#2).
 *
 * A block is created through the same availability guard a booking is, so an
 * owner cannot block dates a guest already holds, and an imported iCal event
 * cannot silently land on top of a confirmed booking.
 */
import { and, asc, eq, gt, lt, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { availabilityBlocks, icalSources, type BlockReason } from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import { assertAvailable, findConflicts, type Executor } from "@/db/queries/availability";
import type { SessionUser } from "@/lib/auth-core";
import { assertValidRange, type DateRange } from "@/lib/dates";
import { DomainError } from "@/lib/errors";

export type CreateBlockInput = {
  listingId: number;
  startAt: Date;
  endAt: Date;
  reason?: BlockReason;
  note?: string | null;
  sourceRef?: string | null;
  icalSourceId?: number | null;
};

export async function createBlock(
  input: CreateBlockInput,
  actor?: SessionUser | null,
): Promise<typeof availabilityBlocks.$inferSelect> {
  const { startAt, endAt } = assertValidRange(input.startAt, input.endAt);
  return db.transaction(async (tx) => {
    await assertAvailable({ listingId: input.listingId, startAt, endAt, lock: true }, tx);
    const [inserted] = await tx
      .insert(availabilityBlocks)
      .values({
        listingId: input.listingId,
        startAt,
        endAt,
        reason: input.reason ?? "owner_use",
        note: input.note ?? null,
        sourceRef: input.sourceRef ?? null,
        icalSourceId: input.icalSourceId ?? null,
        createdBy: actor?.id ?? null,
      })
      .$returningId();
    const [row] = await tx
      .select()
      .from(availabilityBlocks)
      .where(eq(availabilityBlocks.id, inserted!.id))
      .limit(1);
    if (!row) throw new DomainError("No se pudo crear el bloqueo", "not_found");
    await logActivity(
      {
        entity: "availability_block",
        entityId: row.id,
        action: "block.created",
        userId: actor?.id ?? null,
        meta: { listingId: input.listingId, reason: row.reason, startAt, endAt },
      },
      tx,
    );
    return row;
  });
}

export async function deleteBlock(
  blockId: number,
  actor?: SessionUser | null,
  executor: Executor = db,
): Promise<void> {
  const [row] = await executor
    .select()
    .from(availabilityBlocks)
    .where(eq(availabilityBlocks.id, blockId))
    .limit(1);
  if (!row) throw new DomainError("El bloqueo no existe", "not_found", { blockId });
  await executor.delete(availabilityBlocks).where(eq(availabilityBlocks.id, blockId));
  await logActivity(
    {
      entity: "availability_block",
      entityId: blockId,
      action: "block.deleted",
      userId: actor?.id ?? null,
      meta: { listingId: row.listingId, reason: row.reason },
    },
    executor,
  );
}

export async function getBlockById(blockId: number, executor: Executor = db) {
  const [row] = await executor
    .select()
    .from(availabilityBlocks)
    .where(eq(availabilityBlocks.id, blockId))
    .limit(1);
  return row ?? null;
}

export async function listBlocksForListing(
  listingId: number,
  window?: DateRange,
  executor: Executor = db,
) {
  return executor
    .select()
    .from(availabilityBlocks)
    .where(
      and(
        eq(availabilityBlocks.listingId, listingId),
        window ? lt(availabilityBlocks.startAt, window.endAt) : undefined,
        window ? gt(availabilityBlocks.endAt, window.startAt) : undefined,
      ),
    )
    .orderBy(asc(availabilityBlocks.startAt));
}

/* -------------------------------------------------------------------------- */
/* iCal-imported blocks (#2)                                                   */
/* -------------------------------------------------------------------------- */

export type IcalBlockInput = {
  sourceRef: string;
  startAt: Date;
  endAt: Date;
  note: string | null;
};

export type IcalSyncOutcome = {
  created: number;
  updated: number;
  removed: number;
  skipped: Array<{ sourceRef: string; reason: string }>;
};

/**
 * Replace one source's blocks with the events its feed currently advertises.
 *
 * Idempotent by construction: rows are keyed on the unique
 * `(ical_source_id, source_ref)` pair, so a re-run updates in place, and any
 * row whose UID vanished from the feed is deleted. An event that collides with
 * a booking of ours is SKIPPED rather than written — our own confirmed booking
 * always wins, and the skip is reported so the sync log shows the clash.
 */
export async function syncIcalBlocks(
  source: { id: number; listingId: number; label: string | null },
  events: IcalBlockInput[],
  executor: Executor = db,
): Promise<IcalSyncOutcome> {
  const outcome: IcalSyncOutcome = { created: 0, updated: 0, removed: 0, skipped: [] };
  const label = source.label ?? "iCal";
  const keptRefs: string[] = [];

  for (const event of events) {
    let range;
    try {
      range = assertValidRange(event.startAt, event.endAt);
    } catch {
      outcome.skipped.push({ sourceRef: event.sourceRef, reason: "rango inválido" });
      continue;
    }

    const [existing] = await executor
      .select()
      .from(availabilityBlocks)
      .where(
        and(
          eq(availabilityBlocks.icalSourceId, source.id),
          eq(availabilityBlocks.sourceRef, event.sourceRef),
        ),
      )
      .limit(1);

    // Our own bookings and other sources' blocks win over an imported event.
    const conflicts = await findConflicts(
      {
        listingId: source.listingId,
        startAt: range.startAt,
        endAt: range.endAt,
        excludeBlockId: existing?.id,
      },
      executor,
    );
    if (conflicts.length > 0) {
      outcome.skipped.push({
        sourceRef: event.sourceRef,
        reason:
          conflicts[0]!.kind === "booking"
            ? `choca con la reserva ${conflicts[0]!.reference}`
            : "choca con otro bloqueo",
      });
      continue;
    }

    if (existing) {
      const unchanged =
        existing.startAt.getTime() === range.startAt.getTime() &&
        existing.endAt.getTime() === range.endAt.getTime() &&
        existing.note === (event.note ?? `${label}`);
      if (!unchanged) {
        await executor
          .update(availabilityBlocks)
          .set({
            startAt: range.startAt,
            endAt: range.endAt,
            note: event.note ?? label,
          })
          .where(eq(availabilityBlocks.id, existing.id));
        outcome.updated += 1;
      }
    } else {
      await executor.insert(availabilityBlocks).values({
        listingId: source.listingId,
        startAt: range.startAt,
        endAt: range.endAt,
        reason: "external_ical",
        sourceRef: event.sourceRef,
        icalSourceId: source.id,
        note: event.note ?? label,
      });
      outcome.created += 1;
    }
    keptRefs.push(event.sourceRef);
  }

  // Anything this source wrote before and no longer advertises is stale.
  const staleWhere = and(
    eq(availabilityBlocks.icalSourceId, source.id),
    keptRefs.length > 0 ? notInArray(availabilityBlocks.sourceRef, keptRefs) : undefined,
  );
  const stale = await executor
    .select({ id: availabilityBlocks.id })
    .from(availabilityBlocks)
    .where(staleWhere);
  if (stale.length > 0) {
    await executor.delete(availabilityBlocks).where(staleWhere);
    outcome.removed = stale.length;
  }
  return outcome;
}

export async function listIcalSources(
  options: { listingId?: number; activeOnly?: boolean } = {},
  executor: Executor = db,
) {
  return executor
    .select()
    .from(icalSources)
    .where(
      and(
        options.listingId ? eq(icalSources.listingId, options.listingId) : undefined,
        options.activeOnly ? eq(icalSources.isActive, true) : undefined,
      ),
    )
    .orderBy(asc(icalSources.id));
}

export async function recordIcalSyncResult(
  sourceId: number,
  status: string,
  executor: Executor = db,
): Promise<void> {
  await executor
    .update(icalSources)
    .set({ lastSyncedAt: new Date(), lastStatus: status.slice(0, 255) })
    .where(eq(icalSources.id, sourceId));
}

/* -------------------------------------------------------------------------- */
/* iCal source CRUD (#2) — the owner-facing half of the import                 */
/* -------------------------------------------------------------------------- */

/**
 * Register an external calendar to import from.
 *
 * The URL is the credential to somebody else's calendar, so it is validated as
 * http(s) here rather than at the form: a `file://` or `javascript:` URL would
 * be handed straight to `fetch` by `scripts/sync-ical.ts`.
 */
export async function createIcalSource(
  input: { listingId: number; url: string; label?: string | null },
  actor?: SessionUser | null,
  executor: Executor = db,
): Promise<number> {
  const url = input.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DomainError("La dirección del calendario no es válida", "invalid_range", { url });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DomainError("El calendario tiene que ser una URL http(s)", "invalid_range", { url });
  }
  const [inserted] = await executor
    .insert(icalSources)
    .values({
      listingId: input.listingId,
      url: url.slice(0, 700),
      label: input.label?.trim().slice(0, 120) || null,
    })
    .$returningId();
  await logActivity(
    {
      entity: "ical_source",
      entityId: inserted!.id,
      action: "ical_source.created",
      userId: actor?.id ?? null,
      meta: { listingId: input.listingId, host: parsed.host },
    },
    executor,
  );
  return inserted!.id;
}

export async function getIcalSource(sourceId: number, executor: Executor = db) {
  const [row] = await executor
    .select()
    .from(icalSources)
    .where(eq(icalSources.id, sourceId))
    .limit(1);
  return row ?? null;
}

/**
 * Remove a source and the blocks it imported.
 *
 * Leaving the blocks behind would keep dates unavailable with nothing left to
 * explain why, and no way to release them from the panel.
 */
export async function deleteIcalSource(
  sourceId: number,
  actor?: SessionUser | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(icalSources)
      .where(eq(icalSources.id, sourceId))
      .limit(1);
    if (!row) throw new DomainError("Ese calendario no existe", "not_found", { sourceId });
    await tx
      .delete(availabilityBlocks)
      .where(eq(availabilityBlocks.icalSourceId, sourceId));
    await tx.delete(icalSources).where(eq(icalSources.id, sourceId));
    await logActivity(
      {
        entity: "ical_source",
        entityId: sourceId,
        action: "ical_source.deleted",
        userId: actor?.id ?? null,
        meta: { listingId: row.listingId },
      },
      tx,
    );
  });
}
