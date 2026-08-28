/**
 * Renter ID verification gate (#16, plan §5.O8).
 *
 * Pure — no database — so the rule is pinned in `scripts/verify-logic.ts` and
 * is identical wherever it is asked: a CAR booking cannot be confirmed while
 * its documents are unverified. Handing a vehicle to someone whose cédula
 * nobody looked at is the liability this whole vertical is built to avoid.
 *
 * Stays are NOT gated: a house key is not a car, and plan §1.2 keeps the stay
 * funnel frictionless.
 *
 * An admin may override the gate; the override is recorded in `activity_log`
 * by the booking engine, never silently swallowed.
 */
import type { DocumentStatus, Vertical } from "@/db/schema";

export type DocumentGateReason = "no_documents" | "pending" | "not_verified";

export type DocumentGateResult = {
  /** True when the booking may be confirmed on document grounds. */
  ok: boolean;
  /** Why not, when `ok` is false. */
  reason?: DocumentGateReason;
  /** False for verticals the gate does not apply to (stays). */
  applies: boolean;
  counts: { pending: number; verified: number; rejected: number };
  message?: string;
};

const MESSAGES: Record<DocumentGateReason, string> = {
  no_documents: "Falta cargar el documento del conductor (cédula, pasaporte o licencia)",
  pending: "Hay documentos sin verificar: revisalos antes de confirmar la reserva",
  not_verified: "Ningún documento del conductor está verificado",
};

/** Verticals whose bookings the gate applies to. */
export function documentGateApplies(vertical: Vertical): boolean {
  return vertical === "car";
}

export function evaluateDocumentGate(
  vertical: Vertical,
  documents: readonly { status: DocumentStatus }[],
): DocumentGateResult {
  const counts = {
    pending: documents.filter((d) => d.status === "pending").length,
    verified: documents.filter((d) => d.status === "verified").length,
    rejected: documents.filter((d) => d.status === "rejected").length,
  };
  if (!documentGateApplies(vertical)) {
    return { ok: true, applies: false, counts };
  }
  // Order matters: "nothing uploaded" and "uploaded but unreviewed" are
  // different operator instructions, so they are different reasons.
  let reason: DocumentGateReason | undefined;
  if (documents.length === 0) reason = "no_documents";
  else if (counts.pending > 0) reason = "pending";
  else if (counts.verified === 0) reason = "not_verified";

  return reason
    ? { ok: false, reason, applies: true, counts, message: MESSAGES[reason] }
    : { ok: true, applies: true, counts };
}
