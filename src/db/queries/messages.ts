/**
 * The comms data layer (plan §5.O9 — features #4, #11, #20).
 *
 * Three responsibilities, in the order the lifecycle uses them:
 *   1. ENQUEUE — a booking transition drops the whole sequence into
 *      `scheduled_messages`, rendered once, in the transition's own
 *      transaction.
 *   2. DUE — `scripts/process-messages.ts` flips rows whose moment arrived.
 *   3. OUTBOX / INBOX — an admin reads, sends by hand and logs what was said.
 *
 * NOTHING in this file sends anything (plan §1.5). The wa.me link is built for
 * a human to tap; `markScheduledSent` records that a human did.
 */
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  infoItems,
  listings,
  messageTemplates,
  messages,
  scheduledMessages,
  stayDetails,
  type MessageChannel,
  type MessageDirection,
  type ScheduledMessageStatus,
  type Vertical,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { inTransaction } from "@/db/queries/tx";
import type { SessionUser } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import {
  isMessageEvent,
  renderTemplate,
  scheduleFor,
  whatsappLink,
  type MessageEvent,
  type TemplateVars,
} from "@/lib/messaging";

/**
 * Rows the driver actually wrote.
 *
 * mysql2 returns `[ResultSetHeader, FieldPacket[]]` and drizzle passes it
 * through, so reading `.affectedRows` off the tuple silently yields
 * `undefined` — which is how "nothing was enqueued" would be reported for a
 * successful insert. Read it off element 0, and tolerate either shape.
 */
function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

export type MessageTemplate = typeof messageTemplates.$inferSelect;

export async function listTemplates(
  options: { locale?: string; activeOnly?: boolean } = {},
  executor: Executor = db,
) {
  return executor
    .select()
    .from(messageTemplates)
    .where(
      and(
        options.locale ? eq(messageTemplates.locale, options.locale) : undefined,
        options.activeOnly ? eq(messageTemplates.isActive, true) : undefined,
      ),
    )
    .orderBy(messageTemplates.triggerEvent, messageTemplates.offsetMinutes);
}

export async function getTemplate(id: number, executor: Executor = db) {
  const [row] = await executor
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.id, id))
    .limit(1);
  return row ?? null;
}

export type UpdateTemplateInput = {
  label?: string;
  body?: string;
  isActive?: boolean;
  offsetMinutes?: number;
};

/**
 * Editing a template never rewrites queued messages: `rendered_body` was
 * snapshotted at enqueue time on purpose, so what an operator reviews in the
 * outbox is what the engine produced, not what somebody typed since.
 */
export async function updateTemplate(
  id: number,
  input: UpdateTemplateInput,
  actor?: SessionUser | null,
  executor: Executor = db,
) {
  const current = await getTemplate(id, executor);
  if (!current) throw new DomainError("La plantilla no existe", "not_found", { id });
  const patch: Partial<typeof messageTemplates.$inferInsert> = {};
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.body !== undefined) {
    const body = input.body.trim();
    if (!body) throw new DomainError("El texto de la plantilla no puede quedar vacío", "invalid_amount");
    patch.body = body;
  }
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.offsetMinutes !== undefined) patch.offsetMinutes = input.offsetMinutes;
  if (Object.keys(patch).length === 0) return current;

  await executor.update(messageTemplates).set(patch).where(eq(messageTemplates.id, id));
  await logActivity(
    {
      entity: "message_template",
      entityId: id,
      action: "template.updated",
      userId: actor?.id ?? null,
      meta: { key: current.key, fields: Object.keys(patch) },
    },
    executor,
  );
  return (await getTemplate(id, executor))!;
}

/* -------------------------------------------------------------------------- */
/* Enqueue                                                                    */
/* -------------------------------------------------------------------------- */

/** Everything the renderer needs about one booking. Loaded once per enqueue. */
type EnqueueContext = {
  booking: typeof bookings.$inferSelect;
  listingTitle: string;
  vertical: Vertical;
};

async function loadEnqueueContext(
  bookingId: number,
  executor: Executor,
): Promise<EnqueueContext | null> {
  const [row] = await executor
    .select({
      booking: bookings,
      listingTitle: listings.title,
      vertical: listings.vertical,
    })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row ?? null;
}

/** `2026-03-04T14:00:00Z` → `04/03/2026 14:00` — how a PY guest reads a date. */
export function formatWhen(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}

function varsForBooking(context: EnqueueContext): TemplateVars {
  const { booking } = context;
  return {
    guest_name: booking.guestName,
    listing_title: context.listingTitle,
    reference: booking.reference,
    check_in: formatWhen(booking.startAt),
    check_out: formatWhen(booking.endAt),
    total: formatMoney(booking.total, booking.currency),
    guest_count: booking.guestCount ? String(booking.guestCount) : null,
    contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE ?? null,
    review_link: process.env.GBP_REVIEW_LINK ?? null,
  };
}

export type EnqueueResult = {
  created: number;
  skipped: number;
  keys: string[];
};

/**
 * Drop the whole sequence for a booking (#4).
 *
 * Idempotent by `scheduled_messages_booking_template_uq`: re-confirming a
 * booking, or a retried transaction, never doubles a guest's messages. Runs in
 * the caller's transaction so a rolled-back confirmation leaves no queue rows
 * promising a stay that is not happening.
 */
export async function enqueueBookingMessages(
  bookingId: number,
  options: { now?: Date; locale?: string } = {},
  actor?: SessionUser | null,
  executor?: Executor | null,
): Promise<EnqueueResult> {
  return inTransaction(executor, async (tx) => {
    const context = await loadEnqueueContext(bookingId, tx);
    if (!context) {
      throw new DomainError("La reserva no existe", "not_found", { bookingId });
    }
    const now = options.now ?? new Date();
    const locale = options.locale ?? "es";
    const templates = await tx
      .select()
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.isActive, true),
          eq(messageTemplates.locale, locale),
          or(
            isNull(messageTemplates.vertical),
            eq(messageTemplates.vertical, context.vertical),
          ),
        ),
      );

    const vars = varsForBooking(context);
    const anchors = {
      confirmedAt: now,
      startAt: new Date(context.booking.startAt),
      endAt: new Date(context.booking.endAt),
    };

    // What this booking already has. Read first rather than inferring from the
    // driver's `affectedRows`: MySQL and MariaDB disagree about what an
    // ON DUPLICATE KEY UPDATE that changes nothing reports, and "how many did
    // we queue" is the number this function exists to return.
    const existing = await tx
      .select({ templateKey: scheduledMessages.templateKey })
      .from(scheduledMessages)
      .where(eq(scheduledMessages.bookingId, bookingId));
    const already = new Set(existing.map((row) => row.templateKey));

    let created = 0;
    let skipped = 0;
    const keys: string[] = [];

    for (const template of templates) {
      if (!isMessageEvent(template.triggerEvent)) {
        // A template with no (or an unknown) trigger is a manual snippet an
        // operator picks by hand — it is not part of any booking's sequence.
        skipped += 1;
        continue;
      }
      if (already.has(template.key)) {
        skipped += 1;
        continue;
      }
      const event: MessageEvent = template.triggerEvent;
      const sendAfter = scheduleFor(event, template.offsetMinutes, anchors);
      const rendered = renderTemplate(template.body, vars);
      await tx
        .insert(scheduledMessages)
        .values({
          bookingId,
          templateId: template.id,
          templateKey: template.key,
          sendAfter,
          status: "scheduled",
          renderedBody: rendered.body,
          channel: "whatsapp",
        })
        // Race guard only: `scheduled_messages_booking_template_uq` is what
        // actually stops a concurrent enqueue from duplicating a guest's
        // messages; this clause keeps that collision from raising.
        .onDuplicateKeyUpdate({ set: { templateKey: sql`template_key` } });
      created += 1;
      keys.push(template.key);
    }

    if (created > 0) {
      await logActivity(
        {
          entity: "booking",
          entityId: bookingId,
          action: "messages.enqueued",
          userId: actor?.id ?? null,
          meta: { reference: context.booking.reference, created, keys },
        },
        tx,
      );
    }
    return { created, skipped, keys };
  });
}

/**
 * A cancelled booking must stop talking (#4).
 *
 * Only rows that have NOT been sent are cancelled — a message a human already
 * sent to a guest happened, and the log must keep saying so.
 */
export async function cancelBookingMessages(
  bookingId: number,
  actor?: SessionUser | null,
  executor?: Executor | null,
): Promise<number> {
  return inTransaction(executor, async (tx) => {
    const pending = await tx
      .select({ id: scheduledMessages.id })
      .from(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.bookingId, bookingId),
          inArray(scheduledMessages.status, ["scheduled", "due"]),
        ),
      );
    if (pending.length === 0) return 0;
    await tx
      .update(scheduledMessages)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(scheduledMessages.bookingId, bookingId),
          inArray(scheduledMessages.status, ["scheduled", "due"]),
        ),
      );
    await logActivity(
      {
        entity: "booking",
        entityId: bookingId,
        action: "messages.cancelled",
        userId: actor?.id ?? null,
        meta: { cancelled: pending.length },
      },
      tx,
    );
    return pending.length;
  });
}

/* -------------------------------------------------------------------------- */
/* Due queue                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Flip everything whose moment has arrived (`scripts/process-messages.ts`,
 * cron every 15 minutes per plan §6.S6).
 *
 * One `UPDATE … WHERE status = 'scheduled' AND send_after <= now` — two
 * overlapping cron runs cannot both claim a row, and re-running it is free.
 */
export async function markDueMessages(
  now: Date = new Date(),
  executor: Executor = db,
): Promise<number> {
  const result = await executor
    .update(scheduledMessages)
    .set({ status: "due" })
    .where(
      and(
        eq(scheduledMessages.status, "scheduled"),
        lte(scheduledMessages.sendAfter, now),
      ),
    );
  return affectedRows(result);
}

export type OutboxRow = {
  id: number;
  bookingId: number;
  templateKey: string;
  label: string | null;
  status: ScheduledMessageStatus;
  sendAfter: Date;
  body: string;
  channel: MessageChannel;
  reference: string;
  guestName: string;
  guestPhone: string | null;
  listingId: number;
  listingTitle: string;
  vertical: Vertical;
  /** `null` when the guest left no usable phone — the body is copied by hand. */
  whatsappUrl: string | null;
  sentAt: Date | null;
};

/**
 * The admin outbox (#4): what a human should send right now.
 *
 * `listingIds` scopes it for a future owner-facing view; admins pass nothing.
 */
export async function listOutbox(
  options: {
    statuses?: ScheduledMessageStatus[];
    listingIds?: number[];
    limit?: number;
  } = {},
  executor: Executor = db,
): Promise<OutboxRow[]> {
  const statuses = options.statuses ?? ["due"];
  if (options.listingIds && options.listingIds.length === 0) return [];
  const rows = await executor
    .select({
      scheduled: scheduledMessages,
      label: messageTemplates.label,
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
    .leftJoin(messageTemplates, eq(messageTemplates.id, scheduledMessages.templateId))
    .where(
      and(
        inArray(scheduledMessages.status, statuses),
        options.listingIds ? inArray(bookings.listingId, options.listingIds) : undefined,
      ),
    )
    .orderBy(scheduledMessages.sendAfter)
    .limit(options.limit ?? 200);

  return rows.map((row) => {
    const body = row.scheduled.renderedBody ?? "";
    return {
      id: row.scheduled.id,
      bookingId: row.scheduled.bookingId,
      templateKey: row.scheduled.templateKey,
      label: row.label,
      status: row.scheduled.status,
      sendAfter: row.scheduled.sendAfter,
      body,
      channel: row.scheduled.channel,
      reference: row.reference,
      guestName: row.guestName,
      guestPhone: row.guestPhone,
      listingId: row.listingId,
      listingTitle: row.listingTitle,
      vertical: row.vertical,
      whatsappUrl: whatsappLink(row.guestPhone, body),
      sentAt: row.scheduled.sentAt,
    };
  });
}

export async function countDueMessages(
  options: { listingIds?: number[] } = {},
  executor: Executor = db,
): Promise<number> {
  if (options.listingIds && options.listingIds.length === 0) return 0;
  const [row] = await executor
    .select({ value: sql<number>`count(*)` })
    .from(scheduledMessages)
    .innerJoin(bookings, eq(bookings.id, scheduledMessages.bookingId))
    .where(
      and(
        eq(scheduledMessages.status, "due"),
        options.listingIds ? inArray(bookings.listingId, options.listingIds) : undefined,
      ),
    );
  return Number(row?.value ?? 0);
}

/**
 * "I sent this" (#4).
 *
 * Terminal and single-shot: a second click raises rather than logging the guest
 * a second copy. The conversation row is written in the SAME transaction, so
 * the outbox and the inbox can never disagree about what the guest was told.
 */
export async function markScheduledSent(
  scheduledId: number,
  actor: SessionUser,
  executor?: Executor | null,
): Promise<{ scheduledId: number; messageId: number }> {
  return inTransaction(executor, async (tx) => {
    const [row] = await tx
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, scheduledId))
      .limit(1)
      .for("update");
    if (!row) {
      throw new DomainError("El mensaje no existe", "not_found", { scheduledId });
    }
    if (row.status === "sent") {
      throw new DomainError("Ese mensaje ya fue marcado como enviado", "already_settled", {
        scheduledId,
      });
    }
    if (row.status === "cancelled") {
      throw new DomainError("Ese mensaje fue cancelado", "invalid_transition", { scheduledId });
    }
    const [booking] = await tx
      .select({
        listingId: bookings.listingId,
        guestName: bookings.guestName,
        guestPhone: bookings.guestPhone,
      })
      .from(bookings)
      .where(eq(bookings.id, row.bookingId))
      .limit(1);

    await tx
      .update(scheduledMessages)
      .set({ status: "sent", sentBy: actor.id, sentAt: new Date() })
      .where(eq(scheduledMessages.id, scheduledId));

    const messageId = await insertMessage(
      {
        bookingId: row.bookingId,
        listingId: booking?.listingId ?? null,
        direction: "outbound",
        channel: row.channel,
        contactName: booking?.guestName ?? null,
        contactPhone: booking?.guestPhone ?? null,
        body: row.renderedBody ?? "",
        loggedBy: actor.id,
      },
      tx,
    );

    await logActivity(
      {
        entity: "scheduled_message",
        entityId: scheduledId,
        action: "message.sent",
        userId: actor.id,
        meta: { bookingId: row.bookingId, templateKey: row.templateKey, messageId },
      },
      tx,
    );
    return { scheduledId, messageId };
  });
}

/** Skip one queued message without cancelling the rest of the booking's run. */
export async function cancelScheduledMessage(
  scheduledId: number,
  actor: SessionUser,
  executor?: Executor | null,
): Promise<number> {
  return inTransaction(executor, async (tx) => {
    const [row] = await tx
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, scheduledId))
      .limit(1)
      .for("update");
    if (!row) {
      throw new DomainError("El mensaje no existe", "not_found", { scheduledId });
    }
    if (row.status === "sent") {
      throw new DomainError("Ese mensaje ya fue enviado", "already_settled", { scheduledId });
    }
    await tx
      .update(scheduledMessages)
      .set({ status: "cancelled" })
      .where(eq(scheduledMessages.id, scheduledId));
    await logActivity(
      {
        entity: "scheduled_message",
        entityId: scheduledId,
        action: "message.cancelled",
        userId: actor.id,
        meta: { bookingId: row.bookingId, templateKey: row.templateKey },
      },
      tx,
    );
    return scheduledId;
  });
}

/* -------------------------------------------------------------------------- */
/* Conversation log + unified inbox (#20)                                     */
/* -------------------------------------------------------------------------- */

export type InsertMessageInput = {
  bookingId?: number | null;
  listingId?: number | null;
  direction: MessageDirection;
  channel?: MessageChannel;
  contactName?: string | null;
  contactPhone?: string | null;
  body: string;
  aiDrafted?: boolean;
  loggedBy?: number | null;
};

export async function insertMessage(
  input: InsertMessageInput,
  executor: Executor = db,
): Promise<number> {
  const body = input.body.trim();
  if (!body) throw new DomainError("El mensaje no puede quedar vacío", "invalid_amount");
  if (!input.bookingId && !input.listingId) {
    throw new DomainError("Un mensaje pertenece a una reserva o a una publicación", "not_found");
  }
  const [inserted] = await executor
    .insert(messages)
    .values({
      bookingId: input.bookingId ?? null,
      listingId: input.listingId ?? null,
      direction: input.direction,
      channel: input.channel ?? "whatsapp",
      contactName: input.contactName?.trim() || null,
      contactPhone: input.contactPhone?.trim() || null,
      body,
      aiDrafted: input.aiDrafted ?? false,
      loggedBy: input.loggedBy ?? null,
    })
    .$returningId();
  return inserted!.id;
}

/**
 * Log a message that travelled over WhatsApp (#20).
 *
 * v1 has no WhatsApp Business API (plan §1.5), so the inbox is only as complete
 * as what operators paste into it. That is a deliberate trade: a log a human
 * maintains beats an integration nobody has approved yet.
 */
export async function logMessage(
  input: InsertMessageInput,
  actor: SessionUser,
  executor?: Executor | null,
): Promise<number> {
  return inTransaction(executor, async (tx) => {
    const messageId = await insertMessage({ ...input, loggedBy: actor.id }, tx);
    await logActivity(
      {
        entity: "message",
        entityId: messageId,
        action: `message.logged.${input.direction}`,
        userId: actor.id,
        meta: {
          bookingId: input.bookingId ?? null,
          listingId: input.listingId ?? null,
          aiDrafted: input.aiDrafted ?? false,
        },
      },
      tx,
    );
    return messageId;
  });
}

export type InboxThread = {
  /** `booking:12` or `listing:3` — a booking thread is preferred when one exists. */
  key: string;
  bookingId: number | null;
  listingId: number | null;
  listingTitle: string | null;
  reference: string | null;
  contactName: string | null;
  contactPhone: string | null;
  lastBody: string;
  lastDirection: MessageDirection;
  lastAt: Date;
  total: number;
  /** true when the newest message came from the guest and nobody has replied. */
  awaitingReply: boolean;
};

/**
 * The unified inbox (#20): the latest message per thread, newest first.
 *
 * Grouping happens in SQL (one round trip) and the thread key prefers the
 * booking — a guest asking about a stay they have booked belongs to that
 * booking, not to a second listing-level thread.
 */
export async function listInboxThreads(
  options: { listingIds?: number[]; limit?: number } = {},
  executor: Executor = db,
): Promise<InboxThread[]> {
  if (options.listingIds && options.listingIds.length === 0) return [];
  const threadKey = sql<string>`CASE WHEN ${messages.bookingId} IS NOT NULL
      THEN CONCAT('booking:', ${messages.bookingId})
      ELSE CONCAT('listing:', ${messages.listingId}) END`;

  const grouped = executor
    .select({
      key: sql<string>`CASE WHEN ${messages.bookingId} IS NOT NULL
          THEN CONCAT('booking:', ${messages.bookingId})
          ELSE CONCAT('listing:', ${messages.listingId}) END`.as("thread_key"),
      lastId: sql<number>`MAX(${messages.id})`.as("last_id"),
      // Aliased away from `total` — `bookings.total` is joined below and MySQL
      // would call the reference ambiguous.
      total: sql<number>`COUNT(*)`.as("thread_total"),
    })
    .from(messages)
    .where(
      options.listingIds ? inArray(messages.listingId, options.listingIds) : undefined,
    )
    .groupBy(threadKey)
    .as("threads");

  const rows = await executor
    .select({
      key: grouped.key,
      total: grouped.total,
      message: messages,
      listingTitle: listings.title,
      reference: bookings.reference,
    })
    .from(grouped)
    .innerJoin(messages, eq(messages.id, grouped.lastId))
    .leftJoin(listings, eq(listings.id, messages.listingId))
    .leftJoin(bookings, eq(bookings.id, messages.bookingId))
    .orderBy(desc(messages.createdAt))
    .limit(options.limit ?? 100);

  return rows.map((row) => ({
    key: row.key,
    bookingId: row.message.bookingId,
    listingId: row.message.listingId,
    listingTitle: row.listingTitle,
    reference: row.reference,
    contactName: row.message.contactName,
    contactPhone: row.message.contactPhone,
    lastBody: row.message.body,
    lastDirection: row.message.direction,
    lastAt: row.message.createdAt,
    total: Number(row.total),
    awaitingReply: row.message.direction === "inbound",
  }));
}

/** Every message in one thread, oldest first — the conversation view. */
export async function listThreadMessages(
  thread: { bookingId?: number | null; listingId?: number | null },
  executor: Executor = db,
) {
  if (!thread.bookingId && !thread.listingId) return [];
  return executor
    .select()
    .from(messages)
    .where(
      thread.bookingId
        ? eq(messages.bookingId, thread.bookingId)
        : and(eq(messages.listingId, thread.listingId!), isNull(messages.bookingId)),
    )
    .orderBy(messages.createdAt);
}

export async function countAwaitingReply(
  options: { listingIds?: number[] } = {},
  executor: Executor = db,
): Promise<number> {
  const threads = await listInboxThreads({ ...options, limit: 500 }, executor);
  return threads.filter((thread) => thread.awaitingReply).length;
}

/* -------------------------------------------------------------------------- */
/* Info base (AI grounding + the owner-editable knowledge base)               */
/* -------------------------------------------------------------------------- */

export async function listInfoItems(listingId: number, executor: Executor = db) {
  return executor
    .select()
    .from(infoItems)
    .where(eq(infoItems.listingId, listingId))
    .orderBy(infoItems.sortOrder, infoItems.id);
}

export type UpsertInfoItemInput = {
  listingId: number;
  question: string;
  answer: string;
  sortOrder?: number;
};

/** Keyed on `(listing_id, question)`, so re-saving an answer edits it. */
export async function upsertInfoItem(
  input: UpsertInfoItemInput,
  actor?: SessionUser | null,
  executor: Executor = db,
): Promise<void> {
  const question = input.question.trim();
  const answer = input.answer.trim();
  if (!question || !answer) {
    throw new DomainError("Completá la pregunta y la respuesta", "invalid_amount");
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
  await logActivity(
    {
      entity: "info_item",
      entityId: input.listingId,
      action: "info.upserted",
      userId: actor?.id ?? null,
      meta: { question },
    },
    executor,
  );
}

export async function deleteInfoItem(
  id: number,
  actor?: SessionUser | null,
  executor: Executor = db,
): Promise<void> {
  const [row] = await executor.select().from(infoItems).where(eq(infoItems.id, id)).limit(1);
  if (!row) throw new DomainError("El ítem no existe", "not_found", { id });
  await executor.delete(infoItems).where(eq(infoItems.id, id));
  await logActivity(
    {
      entity: "info_item",
      entityId: row.listingId,
      action: "info.deleted",
      userId: actor?.id ?? null,
      meta: { question: row.question },
    },
    executor,
  );
}

/** Listing ids that have at least one info item — the onboarding `info_base` step. */
export async function listingsWithInfoBase(
  listingIds: number[],
  executor: Executor = db,
): Promise<number[]> {
  if (listingIds.length === 0) return [];
  const rows = await executor
    .selectDistinct({ listingId: infoItems.listingId })
    .from(infoItems)
    .where(inArray(infoItems.listingId, listingIds));
  return rows.map((row) => row.listingId);
}

/* -------------------------------------------------------------------------- */
/* Draft grounding                                                            */
/* -------------------------------------------------------------------------- */

export type DraftSubject = {
  listingId: number;
  listingTitle: string;
  bookingId: number | null;
  bookingReference: string | null;
  guestName: string | null;
  guestPhone: string | null;
  checkIn: string | null;
  checkOut: string | null;
  infoItems: { question: string; answer: string }[];
};

/**
 * Everything the AI draft is allowed to know (plan §5.O9).
 *
 * The model sees this and the guest's question — nothing else. Grounding the
 * draft in `info_items` is what keeps it from inventing a wifi password.
 */
export async function loadDraftSubject(
  input: { bookingId?: number | null; listingId?: number | null },
  executor: Executor = db,
): Promise<DraftSubject | null> {
  let listingId = input.listingId ?? null;
  let booking: typeof bookings.$inferSelect | null = null;

  if (input.bookingId) {
    const [row] = await executor
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (!row) return null;
    booking = row;
    listingId = row.listingId;
  }
  if (!listingId) return null;

  const [listing] = await executor
    .select({ id: listings.id, title: listings.title })
    .from(listings)
    .leftJoin(stayDetails, eq(stayDetails.listingId, listings.id))
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!listing) return null;

  return {
    listingId: listing.id,
    listingTitle: listing.title,
    bookingId: booking?.id ?? null,
    bookingReference: booking?.reference ?? null,
    guestName: booking?.guestName ?? null,
    guestPhone: booking?.guestPhone ?? null,
    checkIn: booking ? formatWhen(booking.startAt) : null,
    checkOut: booking ? formatWhen(booking.endAt) : null,
    infoItems: (await listInfoItems(listing.id, executor)).map((item) => ({
      question: item.question,
      answer: item.answer,
    })),
  };
}
