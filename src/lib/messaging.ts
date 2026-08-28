/**
 * The pure half of the comms engine (plan §5.O9, feature #4/#11).
 *
 * Everything here is a calculator: no database, no session, no Next.js — so
 * `scripts/verify-logic.ts` pins it without a MySQL server, and the queue, the
 * outbox and the cron processor all agree on what "due" and "rendered" mean.
 *
 * v1 delivery is deliberately manual (plan §1.5): nothing sends. The engine
 * decides WHAT to say and WHEN it becomes due; a human taps the wa.me link and
 * marks it sent. That keeps us off the WhatsApp Business API until the volume
 * justifies it, and it means a bad template can never spam a guest.
 */
import { DomainError } from "@/lib/errors";

/* -------------------------------------------------------------------------- */
/* Trigger events                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The five moments a message hangs off (plan §3.D #4/#11).
 *
 * `message_templates.trigger_event` stores one of these keys and
 * `offset_minutes` shifts it. The ANCHOR — which booking timestamp the offset
 * is measured from — lives here rather than in the row, because it is a
 * property of the event, not of the copy: an admin editing a template must not
 * be able to accidentally re-anchor a pre-arrival to the checkout date.
 */
export const MESSAGE_EVENTS = [
  "booking_confirmed",
  "pre_arrival",
  "check_in",
  "checkout",
  "post_stay",
] as const;

export type MessageEvent = (typeof MESSAGE_EVENTS)[number];

/** Which booking timestamp `offset_minutes` is measured from. */
export type MessageAnchor = "confirmed_at" | "start_at" | "end_at";

const EVENT_ANCHORS: Record<MessageEvent, MessageAnchor> = {
  booking_confirmed: "confirmed_at",
  pre_arrival: "start_at",
  check_in: "start_at",
  checkout: "end_at",
  post_stay: "end_at",
};

export function isMessageEvent(value: string | null | undefined): value is MessageEvent {
  return !!value && (MESSAGE_EVENTS as readonly string[]).includes(value);
}

export function anchorFor(event: MessageEvent): MessageAnchor {
  return EVENT_ANCHORS[event];
}

export type ScheduleAnchors = {
  /** When the booking was confirmed — normally "now" at enqueue time. */
  confirmedAt: Date;
  startAt: Date;
  endAt: Date;
};

/**
 * When a message becomes due.
 *
 * The result is NOT clamped to the future. A booking confirmed the day it ends
 * legitimately produces a pre-arrival whose moment has passed; the outbox shows
 * it as overdue and the operator decides whether to send or cancel it. Silently
 * pushing it to "now" would hide that the guest never got a heads-up.
 */
export function scheduleFor(
  event: MessageEvent,
  offsetMinutes: number,
  anchors: ScheduleAnchors,
): Date {
  const base =
    anchorFor(event) === "confirmed_at"
      ? anchors.confirmedAt
      : anchorFor(event) === "start_at"
        ? anchors.startAt
        : anchors.endAt;
  return new Date(base.getTime() + offsetMinutes * 60_000);
}

/** A queued message is due once its moment has arrived (`scripts/process-messages.ts`). */
export function isDue(sendAfter: Date, now: Date = new Date()): boolean {
  return sendAfter.getTime() <= now.getTime();
}

/* -------------------------------------------------------------------------- */
/* Placeholders                                                               */
/* -------------------------------------------------------------------------- */

/** Every placeholder a template body may use. Anything else is a typo. */
export const TEMPLATE_PLACEHOLDERS = [
  "guest_name",
  "listing_title",
  "reference",
  "check_in",
  "check_out",
  "total",
  "guest_count",
  "contact_phone",
  "review_link",
] as const;

export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

export type TemplateVars = Partial<Record<TemplatePlaceholder, string | null>>;

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export type RenderResult = {
  body: string;
  /** Placeholders the caller supplied no value for — rendered as "". */
  missing: string[];
  /** Placeholders that are not in `TEMPLATE_PLACEHOLDERS` at all. */
  unknown: string[];
};

/**
 * Fill `{{placeholder}}` slots.
 *
 * Never throws: a template with a typo still produces a body a human can read
 * and fix by hand in the outbox. The two lists are what the admin template
 * editor shows so the typo gets fixed at the source.
 */
export function renderTemplate(body: string, vars: TemplateVars): RenderResult {
  const missing: string[] = [];
  const unknown: string[] = [];
  const out = body.replace(PLACEHOLDER_RE, (_match, rawKey: string) => {
    const key = rawKey as TemplatePlaceholder;
    if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(key)) {
      if (!unknown.includes(rawKey)) unknown.push(rawKey);
      return "";
    }
    const value = vars[key];
    if (value === undefined || value === null || value === "") {
      if (!missing.includes(key)) missing.push(key);
      return "";
    }
    return value;
  });
  // Collapse the double spaces an empty slot leaves behind, per line.
  const cleaned = out
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n");
  return { body: cleaned, missing, unknown };
}

/** Placeholders a body references, in order of first appearance. */
export function placeholdersIn(body: string): string[] {
  const found: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    const key = match[1];
    if (!found.includes(key)) found.push(key);
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* WhatsApp                                                                   */
/* -------------------------------------------------------------------------- */

const PY_COUNTRY_CODE = "595";

/**
 * Paraguayan phone → the digits wa.me wants (no `+`, no spaces).
 *
 * People type `0981 123 456`, `+595 981 123456` and `(0981) 123-456` for the
 * same number. wa.me accepts exactly one of those shapes, so normalising is not
 * cosmetic: an un-normalised link opens an empty chat and the operator quietly
 * loses the message.
 *
 * Returns `null` when there is nothing plausible to dial — the outbox then
 * shows the body to copy by hand instead of a dead link.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  // 00595... — the international prefix people dial from a landline.
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith(PY_COUNTRY_CODE)) {
    const rest = digits.slice(PY_COUNTRY_CODE.length);
    // 595 followed by a national trunk 0 (595 0981 …) — drop the 0.
    digits = PY_COUNTRY_CODE + (rest.startsWith("0") ? rest.slice(1) : rest);
  } else if (digits.startsWith("0")) {
    digits = PY_COUNTRY_CODE + digits.slice(1);
  } else if (digits.length <= 10) {
    // A local number typed without its 0 (981123456).
    digits = PY_COUNTRY_CODE + digits;
  }
  // 595 + 9 national digits = 12; allow 8–15 total for foreign guests.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** `https://wa.me/595981123456?text=…` — one tap opens WhatsApp with the body. */
export function whatsappLink(
  phone: string | null | undefined,
  body: string,
): string | null {
  const digits = normalisePhone(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}

/* -------------------------------------------------------------------------- */
/* AI draft grounding                                                         */
/* -------------------------------------------------------------------------- */

export type InfoItem = { question: string; answer: string };

export type DraftContext = {
  listingTitle: string;
  guestName?: string | null;
  bookingReference?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  infoItems: InfoItem[];
};

export const DRAFT_SYSTEM_PROMPT = [
  "Sos el asistente de alquilar.com.py, una empresa paraguaya que administra alojamientos y autos de alquiler.",
  "Redactás borradores de respuestas de WhatsApp para que un humano los revise y envíe. Nunca se envían solos.",
  "Reglas:",
  "- Escribí en castellano paraguayo con voseo (tenés, podés, escribinos), cordial y breve: 2 a 5 oraciones.",
  "- Respondé ÚNICAMENTE con datos que aparezcan en la información de la propiedad o de la reserva.",
  "- Si el dato no está, decí que lo consultás y que respondés en un rato. Nunca inventes precios, direcciones, horarios ni políticas.",
  "- No prometas descuentos, reembolsos ni excepciones.",
  "- Devolvé solamente el texto del mensaje, sin saludos de encabezado tipo 'Asunto:' ni comillas.",
].join("\n");

/**
 * The grounding block. Kept pure and deterministic so the prompt is stable —
 * a prompt that changes shape per request cannot be cached and cannot be
 * reviewed.
 */
export function buildDraftPrompt(context: DraftContext, question: string): string {
  const lines: string[] = [];
  lines.push(`Propiedad: ${context.listingTitle}`);
  if (context.bookingReference) lines.push(`Reserva: ${context.bookingReference}`);
  if (context.guestName) lines.push(`Huésped: ${context.guestName}`);
  if (context.checkIn) lines.push(`Check-in: ${context.checkIn}`);
  if (context.checkOut) lines.push(`Check-out: ${context.checkOut}`);
  lines.push("");
  lines.push("Información disponible de la propiedad:");
  if (context.infoItems.length === 0) {
    lines.push("(no hay información cargada para esta propiedad)");
  } else {
    for (const item of context.infoItems) {
      lines.push(`- ${item.question}: ${item.answer}`);
    }
  }
  lines.push("");
  lines.push("Consulta del huésped:");
  lines.push(question.trim());
  return lines.join("\n");
}

export function assertQuestion(question: string): string {
  const trimmed = question.trim();
  if (trimmed.length < 3) {
    throw new DomainError("Escribí la consulta del huésped", "invalid_amount");
  }
  if (trimmed.length > 2000) {
    throw new DomainError("La consulta es demasiado larga", "invalid_amount");
  }
  return trimmed;
}
