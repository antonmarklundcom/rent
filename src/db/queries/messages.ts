/**
 * The comms engine's data layer (#4, #11, #20 — plan §5.O9).
 *
 * Three things live here and nothing else writes them:
 *   1. `message_templates` — the seeded es-PY sequence, editable by an admin.
 *   2. `scheduled_messages` — the queue. Enqueued by a booking transition,
 *      flipped to `due` by `scripts/process-messages.ts`, marked `sent` by a
 *      human in the outbox. NOTHING in this codebase sends a message: plan §1.5
 *      keeps the WhatsApp Business API out of v1, so "send" is a person tapping
 *      a `wa.me` link. Every automatic step stops one move short of the guest.
 *   3. `messages` — the conversation log the unified inbox reads.
 */
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  listings,
  locations,
  messageTemplates,
  messages,
  scheduledMessages,
  type MessageChannel,
  type MessageDirection,
  type Vertical,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { inTransaction } from "@/db/queries/tx";
import type { SessionUser } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import {
  assertTemplateBody,
  DEFAULT_SEQUENCE,
  formatLocalDateTime,
  isMessageAnchor,
  renderTemplate,
  selectSequenceFor,
  sendAfterFor,
  threadKey,
  type MessageAnchor,
  type TemplateVars,
} from "@/lib/messaging";

export { parseThreadKey, threadKey } from "@/lib/messaging";

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type ScheduledMessage = typeof scheduledMessages.$inferSelect;

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export async function listTemplates(executor: Executor = db): Promise<MessageTemplate[]> {
  return executor
    .select()
    .from(messageTemplates)
    .orderBy(messageTemplates.triggerEvent, messageTemplates.offsetMinutes, messageTemplates.key);
}

export async function getTemplateByKey(
  key: string,
  locale = "es",
  executor: Executor = db,
): Promise<MessageTemplate | null> {
  const [row] = await executor
    .select()
    .from(messageTemplates)
    .where(and(eq(messageTemplates.key, key), eq(messageTemplates.locale, locale)))
    .limit(1);
  return row ?? null;
}

export type UpsertTemplateInput = {
  key: string;
  label: string;
  body: string;
  anchor: MessageAnchor;
  offsetMinutes: number;
  locale?: string;
  vertical?: Vertical | null;
  isActive?: boolean;
};

/**
 * Idempotent by `(key, locale)` so the seed can re-run and an admin edit is an
 * update, never a duplicate row.
 */
export async function upsertTemplate(
  input: UpsertTemplateInput,
  executor: Executor = db,
): Promise<MessageTemplate> {
  assertTemplateBody(input.body);
  const locale = input.locale ?? "es";
  const values = {
    key: input.key,
    locale,
    label: input.label,
    body: input.body,
    triggerEvent: input.anchor,
    offsetMinutes: input.offsetMinutes,
    vertical: input.vertical ?? null,
    isActive: input.isActive ?? true,
  };
  await executor
    .insert(messageTemplates)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        label: values.label,
        body: values.body,
        triggerEvent: values.triggerEvent,
        offsetMinutes: values.offsetMinutes,
        vertical: values.vertical,
        isActive: values.isActive,
      },
    });
  const row = await getTemplateByKey(input.key, locale, executor);
  if (!row) throw new DomainError("No se pudo guardar la plantilla", "not_found");
  return row;
}

/** Seed/repair the plan §3.D sequence. Safe to run any number of times. */
export async function seedDefaultTemplates(executor: Executor = db): Promise<number> {
  for (const template of DEFAULT_SEQUENCE) {
    await upsertTemplate(
      {
        key: template.key,
        label: template.label,
        body: template.body,
        anchor: template.anchor,
        offsetMinutes: template.offsetMinutes,
        vertical: template.vertical,
      },
      executor,
    );
  }
  return DEFAULT_SEQUENCE.length;
}

/* -------------------------------------------------------------------------- */
/* Enqueue                                                                     */
/* -------------------------------------------------------------------------- */

export type EnqueueBookingContext = {
  bookingId: number;
  reference: string;
  guestName: string;
  vertical: Vertical;
  listingTitle: string;
  locationName: string | null;
  startAt: Date;
  endAt: Date;
  total: string;
  currency: string;
  units: number;
  confirmedAt: Date;
};

/** Everything a template may interpolate, for one booking. */
function templateVarsFor(context: EnqueueBookingContext): TemplateVars {
  return {
    guestName: context.guestName.split(" ")[0] || context.guestName,
    listingTitle: context.listingTitle,
    reference: context.reference,
    checkIn: formatLocalDateTime(context.startAt),
    checkOut: formatLocalDateTime(context.endAt),
    units: String(context.units),
    total: formatMoney(context.total, context.currency),
    location: context.locationName ?? undefined,
    // Optional by design (plan §4.5): with no GBP link configured the review
    // template still renders, just without the URL line.
    reviewLink: process.env.GBP_REVIEW_LINK || undefined,
    brand: "alquilar.com.py",
  };
}

/**
 * Queue the sequence for a booking that has just been confirmed.
 *
 * Bodies are rendered NOW, not at send time (see `scheduled_messages`
 * `rendered_body`): the outbox must show the guest exactly the text that was
 * promised at confirmation, even if somebody edits the template next week.
 *
 * Idempotent through `scheduled_messages_booking_template_uq` — re-running it
 * for a booking that already has its queue is a no-op that cannot resurrect a
 * `sent` or `cancelled` row.
 */
export async function enqueueBookingMessages(
  context: EnqueueBookingContext,
  executor: Executor = db,
  actor?: SessionUser | null,
): Promise<{ enqueued: number; skipped: string[] }> {
  const templates = (await listTemplates(executor)).filter(
    (t) => t.isActive && isMessageAnchor(t.triggerEvent),
  );
  const applicable = selectSequenceFor(
    templates.map((t) => ({
      ...t,
      anchor: t.triggerEvent as MessageAnchor,
      vertical: t.vertical ?? null,
    })),
    context.vertical,
  );
  if (applicable.length === 0) return { enqueued: 0, skipped: [] };

  const vars = templateVarsFor(context);
  const skipped: string[] = [];
  const rows = applicable.map((template) => {
    const rendered = renderTemplate(template.body, vars);
    if (rendered.missing.length > 0) skipped.push(`${template.key}:${rendered.missing.join("/")}`);
    return {
      bookingId: context.bookingId,
      templateId: template.id,
      templateKey: template.key,
      sendAfter: sendAfterFor(template.anchor, template.offsetMinutes, {
        confirmedAt: context.confirmedAt,
        startAt: context.startAt,
        endAt: context.endAt,
      }),
      renderedBody: rendered.body,
      channel: "whatsapp" as MessageChannel,
    };
  });

  await executor
    .insert(scheduledMessages)
    .values(rows)
    // A no-op update: the unique key must not resurrect a sent/cancelled row.
    .onDuplicateKeyUpdate({ set: { bookingId: sql`booking_id` } });

  await logActivity(
    {
      entity: "booking",
      entityId: context.bookingId,
      action: "messages.enqueued",
      userId: actor?.id ?? null,
      meta: { reference: context.reference, keys: rows.map((r) => r.templateKey), skipped },
    },
    executor,
  );

  return { enqueued: rows.length, skipped };
}

/**
 * A cancelled booking must not keep a "¡ya está todo listo!" in the queue.
 * Only pending rows are touched — a message already sent is history.
 */
export async function cancelScheduledForBooking(
  bookingId: number,
  executor: Executor = db,
): Promise<number> {
  const pending = await executor
    .select({ id: scheduledMessages.id })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.bookingId, bookingId),
        inArray(scheduledMessages.status, ["scheduled", "due"]),
      ),
    );
  if (pending.length === 0) return 0;
  await executor
    .update(scheduledMessages)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(scheduledMessages.bookingId, bookingId),
        inArray(scheduledMessages.status, ["scheduled", "due"]),
      ),
    );
  return pending.length;
}

/* -------------------------------------------------------------------------- */
/* The processor (`scripts/process-messages.ts`)                               */
/* -------------------------------------------------------------------------- */

/**
 * Flip everything whose time has come from `scheduled` to `due`.
 *
 * That is the whole job — it makes the outbox's "para enviar" list a plain
 * indexed status query instead of a clock comparison at render time, and it
 * gives us one row per message whose transition is observable.
 */
export async function markDueMessages(
  now: Date = new Date(),
  executor: Executor = db,
): Promise<{ due: number; ids: number[] }> {
  const pending = await executor
    .select({ id: scheduledMessages.id })
    .from(scheduledMessages)
    .where(
      and(eq(scheduledMessages.status, "scheduled"), lte(scheduledMessages.sendAfter, now)),
    );
  if (pending.length === 0) return { due: 0, ids: [] };
  await executor
    .update(scheduledMessages)
    .set({ status: "due" })
    .where(
      and(eq(scheduledMessages.status, "scheduled"), lte(scheduledMessages.sendAfter, now)),
    );
  return { due: pending.length, ids: pending.map((r) => r.id) };
}

/* -------------------------------------------------------------------------- */
/* The outbox                                                                  */
/* -------------------------------------------------------------------------- */

export type OutboxRow = {
  id: number;
  templateKey: string;
  status: (typeof scheduledMessages.$inferSelect)["status"];
  sendAfter: Date;
  renderedBody: string;
  bookingId: number;
  reference: string;
  guestName: string;
  guestPhone: string | null;
  listingId: number;
  listingTitle: string;
  vertical: Vertical;
  sentAt: Date | null;
};

/**
 * Messages waiting for a human. Owner-scoped through `listingIds` exactly like
 * every other read in this codebase.
 */
export async function listOutbox(
  options: {
    listingIds?: number[];
    statuses?: (typeof scheduledMessages.$inferSelect)["status"][];
    limit?: number;
  } = {},
  executor: Executor = db,
): Promise<OutboxRow[]> {
  if (options.listingIds && options.listingIds.length === 0) return [];
  const rows = await executor
    .select({
      id: scheduledMessages.id,
      templateKey: scheduledMessages.templateKey,
      status: scheduledMessages.status,
      sendAfter: scheduledMessages.sendAfter,
      renderedBody: scheduledMessages.renderedBody,
      sentAt: scheduledMessages.sentAt,
      bookingId: bookings.id,
      reference: bookings.reference,
      guestName: bookings.guestName,
      guestPhone: bookings.guestPhone,
      listingId: listings.id,
      listingTitle: listings.title,
      vertical: listings.vertical,
    })
    .from(scheduledMessages)
    .innerJoin(bookings, eq(bookings.id, scheduledMessages.bookingId))
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(
      and(
        inArray(scheduledMessages.status, options.statuses ?? ["due"]),
        options.listingIds ? inArray(listings.id, options.listingIds) : undefined,
      ),
    )
    .orderBy(scheduledMessages.sendAfter)
    .limit(options.limit ?? 200);

  return rows.map((row) => ({ ...row, renderedBody: row.renderedBody ?? "" }));
}

export async function getScheduledMessage(id: number, executor: Executor = db) {
  const [row] = await executor
    .select({
      scheduled: scheduledMessages,
      listingId: listings.id,
      listingTitle: listings.title,
      reference: bookings.reference,
      guestName: bookings.guestName,
      guestPhone: bookings.guestPhone,
    })
    .from(scheduledMessages)
    .innerJoin(bookings, eq(bookings.id, scheduledMessages.bookingId))
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(eq(scheduledMessages.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * "I sent this one."
 *
 * Marking sent also writes the outbound `messages` row, in the same
 * transaction, so the unified inbox shows the guest's whole conversation
 * — automated touchpoints included — and not just the replies somebody
 * happened to log by hand.
 */
export async function markScheduledSent(
  id: number,
  actor: SessionUser,
  executor?: Executor,
): Promise<{ scheduled: ScheduledMessage; messageId: number }> {
  return inTransaction(executor, async (tx) => {
    const row = await getScheduledMessage(id, tx);
    if (!row) throw new DomainError("El mensaje no existe", "not_found", { id });
    if (row.scheduled.status === "sent") {
      throw new DomainError("Ese mensaje ya figura como enviado", "already_settled", { id });
    }
    if (row.scheduled.status === "cancelled") {
      throw new DomainError("Ese mensaje fue cancelado", "invalid_transition", { id });
    }

    // Conditional UPDATE, not a bare one: two admins pressing "marcar enviado"
    // at the same time would both pass the check above and both log an
    // outbound message. Only the row still in a sendable state moves.
    const updated = await tx
      .update(scheduledMessages)
      .set({ status: "sent", sentBy: actor.id, sentAt: new Date() })
      .where(
        and(
          eq(scheduledMessages.id, id),
          inArray(scheduledMessages.status, ["scheduled", "due"]),
        ),
      );
    const affected = (updated as unknown as { affectedRows?: number }[])[0]?.affectedRows ?? 0;
    if (affected === 0) {
      throw new DomainError("Ese mensaje ya figura como enviado", "already_settled", { id });
    }

    const messageId = await insertMessageRow(tx, {
      bookingId: row.scheduled.bookingId,
      listingId: row.listingId,
      direction: "outbound",
      channel: row.scheduled.channel,
      contactName: row.guestName,
      contactPhone: row.guestPhone,
      body: row.scheduled.renderedBody ?? "",
      aiDrafted: false,
      loggedBy: actor.id,
    });

    await logActivity(
      {
        entity: "scheduled_message",
        entityId: id,
        action: "message.sent",
        userId: actor.id,
        meta: { reference: row.reference, templateKey: row.scheduled.templateKey },
      },
      tx,
    );

    const [fresh] = await tx
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, id))
      .limit(1);
    return { scheduled: fresh ?? row.scheduled, messageId };
  });
}

export async function cancelScheduledMessage(
  id: number,
  actor: SessionUser,
  executor: Executor = db,
): Promise<ScheduledMessage> {
  const row = await getScheduledMessage(id, executor);
  if (!row) throw new DomainError("El mensaje no existe", "not_found", { id });
  if (row.scheduled.status === "sent") {
    throw new DomainError("Ese mensaje ya fue enviado", "already_settled", { id });
  }
  await executor
    .update(scheduledMessages)
    .set({ status: "cancelled" })
    .where(eq(scheduledMessages.id, id));
  await logActivity(
    {
      entity: "scheduled_message",
      entityId: id,
      action: "message.cancelled",
      userId: actor.id,
      meta: { reference: row.reference, templateKey: row.scheduled.templateKey },
    },
    executor,
  );
  return { ...row.scheduled, status: "cancelled" };
}

/** Everything queued for one booking — shown on the booking's admin page. */
export async function listScheduledForBooking(bookingId: number, executor: Executor = db) {
  return executor
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.bookingId, bookingId))
    .orderBy(scheduledMessages.sendAfter);
}

/* -------------------------------------------------------------------------- */
/* The conversation log + unified inbox (#20)                                  */
/* -------------------------------------------------------------------------- */

export type LogMessageInput = {
  bookingId?: number | null;
  listingId?: number | null;
  direction: MessageDirection;
  channel?: MessageChannel;
  contactName?: string | null;
  contactPhone?: string | null;
  body: string;
  aiDrafted?: boolean;
};

async function insertMessageRow(
  executor: Executor,
  values: typeof messages.$inferInsert,
): Promise<number> {
  const result = await executor.insert(messages).values(values);
  // mysql2 returns the auto-increment id on the first result element.
  const insertId = (result as unknown as { insertId?: number }[])[0]?.insertId;
  if (typeof insertId === "number" && insertId > 0) return insertId;
  const [row] = await executor
    .select({ id: messages.id })
    .from(messages)
    .orderBy(desc(messages.id))
    .limit(1);
  return row?.id ?? 0;
}

/**
 * Log one message.
 *
 * A message always carries its `listing_id`, deriving it from the booking when
 * the caller only knows that — owner scoping filters on the listing, so a row
 * without one would be invisible to its own owner.
 */
export async function logMessage(
  input: LogMessageInput,
  actor?: SessionUser | null,
  executor: Executor = db,
): Promise<{ id: number; listingId: number | null }> {
  const body = input.body.trim();
  if (!body) throw new DomainError("El mensaje está vacío", "invalid_amount");
  if (!input.bookingId && !input.listingId) {
    throw new DomainError("Un mensaje tiene que pertenecer a una reserva o a una publicación", "not_found");
  }

  let listingId = input.listingId ?? null;
  let contactName = input.contactName ?? null;
  let contactPhone = input.contactPhone ?? null;

  if (input.bookingId) {
    const [booking] = await executor
      .select({
        listingId: bookings.listingId,
        guestName: bookings.guestName,
        guestPhone: bookings.guestPhone,
      })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (!booking) {
      throw new DomainError("La reserva no existe", "not_found", { bookingId: input.bookingId });
    }
    listingId = listingId ?? booking.listingId;
    contactName = contactName ?? booking.guestName;
    contactPhone = contactPhone ?? booking.guestPhone;
  }

  const id = await insertMessageRow(executor, {
    bookingId: input.bookingId ?? null,
    listingId,
    direction: input.direction,
    channel: input.channel ?? "whatsapp",
    contactName,
    contactPhone,
    body,
    aiDrafted: input.aiDrafted ?? false,
    loggedBy: actor?.id ?? null,
  });
  return { id, listingId };
}

export type InboxThread = {
  /** `b12` for a booking thread, `l7` for a listing-only one. */
  threadKey: string;
  bookingId: number | null;
  listingId: number;
  listingTitle: string;
  vertical: Vertical;
  reference: string | null;
  contactName: string | null;
  contactPhone: string | null;
  lastBody: string;
  lastDirection: MessageDirection;
  lastAt: Date;
  messageCount: number;
};

/**
 * #20 — one row per conversation, newest first, across every listing the user
 * may see. The latest message per thread is picked in SQL (`max(id)` over the
 * thread key) rather than by pulling every message and reducing in JS.
 */
export async function listInboxThreads(
  options: { listingIds?: number[]; limit?: number } = {},
  executor: Executor = db,
): Promise<InboxThread[]> {
  if (options.listingIds && options.listingIds.length === 0) return [];
  const scope = options.listingIds ? inArray(messages.listingId, options.listingIds) : undefined;

  const latest = executor
    .select({
      bookingKey: sql<number>`coalesce(${messages.bookingId}, 0)`.as("booking_key"),
      listingKey: sql<number>`coalesce(${messages.listingId}, 0)`.as("listing_key"),
      lastId: sql<number>`max(${messages.id})`.as("last_id"),
      messageCount: sql<number>`count(*)`.as("message_count"),
    })
    .from(messages)
    .where(scope)
    .groupBy(sql`booking_key`, sql`listing_key`)
    .as("latest");

  const rows = await executor
    .select({
      bookingId: messages.bookingId,
      listingId: messages.listingId,
      contactName: messages.contactName,
      contactPhone: messages.contactPhone,
      body: messages.body,
      direction: messages.direction,
      createdAt: messages.createdAt,
      messageCount: latest.messageCount,
      listingTitle: listings.title,
      vertical: listings.vertical,
      reference: bookings.reference,
    })
    .from(latest)
    .innerJoin(messages, eq(messages.id, latest.lastId))
    .innerJoin(listings, eq(listings.id, messages.listingId))
    .leftJoin(bookings, eq(bookings.id, messages.bookingId))
    .orderBy(desc(messages.createdAt))
    .limit(options.limit ?? 100);

  return rows.map((row) => ({
    threadKey: threadKey(row.bookingId, row.listingId),
    bookingId: row.bookingId,
    listingId: row.listingId!,
    listingTitle: row.listingTitle,
    vertical: row.vertical,
    reference: row.reference,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    lastBody: row.body,
    lastDirection: row.direction,
    lastAt: row.createdAt,
    messageCount: Number(row.messageCount),
  }));
}

/** Every message in one thread, oldest first. */
export async function listThreadMessages(
  thread: { bookingId: number | null; listingId: number | null },
  executor: Executor = db,
) {
  const where = thread.bookingId
    ? eq(messages.bookingId, thread.bookingId)
    : and(eq(messages.listingId, thread.listingId!), isNull(messages.bookingId));
  return executor.select().from(messages).where(where).orderBy(messages.id);
}

/** Listing + guest context for a thread page, and what scoping needs. */
export async function getThreadContext(
  thread: { bookingId: number | null; listingId: number | null },
  executor: Executor = db,
) {
  if (thread.bookingId) {
    const [row] = await executor
      .select({
        bookingId: bookings.id,
        reference: bookings.reference,
        guestName: bookings.guestName,
        guestPhone: bookings.guestPhone,
        status: bookings.status,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        listingId: listings.id,
        listingTitle: listings.title,
        vertical: listings.vertical,
        locationName: locations.name,
      })
      .from(bookings)
      .innerJoin(listings, eq(listings.id, bookings.listingId))
      .leftJoin(locations, eq(locations.id, listings.locationId))
      .where(eq(bookings.id, thread.bookingId))
      .limit(1);
    return row ?? null;
  }
  const [row] = await executor
    .select({
      listingId: listings.id,
      listingTitle: listings.title,
      vertical: listings.vertical,
      locationName: locations.name,
    })
    .from(listings)
    .leftJoin(locations, eq(locations.id, listings.locationId))
    .where(eq(listings.id, thread.listingId!))
    .limit(1);
  return row
    ? {
        ...row,
        bookingId: null,
        reference: null,
        guestName: null,
        guestPhone: null,
        status: null,
        startAt: null,
        endAt: null,
      }
    : null;
}

/** Outstanding comms work for the admin overview. */
export async function commsCounts(
  options: { listingIds?: number[] } = {},
  executor: Executor = db,
): Promise<{ due: number; threads: number }> {
  const [due, threads] = await Promise.all([
    listOutbox({ listingIds: options.listingIds, limit: 500 }, executor),
    listInboxThreads({ listingIds: options.listingIds, limit: 500 }, executor),
  ]);
  return { due: due.length, threads: threads.length };
}
