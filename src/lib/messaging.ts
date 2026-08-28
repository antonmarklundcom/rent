/**
 * Message sequences (#4, #11 — plan §5.O9), pure: no database, no Next.js.
 *
 * A booking event produces a QUEUE of messages, never a send. Plan §1.5 keeps
 * WhatsApp Business API out of v1, so delivery is a human tapping a `wa.me`
 * link in the admin outbox. Everything here is the part that can be pinned by
 * `scripts/verify-logic.ts` without a database: which templates a sequence
 * contains, when each one becomes due, how a body renders, and what the
 * resulting deep link looks like.
 */
import { DomainError } from "@/lib/errors";
import type { Vertical } from "@/db/schema";

/* -------------------------------------------------------------------------- */
/* Anchors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What a template's `offset_minutes` is measured from.
 *
 * `confirmed` is the instant the booking was confirmed; the other two are the
 * booking's own range. Storing the anchor as the template's `trigger_event`
 * (a varchar in `message_templates`) means adding "3 days after checkout" is a
 * row, not a deploy.
 */
export const MESSAGE_ANCHORS = ["confirmed", "start_at", "end_at"] as const;
export type MessageAnchor = (typeof MESSAGE_ANCHORS)[number];

export function isMessageAnchor(value: string | null | undefined): value is MessageAnchor {
  return !!value && (MESSAGE_ANCHORS as readonly string[]).includes(value);
}

export type SequenceContext = {
  /** When the booking was confirmed — the `confirmed` anchor. */
  confirmedAt: Date;
  startAt: Date;
  endAt: Date;
};

/** The instant a template's message becomes sendable. */
export function sendAfterFor(
  anchor: MessageAnchor,
  offsetMinutes: number,
  context: SequenceContext,
): Date {
  const base =
    anchor === "confirmed"
      ? context.confirmedAt
      : anchor === "start_at"
        ? context.startAt
        : context.endAt;
  return new Date(base.getTime() + offsetMinutes * 60_000);
}

/* -------------------------------------------------------------------------- */
/* Placeholders                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The complete placeholder vocabulary. A template may only use these; anything
 * else is a typo, and `renderTemplate` reports it rather than shipping
 * `{{huesped}}` to a guest.
 */
export const TEMPLATE_PLACEHOLDERS = [
  "guestName",
  "listingTitle",
  "reference",
  "checkIn",
  "checkOut",
  "units",
  "total",
  "location",
  "reviewLink",
  "brand",
] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

export type TemplateVars = Partial<Record<TemplatePlaceholder, string>>;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export type RenderedTemplate = {
  body: string;
  /** Placeholders the template asked for that this booking could not fill. */
  missing: string[];
  /** Placeholders that are not in `TEMPLATE_PLACEHOLDERS` at all. */
  unknown: string[];
};

/**
 * Substitute `{{placeholder}}` tokens.
 *
 * An empty value is dropped along with the rest of its line when the line
 * carries nothing else — that is what keeps the review-request template
 * readable when `GBP_REVIEW_LINK` is unset (plan §4.5: a missing env value
 * degrades a feature, it never breaks it).
 */
export function renderTemplate(body: string, vars: TemplateVars): RenderedTemplate {
  const missing: string[] = [];
  const unknown: string[] = [];
  const known = new Set<string>(TEMPLATE_PLACEHOLDERS);

  const rendered = body.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (!known.has(name)) {
      if (!unknown.includes(name)) unknown.push(name);
      return "";
    }
    const value = vars[name as TemplatePlaceholder];
    if (value === undefined || value === null || value === "") {
      if (!missing.includes(name)) missing.push(name);
      return "";
    }
    return value;
  });

  const cleaned = rendered
    .split("\n")
    .filter((line, index, lines) => {
      // Drop a line that became blank only because a placeholder was empty.
      if (line.trim() !== "") return true;
      const source = body.split("\n")[index];
      return !(source !== undefined && source.trim() !== "");
    })
    .join("\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { body: cleaned, missing, unknown };
}

/** Which placeholders a template body references (admin template editor). */
export function placeholdersUsed(body: string): string[] {
  const out: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    const name = match[1]!;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Guest-facing formatting                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Paraguay's civil time. The database stores UTC (plan §9), but a guest reading
 * "llegada: 14:00" must see the clock on the wall in Asunción, not in UTC.
 */
const PY_TIME_ZONE = "America/Asuncion";

const DATE_TIME_FMT = new Intl.DateTimeFormat("es-PY", {
  timeZone: PY_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DATE_FMT = new Intl.DateTimeFormat("es-PY", {
  timeZone: PY_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatLocalDateTime(date: Date): string {
  return DATE_TIME_FMT.format(date).replace(",", "");
}

export function formatLocalDate(date: Date): string {
  return DATE_FMT.format(date);
}

/* -------------------------------------------------------------------------- */
/* WhatsApp deep links                                                         */
/* -------------------------------------------------------------------------- */

/** Paraguay's country code — the default for a locally-written phone number. */
const PY_COUNTRY_CODE = "595";

/**
 * Normalise a phone number to the digits `wa.me` wants (country code, no `+`).
 *
 * Paraguayan numbers are written half a dozen ways — `0981 123 456`,
 * `+595 981 123456`, `(0981) 123-456`. All of them are the same phone, and the
 * outbox must produce the same link for each.
 */
export function normalisePhone(
  raw: string | null | undefined,
  countryCode = PY_COUNTRY_CODE,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hadPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (!hadPlus) {
    // A national number: `0981…` drops its trunk 0 and takes the country code.
    if (digits.startsWith("0")) digits = countryCode + digits.replace(/^0+/, "");
    else if (!digits.startsWith(countryCode)) digits = countryCode + digits;
  }
  // 7 digits is a landline without an area code; 15 is E.164's ceiling.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** `wa.me` deep link with the body pre-filled. Null when there is no phone. */
export function waLink(phone: string | null | undefined, body: string): string | null {
  const digits = normalisePhone(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}

/* -------------------------------------------------------------------------- */
/* The seeded sequence (plan §3.D)                                             */
/* -------------------------------------------------------------------------- */

export type SequenceTemplate = {
  key: string;
  label: string;
  anchor: MessageAnchor;
  offsetMinutes: number;
  /** null → applies to both verticals; a vertical-specific row wins over it. */
  vertical: Vertical | null;
  body: string;
};

const MINUTES_PER_DAY = 1440;

/**
 * The five es-PY (voseo) touchpoints from plan §3.D, plus one car-specific
 * override proving per-vertical resolution works.
 *
 * Seeded, not hardcoded: `scripts/seed.ts` upserts these into
 * `message_templates`, and an admin edits them from `/admin/mensajes`. This
 * array is the DEFAULT, not the runtime source of truth.
 */
export const DEFAULT_SEQUENCE: SequenceTemplate[] = [
  {
    key: "booking_confirmed",
    label: "Reserva confirmada",
    anchor: "confirmed",
    offsetMinutes: 0,
    vertical: null,
    body: [
      "¡Hola {{guestName}}! Te confirmamos tu reserva en {{listingTitle}}.",
      "",
      "Código: {{reference}}",
      "Desde: {{checkIn}}",
      "Hasta: {{checkOut}}",
      "Total: {{total}}",
      "",
      "Cualquier cosa escribinos por acá. ¡Te esperamos!",
      "{{brand}}",
    ].join("\n"),
  },
  {
    key: "pre_arrival",
    label: "Un día antes de la llegada",
    anchor: "start_at",
    offsetMinutes: -MINUTES_PER_DAY,
    vertical: null,
    body: [
      "¡Hola {{guestName}}! Mañana te esperamos en {{listingTitle}}.",
      "",
      "Llegada: {{checkIn}}",
      "Dirección: {{location}}",
      "Código de reserva: {{reference}}",
      "",
      "Contanos a qué hora llegás así te dejamos todo listo.",
    ].join("\n"),
  },
  {
    key: "pre_arrival_car",
    label: "Un día antes del retiro (autos)",
    anchor: "start_at",
    offsetMinutes: -MINUTES_PER_DAY,
    vertical: "car",
    body: [
      "¡Hola {{guestName}}! Mañana retirás el {{listingTitle}}.",
      "",
      "Retiro: {{checkIn}}",
      "Lugar: {{location}}",
      "Reserva: {{reference}}",
      "",
      "Acordate de traer tu cédula o licencia vigente. Hacemos juntos la",
      "revisión de entrega (fotos, kilometraje y combustible) antes de salir.",
    ].join("\n"),
  },
  {
    key: "check_in",
    label: "Día de llegada",
    anchor: "start_at",
    offsetMinutes: 0,
    vertical: null,
    body: [
      "¡Hola {{guestName}}! Ya está todo listo en {{listingTitle}}.",
      "",
      "Si necesitás algo durante tu estadía, escribinos por acá — respondemos",
      "rápido. ¡Que la pases muy bien!",
      "{{brand}}",
    ].join("\n"),
  },
  {
    key: "check_out",
    label: "Día de salida",
    anchor: "end_at",
    offsetMinutes: 0,
    vertical: null,
    body: [
      "¡Hola {{guestName}}! Hoy terminás tu reserva {{reference}} en",
      "{{listingTitle}}. La salida es a las {{checkOut}}.",
      "",
      "Dejanos las llaves donde te indicamos y avisanos cuando salgas.",
      "¡Gracias por elegirnos!",
    ].join("\n"),
  },
  {
    key: "review_request",
    label: "Pedido de reseña (Google) — un día después",
    anchor: "end_at",
    offsetMinutes: MINUTES_PER_DAY,
    vertical: null,
    body: [
      "¡Hola {{guestName}}! Esperamos que hayas disfrutado {{listingTitle}}.",
      "",
      "¿Nos dejás tu opinión en Google? Nos ayuda muchísimo y te lleva un minuto:",
      "{{reviewLink}}",
      "",
      "¡Gracias! {{brand}}",
    ].join("\n"),
  },
];

/**
 * Pick the template that applies to a vertical: a `car`/`stay` row beats the
 * generic one with the same anchor and offset, so `pre_arrival_car` replaces
 * `pre_arrival` for a vehicle instead of both being queued.
 */
export function selectSequenceFor<
  T extends { key: string; anchor: MessageAnchor; offsetMinutes: number; vertical: Vertical | null },
>(templates: T[], vertical: Vertical): T[] {
  const chosen = new Map<string, T>();
  for (const template of templates) {
    if (template.vertical && template.vertical !== vertical) continue;
    // Same anchor + offset = the same touchpoint in the sequence.
    const slot = `${template.anchor}@${template.offsetMinutes}`;
    const current = chosen.get(slot);
    if (!current || (!current.vertical && template.vertical)) chosen.set(slot, template);
  }
  return [...chosen.values()].sort(
    (a, b) => a.anchor.localeCompare(b.anchor) || a.offsetMinutes - b.offsetMinutes,
  );
}

export function assertTemplateBody(body: string): void {
  const trimmed = body.trim();
  if (trimmed.length < 5) {
    throw new DomainError("El texto de la plantilla es demasiado corto", "invalid_amount");
  }
  const unknown = placeholdersUsed(trimmed).filter(
    (name) => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name),
  );
  if (unknown.length > 0) {
    throw new DomainError(
      `Estas variables no existen: ${unknown.map((u) => `{{${u}}}`).join(", ")}`,
      "invalid_amount",
      { unknown },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Thread keys (#20)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A conversation is keyed by its booking when it has one and by its listing
 * otherwise — `b12` / `l7`. Opaque and URL-safe, so `/admin/mensajes/b12` needs
 * no second query parameter.
 */
export function threadKey(bookingId: number | null, listingId: number | null): string {
  return bookingId ? `b${bookingId}` : `l${listingId ?? 0}`;
}

/** `b12` / `l7` back into its parts. Returns null for anything malformed. */
export function parseThreadKey(
  key: string,
): { bookingId: number | null; listingId: number | null } | null {
  const match = /^([bl])(\d+)$/.exec(key.trim());
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return match[1] === "b" ? { bookingId: id, listingId: null } : { bookingId: null, listingId: id };
}
