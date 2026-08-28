/**
 * iCalendar (RFC 5545) parsing and generation (plan §5.O5).
 *
 * Pure and dependency-free: `scripts/verify-logic.ts` pins the date handling
 * without a network or a database, which is the whole point — a TZ bug here
 * silently double-books a listing.
 *
 * What we care about from an inbound feed (Airbnb, Booking.com, Google):
 * `UID`, `DTSTART`, `DTEND`, `SUMMARY`, `STATUS`. Everything else is ignored.
 *
 * The three date forms that actually appear in the wild:
 *   DTSTART;VALUE=DATE:20260304          all-day; DTEND is EXCLUSIVE
 *   DTSTART:20260304T140000Z             UTC
 *   DTSTART;TZID=America/Asuncion:...    floating local time in a named zone
 *
 * All-day ranges are materialised at UTC midnight, which lines up with the
 * half-open `[startAt, endAt)` convention the availability engine uses, so an
 * Airbnb block ending on the 7th frees the 7th — exactly as Airbnb means it.
 */

export type IcalEvent = {
  uid: string;
  startAt: Date;
  endAt: Date;
  summary: string | null;
  status: string | null;
  /** true when the source used `VALUE=DATE` (no clock time). */
  allDay: boolean;
};

export class IcalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcalParseError";
  }
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/** RFC 5545 §3.1: a line beginning with a space or tab continues the previous one. */
export function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((line) => line.trim() !== "");
}

type ContentLine = { name: string; params: Record<string, string>; value: string };

/** `DTSTART;VALUE=DATE:20260304` → name, params, value. */
export function parseContentLine(line: string): ContentLine | null {
  const colon = indexOfUnquoted(line, ":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = splitUnquoted(head, ";");
  const name = (parts.shift() ?? "").trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    params[part.slice(0, eq).trim().toUpperCase()] = stripQuotes(part.slice(eq + 1).trim());
  }
  return { name, params, value };
}

function indexOfUnquoted(input: string, needle: string): number {
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === needle) return i;
  }
  return -1;
}

function splitUnquoted(input: string, sep: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of input) {
    if (ch === '"') {
      quoted = !quoted;
      current += ch;
    } else if (!quoted && ch === sep) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function stripQuotes(value: string): string {
  return value.startsWith('"') && value.endsWith('"') && value.length >= 2
    ? value.slice(1, -1)
    : value;
}

/** RFC 5545 §3.3.11 escaping, applied in reverse. */
export function unescapeText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (ch !== "\\" || i === value.length - 1) {
      out += ch;
      continue;
    }
    const next = value[i + 1]!;
    i += 1;
    if (next === "n" || next === "N") out += "\n";
    else if (next === "," || next === ";" || next === "\\") out += next;
    else out += next;
  }
  return out;
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
const DATETIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

export type IcalDate = { date: Date; allDay: boolean };

/**
 * Parse a DATE or DATE-TIME value.
 *
 * A value with `Z` is UTC. A value without `Z` is floating or `TZID`-qualified
 * local time: we read it as the wall-clock time in `tzid` (default
 * `America/Asuncion`, UTC−3 year-round — Paraguay abolished DST in 2024) and
 * convert to UTC, so an imported block covers the hours its source meant.
 */
export function parseIcalDate(
  value: string,
  params: Record<string, string> = {},
  defaultTz = "America/Asuncion",
): IcalDate {
  const raw = value.trim();
  const dateMatch = DATE_RE.exec(raw);
  if (dateMatch || params.VALUE?.toUpperCase() === "DATE") {
    const m = dateMatch ?? DATE_RE.exec(raw.slice(0, 8));
    if (!m) throw new IcalParseError(`Fecha iCal inválida: ${value}`);
    return {
      date: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
      allDay: true,
    };
  }
  const dt = DATETIME_RE.exec(raw);
  if (!dt) throw new IcalParseError(`Fecha iCal inválida: ${value}`);
  const [, y, mo, d, h, mi, s, zulu] = dt;
  const asUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
  if (zulu) return { date: new Date(asUtc), allDay: false };
  const tz = params.TZID || defaultTz;
  return { date: new Date(asUtc - tzOffsetMs(tz, asUtc)), allDay: false };
}

/**
 * Offset of `tz` at the given instant, in milliseconds (east of UTC positive).
 * Uses the platform's IANA database via Intl; an unknown zone falls back to
 * UTC rather than throwing, because one malformed feed must not stop a sync.
 */
export function tzOffsetMs(tz: string, utcMs: number): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(utcMs));
  } catch {
    return 0;
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asIfUtc - utcMs;
}

/**
 * Parse a whole calendar into events. Malformed individual events are skipped
 * (a feed with one bad VEVENT still syncs the rest); a body with no VEVENT at
 * all throws, because that means we fetched an error page, not a calendar.
 */
export function parseIcal(text: string, defaultTz = "America/Asuncion"): IcalEvent[] {
  const lines = unfoldLines(text);
  if (!lines.some((line) => line.toUpperCase().startsWith("BEGIN:VCALENDAR"))) {
    throw new IcalParseError("La respuesta no es un calendario iCal");
  }
  const events: IcalEvent[] = [];
  let current: Partial<{
    uid: string;
    start: IcalDate;
    end: IcalDate;
    summary: string;
    status: string;
  }> | null = null;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) {
      current = {};
      continue;
    }
    if (upper.startsWith("END:VEVENT")) {
      if (current) {
        const event = finaliseEvent(current);
        if (event) events.push(event);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const parsed = parseContentLine(line);
    if (!parsed) continue;
    try {
      switch (parsed.name) {
        case "UID":
          current.uid = unescapeText(parsed.value).trim();
          break;
        case "DTSTART":
          current.start = parseIcalDate(parsed.value, parsed.params, defaultTz);
          break;
        case "DTEND":
          current.end = parseIcalDate(parsed.value, parsed.params, defaultTz);
          break;
        case "SUMMARY":
          current.summary = unescapeText(parsed.value).trim();
          break;
        case "STATUS":
          current.status = parsed.value.trim().toUpperCase();
          break;
        default:
          break;
      }
    } catch {
      // A single unreadable property drops the event, not the feed.
      current = null;
    }
  }
  return events;
}

function finaliseEvent(
  current: Partial<{ uid: string; start: IcalDate; end: IcalDate; summary: string; status: string }>,
): IcalEvent | null {
  if (!current.uid || !current.start) return null;
  const allDay = current.start.allDay;
  // A missing DTEND means one day (all-day) or a zero-length instant, which we
  // widen to a day so the block is never empty.
  const end =
    current.end?.date ??
    new Date(current.start.date.getTime() + 24 * 60 * 60 * 1000);
  if (end.getTime() <= current.start.date.getTime()) return null;
  return {
    uid: current.uid,
    startAt: current.start.date,
    endAt: end,
    summary: current.summary ?? null,
    status: current.status ?? null,
    allDay,
  };
}

/** Events that should block the calendar — `CANCELLED` never does. */
export function blockingEvents(events: IcalEvent[]): IcalEvent[] {
  return events.filter((event) => event.status !== "CANCELLED");
}

/* -------------------------------------------------------------------------- */
/* Generation (our export feed)                                                */
/* -------------------------------------------------------------------------- */

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function formatIcalDateTime(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

export function formatIcalDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/** RFC 5545 §3.1: fold at 75 octets. */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const chunks: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    // Never split a multi-byte character.
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    chunks.push(bytes.subarray(offset, end).toString("utf8"));
    offset = end;
    limit = 74;
  }
  return chunks.join("\r\n ");
}

export type IcalExportEvent = {
  uid: string;
  startAt: Date;
  endAt: Date;
  summary: string;
  allDay?: boolean;
};

export function buildIcs(input: {
  name: string;
  events: IcalExportEvent[];
  prodId?: string;
  now?: Date;
}): string {
  const stamp = formatIcalDateTime(input.now ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${input.prodId ?? "-//alquilar.com.py//Availability//ES"}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(input.name)}`,
  ];
  for (const event of input.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeText(event.uid)}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatIcalDate(event.startAt)}`);
      lines.push(`DTEND;VALUE=DATE:${formatIcalDate(event.endAt)}`);
    } else {
      lines.push(`DTSTART:${formatIcalDateTime(event.startAt)}`);
      lines.push(`DTEND:${formatIcalDateTime(event.endAt)}`);
    }
    lines.push(`SUMMARY:${escapeText(event.summary)}`);
    lines.push("TRANSP:OPAQUE");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
