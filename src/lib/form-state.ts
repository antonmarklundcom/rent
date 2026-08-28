/**
 * The shape every form-facing server action returns.
 *
 * `ActionForm` (a client component) renders it, so it lives in its own module
 * with no `"use server"` and no `server-only` — both sides import it.
 */
export type FormState = {
  ok?: boolean;
  /** Success text, already translated (es-PY). */
  message?: string;
  /** Failure text, already translated (es-PY). */
  error?: string;
};

export const EMPTY_FORM_STATE: FormState = {};
