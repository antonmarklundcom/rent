"use server";

/**
 * Server actions over the comms engine (plan §5.O9 — #4, #11, #20 + AI drafts).
 *
 * Same gate discipline as every other action file: `requireRole` first, owner
 * scoping through `src/lib/scope.ts`, engine functions take no session. The
 * outbox and inbox are admin surfaces in v1 (owners get read-only comms later
 * — logged in KNOWN-ISSUES.md).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  cancelScheduledMessage,
  enqueueBookingMessages,
  loadDraftSubject,
  logMessage,
  markDueMessages,
  markScheduledSent,
  updateTemplate,
  upsertInfoItem,
  deleteInfoItem,
} from "@/db/queries/messages";
import { ADMIN_ROLES } from "@/lib/auth-core";
import { requireRole } from "@/lib/auth";
import { assertCanAccessBooking, assertCanAccessListing } from "@/lib/scope";
import { toFormState } from "@/app/actions/form";
import type { FormState } from "@/lib/form-state";
import { draftReply } from "@/lib/ai-draft";
import { assertQuestion } from "@/lib/messaging";

const id = z.coerce.number().int().positive();

/* -------------------------------------------------------------------------- */
/* Outbox (#4)                                                                */
/* -------------------------------------------------------------------------- */

/** "I sent this on WhatsApp" — the only way a queued message becomes `sent`. */
export async function markSentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const scheduledId = id.parse(formData.get("scheduledId"));
    await markScheduledSent(scheduledId, user);
    revalidatePath("/admin/mensajes");
    revalidatePath("/admin/inbox");
    return "Mensaje marcado como enviado y registrado en la conversación";
  });
}

/** Skip one message without cancelling the rest of the booking's sequence. */
export async function cancelMessageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const scheduledId = id.parse(formData.get("scheduledId"));
    await cancelScheduledMessage(scheduledId, user);
    revalidatePath("/admin/mensajes");
    return "Mensaje cancelado";
  });
}

/** Run the "due" sweep from the UI — the same call the cron makes. */
export async function processDueAction(): Promise<FormState> {
  await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const flipped = await markDueMessages();
    revalidatePath("/admin/mensajes");
    return `${flipped} mensaje(s) pasaron a "para enviar"`;
  });
}

/** Re-queue a booking's sequence — idempotent, so it only fills the gaps. */
export async function enqueueForBookingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const bookingId = id.parse(formData.get("bookingId"));
    await assertCanAccessBooking(user, bookingId);
    const result = await enqueueBookingMessages(bookingId, {}, user);
    revalidatePath("/admin/mensajes");
    revalidatePath(`/admin/reservas/${bookingId}`);
    return result.created === 0
      ? "La secuencia ya estaba completa"
      : `${result.created} mensaje(s) agendados`;
  });
}

/* -------------------------------------------------------------------------- */
/* Inbox (#20)                                                                */
/* -------------------------------------------------------------------------- */

const logSchema = z.object({
  bookingId: z.coerce.number().int().positive().nullish(),
  listingId: z.coerce.number().int().positive().nullish(),
  direction: z.enum(["inbound", "outbound"]),
  body: z.string().trim().min(1).max(4000),
  contactName: z.string().trim().max(180).nullish(),
  contactPhone: z.string().trim().max(40).nullish(),
  aiDrafted: z.coerce.boolean().optional(),
});

/** Record what was said on WhatsApp. v1 has no API, so a human logs it. */
export async function logMessageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const input = logSchema.parse({
      bookingId: formData.get("bookingId") || null,
      listingId: formData.get("listingId") || null,
      direction: formData.get("direction") ?? "outbound",
      body: formData.get("body"),
      contactName: formData.get("contactName") || null,
      contactPhone: formData.get("contactPhone") || null,
      aiDrafted: formData.get("aiDrafted") === "1",
    });
    if (input.bookingId) await assertCanAccessBooking(user, input.bookingId);
    else if (input.listingId) await assertCanAccessListing(user, input.listingId);

    await logMessage(input, user);
    revalidatePath("/admin/inbox");
    return "Mensaje registrado";
  });
}

/* -------------------------------------------------------------------------- */
/* AI drafts                                                                  */
/* -------------------------------------------------------------------------- */

export type DraftActionResult = {
  ok: boolean;
  draft?: string;
  notice?: string;
};

/**
 * Draft a reply for a human to approve (plan §5.O9).
 *
 * Returns text; it does not write a `messages` row. Saving happens only when
 * the operator submits `logMessageAction` with `aiDrafted=1` — so "the AI
 * suggested this" and "we said this to a guest" stay two different facts.
 */
export async function draftReplyAction(input: {
  bookingId?: number | null;
  listingId?: number | null;
  question: string;
}): Promise<DraftActionResult> {
  const user = await requireRole(ADMIN_ROLES);
  const question = assertQuestion(input.question);
  if (input.bookingId) await assertCanAccessBooking(user, input.bookingId);
  else if (input.listingId) await assertCanAccessListing(user, input.listingId);

  const subject = await loadDraftSubject({
    bookingId: input.bookingId ?? null,
    listingId: input.listingId ?? null,
  });
  if (!subject) return { ok: false, notice: "No encontramos la reserva o la publicación" };

  const outcome = await draftReply(
    {
      listingTitle: subject.listingTitle,
      guestName: subject.guestName,
      bookingReference: subject.bookingReference,
      checkIn: subject.checkIn,
      checkOut: subject.checkOut,
      infoItems: subject.infoItems,
    },
    question,
  );
  return outcome.ok
    ? { ok: true, draft: outcome.draft }
    : { ok: false, notice: outcome.message };
}

/* -------------------------------------------------------------------------- */
/* Templates + info base                                                      */
/* -------------------------------------------------------------------------- */

export async function updateTemplateAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const templateId = id.parse(formData.get("templateId"));
    await updateTemplate(
      templateId,
      {
        label: String(formData.get("label") ?? "").trim() || undefined,
        body: String(formData.get("body") ?? "").trim() || undefined,
        offsetMinutes: formData.get("offsetMinutes")
          ? Number(formData.get("offsetMinutes"))
          : undefined,
        isActive: formData.get("isActive") === "1",
      },
      user,
    );
    revalidatePath("/admin/plantillas");
    return "Plantilla actualizada";
  });
}

/**
 * The info base an owner fills in and the AI draft reads (plan §5.O10).
 * Owners may edit their OWN listings' items — this is their knowledge, and
 * making them wait for an admin is how info bases stay empty.
 */
export async function saveInfoItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(["super_admin", "admin", "owner"]);
  return toFormState(async () => {
    const listingId = id.parse(formData.get("listingId"));
    await assertCanAccessListing(user, listingId);
    await upsertInfoItem(
      {
        listingId,
        question: String(formData.get("question") ?? ""),
        answer: String(formData.get("answer") ?? ""),
        sortOrder: Number(formData.get("sortOrder") ?? 0) || 0,
      },
      user,
    );
    revalidatePath("/panel");
    revalidatePath(`/panel/publicaciones/${listingId}`);
    return "Información guardada";
  });
}

export async function deleteInfoItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(["super_admin", "admin", "owner"]);
  return toFormState(async () => {
    const listingId = id.parse(formData.get("listingId"));
    await assertCanAccessListing(user, listingId);
    await deleteInfoItem(id.parse(formData.get("infoItemId")), user);
    revalidatePath(`/panel/publicaciones/${listingId}`);
    return "Ítem eliminado";
  });
}
