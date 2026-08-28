/**
 * Date and range primitives for the availability engine.
 *
 * EVERY range in this codebase is half-open — `[startAt, endAt)`. That single
 * convention is what lets one overlap function serve both verticals (plan §9,
 * judgment call 1): a stay checking out on the 14th at 11:00 and another
 * checking in on the 14th at 14:00 do not collide, and neither do two car
 * rentals that hand over back-to-back.
 *
 * All datetimes are UTC. Stays carry the listing's check-in/check-out clock
 * time (`stay_details.check_in_time` / `check_out_time`), so a "date" range is
 * always materialised into a datetime range before it reaches the data layer.
 */
import { DomainError } from "@/lib/errors";

export type DateRange = { startAt: Date; endAt: Date };

export const MS_PER_DAY = 86_400_000;

/** `HH:MM` — the shape stored in `stay_details.check_in_time`. */
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseClock(clock: string | null | undefined, fallback: string): [number, number] {
  const match = CLOCK_RE.exec(clock ?? "") ?? CLOCK_RE.exec(fallback);
  if (!match) return [0, 0];
  return [Number(match[1]), Number(match[2])];
}

/** `2026-03-04` → `Date` at UTC midnight. Throws on anything else. */
export function parseYmd(value: string): Date {
  const match = YMD_RE.exec(value.trim());
  if (!match) {
    throw new DomainError(`Fecha inválida: ${value}`, "invalid_range", { value });
  }
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(m) - 1 ||
    date.getUTCDate() !== Number(d)
  ) {
    throw new DomainError(`Fecha inexistente: ${value}`, "invalid_range", { value });
  }
  return date;
}

export function formatYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `2026-03-04` + `14:00` → `2026-03-04T14:00:00Z`. */
export function atClock(date: Date, clock: string, fallback = "00:00"): Date {
  const [h, m] = parseClock(clock, fallback);
  const out = new Date(date);
  out.setUTCHours(h, m, 0, 0);
  return out;
}

export function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function startOfUtcDay(date: Date): Date {
  const out = new Date(date);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/**
 * THE overlap predicate. Half-open on both sides, so touching ranges are free.
 * Every conflict check — SQL or in-memory — expresses exactly this.
 */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startAt.getTime() < b.endAt.getTime() && b.startAt.getTime() < a.endAt.getTime();
}

/** Whole calendar days spanned, rounded up; always ≥ 1 for a valid range. */
export function nightsBetween(startAt: Date, endAt: Date): number {
  const days = (startOfUtcDay(endAt).getTime() - startOfUtcDay(startAt).getTime()) / MS_PER_DAY;
  return Math.max(1, Math.round(days));
}

/** 24h periods started, rounded up — a 25-hour car rental is 2 days. */
export function daysBetween(startAt: Date, endAt: Date): number {
  const ms = endAt.getTime() - startAt.getTime();
  return Math.max(1, Math.ceil(ms / MS_PER_DAY));
}

/** Whole months started between two dates — used by `per_month` listings. */
export function monthsBetween(startAt: Date, endAt: Date): number {
  const months =
    (endAt.getUTCFullYear() - startAt.getUTCFullYear()) * 12 +
    (endAt.getUTCMonth() - startAt.getUTCMonth());
  const partial = endAt.getUTCDate() > startAt.getUTCDate() ? 1 : 0;
  return Math.max(1, months + partial);
}

export function assertValidRange(startAt: Date, endAt: Date): DateRange {
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) {
    throw new DomainError("Fecha de inicio inválida", "invalid_range");
  }
  if (!(endAt instanceof Date) || Number.isNaN(endAt.getTime())) {
    throw new DomainError("Fecha de fin inválida", "invalid_range");
  }
  if (endAt.getTime() <= startAt.getTime()) {
    throw new DomainError(
      "La fecha de fin tiene que ser posterior a la de inicio",
      "invalid_range",
      { startAt, endAt },
    );
  }
  return { startAt, endAt };
}

/** First day of the `YYYY-MM` period, and the first day of the next one. */
export function periodRange(period: string): DateRange {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period.trim());
  if (!match) {
    throw new DomainError(`Período inválido: ${period} (se espera YYYY-MM)`, "invalid_range");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  return {
    startAt: new Date(Date.UTC(year, month - 1, 1)),
    endAt: new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1)),
  };
}

/** `YYYY-MM` a date falls in (UTC). */
export function periodOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}
