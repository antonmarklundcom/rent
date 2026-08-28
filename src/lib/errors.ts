/**
 * Domain errors shared by the booking, availability and money engines.
 *
 * These are thrown by the data layer (`src/db/queries/`) and by the pure
 * calculators in `src/lib/`. Server actions translate the `code` into a
 * user-facing message; the message here is already es-PY (voseo) so an
 * un-translated path still reads correctly.
 */
export type DomainErrorCode =
  /* availability */
  | "unavailable"
  | "invalid_range"
  /* booking state machine */
  | "invalid_transition"
  | "not_found"
  /* pricing */
  | "promo_invalid"
  | "promo_expired"
  | "promo_exhausted"
  | "promo_wrong_vertical"
  | "extra_invalid"
  /* money */
  | "invalid_amount"
  | "already_settled"
  | "deduction_too_large"
  | "listing_unbookable";

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: DomainErrorCode,
    readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
