/**
 * Booking state machine (plan §5.O4).
 *
 * Pure — no database, no session. The data layer calls `assertTransition`
 * before writing, so every path into a booking's status (public request,
 * admin manual booking, cron, script) goes through the same validation.
 *
 *   inquiry ──▶ confirmed ──▶ active ──▶ completed
 *      │            │           │
 *      └────────────┴───────────┴──────▶ cancelled
 *
 * `completed` is terminal; `cancelled` is terminal. Re-confirming a cancelled
 * booking is deliberately impossible — create a new one, so the price snapshot
 * and the promo accounting are re-derived rather than silently reused.
 */
import { BOOKING_STATUSES, type BookingStatus } from "@/db/schema";
import { DomainError } from "@/lib/errors";

export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  inquiry: ["confirmed", "cancelled"],
  confirmed: ["active", "completed", "cancelled"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/**
 * Statuses that occupy the calendar.
 *
 * Plan §5.O4 says "confirmed/active bookings". `completed` is included as well
 * (plan §9, O-2 judgment call): a finished stay physically occupied the
 * listing, so letting a new booking overlap it would corrupt occupancy and
 * revenue analytics (§5.O10) and allow a back-dated double sale. Including it
 * only ever makes the engine stricter.
 */
export const OCCUPYING_STATUSES: readonly BookingStatus[] = ["confirmed", "active", "completed"];

/** Statuses that do NOT hold dates: an inquiry is a lead, a cancellation is gone. */
export const NON_OCCUPYING_STATUSES: readonly BookingStatus[] = BOOKING_STATUSES.filter(
  (status) => !OCCUPYING_STATUSES.includes(status),
);

export function occupiesCalendar(status: BookingStatus): boolean {
  return OCCUPYING_STATUSES.includes(status);
}

export function isTerminal(status: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[status].length === 0;
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (from === to) {
    throw new DomainError(`La reserva ya está en estado "${to}"`, "invalid_transition", {
      from,
      to,
    });
  }
  if (!canTransition(from, to)) {
    throw new DomainError(
      `Transición inválida: ${from} → ${to}`,
      "invalid_transition",
      { from, to, allowed: BOOKING_TRANSITIONS[from] },
    );
  }
}

/** True when the transition starts occupying dates that were previously free. */
export function transitionClaimsDates(from: BookingStatus, to: BookingStatus): boolean {
  return !occupiesCalendar(from) && occupiesCalendar(to);
}

/** True when the transition releases dates back to the calendar. */
export function transitionReleasesDates(from: BookingStatus, to: BookingStatus): boolean {
  return occupiesCalendar(from) && !occupiesCalendar(to);
}
