/**
 * Fleet care & document expiry (#14, plan §5.O8).
 *
 * Pure — no database. A reminder's stored status is a cache of what these
 * rules say about it today; `refreshVehicleReminders` in the query layer walks
 * the rows through this function rather than re-deriving the thresholds.
 */
import type { ReminderStatus } from "@/db/schema";

/** A reminder falls "due" this many days before its date… */
export const DUE_HORIZON_DAYS = 30;
/** …or this many kilometres before its odometer target. */
export const DUE_HORIZON_KM = 500;

export type ReminderInput = {
  status: ReminderStatus;
  dueDate: string | null;
  dueKm: number | null;
};

export type ReminderContext = {
  today: Date;
  /** Latest odometer reading for the vehicle, from its most recent inspection. */
  odometer?: number | null;
  horizonDays?: number;
  horizonKm?: number;
};

function daysUntil(dueDate: string, today: Date): number {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(due)) return Number.POSITIVE_INFINITY;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((due - start) / 86_400_000);
}

/**
 * What a reminder's status should be right now. `done` is terminal — a
 * completed service does not un-complete itself when the date rolls past.
 */
export function deriveReminderStatus(
  reminder: ReminderInput,
  context: ReminderContext,
): ReminderStatus {
  if (reminder.status === "done") return "done";
  const horizonDays = context.horizonDays ?? DUE_HORIZON_DAYS;
  const horizonKm = context.horizonKm ?? DUE_HORIZON_KM;

  if (reminder.dueDate !== null && daysUntil(reminder.dueDate, context.today) <= horizonDays) {
    return "due";
  }
  if (
    reminder.dueKm !== null &&
    context.odometer !== null &&
    context.odometer !== undefined &&
    context.odometer >= reminder.dueKm - horizonKm
  ) {
    return "due";
  }
  return "upcoming";
}

/** Days left until the date target; null when the reminder has no date. */
export function daysRemaining(
  reminder: Pick<ReminderInput, "dueDate">,
  today: Date,
): number | null {
  return reminder.dueDate === null ? null : daysUntil(reminder.dueDate, today);
}

/** True once the date target has passed — rendered differently from "due soon". */
export function isOverdue(reminder: ReminderInput, today: Date): boolean {
  if (reminder.status === "done" || reminder.dueDate === null) return false;
  return daysUntil(reminder.dueDate, today) < 0;
}
