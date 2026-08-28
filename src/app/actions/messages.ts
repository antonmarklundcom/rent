"use server";

/**
 * Server actions for the comms engine (#4, #11, #20 — plan §5.O9).
 *
 * Same shape as every other action file: `requireRole` first, owner scoping
 * through `src/lib/scope.ts`, and the engine functions themselves take no
 * session.
 *
 * The outbox, the inbox and the templates are an ADMIN surface — plan §5.O9
 * says so, and plan §5.O10 gives the owner panel a listing info-base editor
 * instead. So the info-base actions are owner-scoped and everything else is
 * admin-only.
 *
 * Nothing here sends a message to a guest. "Marcar enviado" records that a
 * human sent it from their own WhatsApp (plan §1.5).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MESSAGE_ANCHORS } from "@/lib/messaging";
import {
  cancelScheduledMessage,
  getScheduledMessage,
  logMessage,
  markScheduledSent,
  parseThreadKey,
  upsertTemplate,
} from "@/db/queries/messages";
import { deleteInfoItem, getInfoItem, loadDraftGrounding, upsertInfoItem } from "@/db/queries/info";
import { draftReply } from "@/lib/ai-drafts";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { assertCanAccessListing } from "@/lib/scope";
import { toFormState } from "@/app/actions/form";

function revalidateComms() {
  revalidatePath("/admin/mensajes");
  revalidatePath("/admin");
  revalidatePath("/panel");
}

function requireThread(key: string): { bookingId: number | null; listingId: number | null } {
  const thread = parseThreadKey(key);
  if (!thread) throw new DomainError("Conversación inválida", "not_found", { key });
  return thread;
}

/* -------------------------------------------------------------------------- */
/* Outbox                                                                      */
/* -------------------------------------------------------------------------- */

const idSchema = z.coerce.number().int().positive();

export async function markMessageSentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const user = await requireRole(ADMIN_ROLES);
    const id = idSchema.parse(formData.get("scheduledId"));
    const row = await getScheduledMessage(id);
    if (!row) throw new DomainError("El mensaje no existe", "not_found", { id });
    await markScheduledSent(id, user);
    revalidateComms();
    return `Mensaje de ${row.reference} marcado como enviado`;
  });
}

export async function cancelMessageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const user = await requireRole(ADMIN_ROLES);
    const id = idSchema.parse(formData.get("scheduledId"));
    const row = await getScheduledMessage(id);
    if (!row) throw new DomainError("El mensaje no existe", "not_found", { id });
    await cancelScheduledMessage(id, user);
    revalidateComms();
    return "Mensaje cancelado — no se va a enviar";
  });
}

/* -------------------------------------------------------------------------- */
/* Conversation log (#20)                                                      */
/* -------------------------------------------------------------------------- */

const logSchema = z.object({
  thread: z.string().trim().min(2).max(24),
  direction: z.enum(["inbound", "outbound"]),
  channel: z.enum(["whatsapp", "web"]).default("whatsapp"),
  body: z.string().trim().min(1).max(4000),
  aiDrafted: z.boolean().default(false),
  contactName: z.string().trim().max(180).nullish(),
  contactPhone: z.string().trim().max(40).nullish(),
});

/**
 * Log a message that happened on WhatsApp. v1's delivery is a human's phone,
 * so the log is typed in by hand — which is exactly why the inbox exists.
 */
export async function logMessageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const user = await requireRole(ADMIN_ROLES);
    const input = logSchema.parse({
      thread: formData.get("thread"),
      direction: formData.get("direction"),
      channel: formData.get("channel") ?? "whatsapp",
      body: formData.get("body"),
      aiDrafted: formData.get("aiDrafted") === "on",
      contactName: formData.get("contactName") || null,
      contactPhone: formData.get("contactPhone") || null,
    });
    const thread = requireThread(input.thread);
    await logMessage(
      {
        bookingId: thread.bookingId,
        listingId: thread.listingId,
        direction: input.direction,
        channel: input.channel,
        contactName: input.contactName ?? null,
        contactPhone: input.contactPhone ?? null,
        body: input.body,
        aiDrafted: input.aiDrafted,
      },
      user,
    );
    revalidatePath(`/admin/mensajes/${input.thread}`);
    revalidateComms();
    return input.direction === "inbound" ? "Consulta registrada" : "Respuesta registrada";
  });
}

/* -------------------------------------------------------------------------- */
/* AI drafts                                                                   */
/* -------------------------------------------------------------------------- */

export type DraftState = FormState & { draft?: string };

const draftSchema = z.object({
  listingId: z.coerce.number().int().positive(),
  question: z.string().trim().min(3).max(2000),
  bookingId: z.coerce.number().int().positive().nullish(),
});

/**
 * Suggest a reply. The draft comes back into the form for a human to edit and
 * then log — this action never writes a message and never sends one.
 */
export async function draftReplyAction(
  _prev: DraftState,
  formData: FormData,
): Promise<DraftState> {
  try {
    await requireRole(ADMIN_ROLES);
    const input = draftSchema.parse({
      listingId: formData.get("listingId"),
      question: formData.get("question"),
      bookingId: formData.get("bookingId") || null,
    });

    const grounding = await loadDraftGrounding(input.listingId);
    const result = await draftReply(input.question, grounding);
    if (!result.ok) return { ok: false, error: result.notice };
    return { ok: true, message: "Borrador sugerido — revisalo antes de enviarlo", draft: result.draft };
  } catch (error) {
    return toFormState(async () => {
      throw error;
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Info base (grounding for the drafts; owner-editable)                         */
/* -------------------------------------------------------------------------- */

const infoSchema = z.object({
  listingId: z.coerce.number().int().positive(),
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(2).max(4000),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export async function saveInfoItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const user = await requireRole(["super_admin", "admin", "owner"]);
    const input = infoSchema.parse({
      listingId: formData.get("listingId"),
      question: formData.get("question"),
      answer: formData.get("answer"),
      sortOrder: formData.get("sortOrder") || 0,
    });
    await assertCanAccessListing(user, input.listingId);
    await upsertInfoItem(input);
    revalidatePath("/panel/informacion");
    revalidateComms();
    return "Respuesta guardada en la base de información";
  });
}

export async function deleteInfoItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const user = await requireRole(["super_admin", "admin", "owner"]);
    const id = idSchema.parse(formData.get("infoItemId"));
    const item = await getInfoItem(id);
    if (!item) throw new DomainError("Esa respuesta ya no existe", "not_found", { id });
    await assertCanAccessListing(user, item.listingId);
    await deleteInfoItem(id);
    revalidatePath("/panel/informacion");
    return "Respuesta borrada";
  });
}

/* -------------------------------------------------------------------------- */
/* Templates (admin only — a template is global)                               */
/* -------------------------------------------------------------------------- */

const templateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/, "La clave usa minúsculas, números y guión bajo"),
  label: z.string().trim().min(3).max(160),
  body: z.string().trim().min(5).max(4000),
  anchor: z.enum(MESSAGE_ANCHORS),
  offsetMinutes: z.coerce.number().int().min(-43200).max(43200),
  vertical: z.enum(["stay", "car"]).nullish(),
  isActive: z.boolean().default(true),
});

export async function saveTemplateAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    await requireRole(ADMIN_ROLES);
    const input = templateSchema.parse({
      key: formData.get("key"),
      label: formData.get("label"),
      body: formData.get("body"),
      anchor: formData.get("anchor"),
      offsetMinutes: formData.get("offsetMinutes") || 0,
      vertical: formData.get("vertical") || null,
      isActive: formData.get("isActive") !== "off",
    });
    await upsertTemplate({ ...input, vertical: input.vertical ?? null });
    revalidatePath("/admin/mensajes/plantillas");
    return `Plantilla "${input.label}" guardada`;
  });
}
