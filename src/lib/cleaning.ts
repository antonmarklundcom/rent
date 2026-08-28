/**
 * Cleaning & turnover primitives (#1, plan §5.O6).
 *
 * Pure — no database, no session — so the checklist rules and the status
 * machine are provable in `scripts/verify-logic.ts` and are the same whether a
 * cleaner taps a magic-link button or an admin closes the task by hand.
 *
 *   needed ──▶ in_progress ──▶ ready
 *
 * No skipping and no going back. A flat found dirty after a task was marked
 * `ready` gets a NEW task, so the history stays honest: "who said this was
 * clean, and when" is exactly the question a guest complaint raises.
 */
import { type CleaningStatus, type Vertical } from "@/db/schema";
import { DomainError } from "@/lib/errors";

export type { CleaningStatus };

export type ChecklistItem = { key: string; label: string; done: boolean };

/** Statuses that still owe work — the ones that hold back guest-readiness. */
export const OPEN_CLEANING_STATUSES: readonly CleaningStatus[] = ["needed", "in_progress"];

export const CLEANING_TRANSITIONS: Record<CleaningStatus, readonly CleaningStatus[]> = {
  needed: ["in_progress"],
  in_progress: ["ready"],
  ready: [],
};

const STAY_CHECKLIST: readonly Omit<ChecklistItem, "done">[] = [
  { key: "sabanas", label: "Cambiar sábanas y toallas" },
  { key: "bano", label: "Limpiar baño" },
  { key: "cocina", label: "Limpiar cocina" },
  { key: "living", label: "Limpiar living y dormitorios" },
  { key: "basura", label: "Sacar la basura" },
  { key: "amenities", label: "Reponer amenities y papel higiénico" },
  { key: "fotos", label: "Sacar fotos del estado final" },
];

const CAR_CHECKLIST: readonly Omit<ChecklistItem, "done">[] = [
  { key: "interior", label: "Aspirar interior" },
  { key: "exterior", label: "Lavar exterior" },
  { key: "vidrios", label: "Limpiar vidrios y espejos" },
  { key: "basura", label: "Sacar la basura" },
  { key: "fotos", label: "Sacar fotos del estado final" },
];

/** The turnover checklist a fresh task starts from. */
export function defaultChecklist(vertical: Vertical): ChecklistItem[] {
  const source = vertical === "car" ? CAR_CHECKLIST : STAY_CHECKLIST;
  return source.map((item) => ({ ...item, done: false }));
}

export function checklistProgress(items: ChecklistItem[] | null | undefined): {
  done: number;
  total: number;
} {
  const list = items ?? [];
  return { done: list.filter((item) => item.done).length, total: list.length };
}

/** An empty checklist is complete — a task may legitimately carry none. */
export function checklistComplete(items: ChecklistItem[] | null | undefined): boolean {
  const { done, total } = checklistProgress(items);
  return done === total;
}

/**
 * Apply `{ key: done }` updates to a checklist, ignoring keys the task does not
 * have. The cleaner's phone posts whatever it rendered; unknown keys are a
 * stale page, not a reason to fail the whole submission.
 */
export function applyChecklistUpdate(
  items: ChecklistItem[] | null | undefined,
  updates: Record<string, boolean>,
): ChecklistItem[] {
  return (items ?? []).map((item) =>
    Object.prototype.hasOwnProperty.call(updates, item.key)
      ? { ...item, done: Boolean(updates[item.key]) }
      : item,
  );
}

export function canAdvanceCleaning(from: CleaningStatus, to: CleaningStatus): boolean {
  return CLEANING_TRANSITIONS[from].includes(to);
}

/** The next status in the flow, or null when the task is finished. */
export function nextCleaningStatus(from: CleaningStatus): CleaningStatus | null {
  return CLEANING_TRANSITIONS[from][0] ?? null;
}

/**
 * Guard for every status change. Marking a task `ready` requires every
 * checklist item ticked — "lista" is a claim the operator later stands behind.
 */
export function assertCleaningTransition(
  from: CleaningStatus,
  to: CleaningStatus,
  checklist?: ChecklistItem[] | null,
): void {
  if (from === to) {
    throw new DomainError(`La tarea ya está en estado "${to}"`, "invalid_transition", { from, to });
  }
  if (!canAdvanceCleaning(from, to)) {
    throw new DomainError(`Transición inválida: ${from} → ${to}`, "invalid_transition", {
      from,
      to,
      allowed: CLEANING_TRANSITIONS[from],
    });
  }
  if (to === "ready" && !checklistComplete(checklist)) {
    const { done, total } = checklistProgress(checklist);
    throw new DomainError(
      `Faltan ${total - done} ítems del checklist para marcar la tarea como lista`,
      "checklist_incomplete",
      { done, total },
    );
  }
}
