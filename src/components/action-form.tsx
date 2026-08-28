"use client";

import { useActionState } from "react";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";
import { useToast } from "@/components/toast";

/**
 * The one form wrapper the admin/panel/cleaner screens use: it holds the
 * `useActionState` plumbing so every page can stay a server component that
 * just describes its fields.
 *
 * Feedback is hoisted into `useToast()` (plan §6.S3 fix #5) — the row this
 * form lives in can unmount the instant the action succeeds (a verified
 * document, a deleted block, a completed task). The obvious fix — a
 * `useEffect` watching the returned `state` — does NOT work here: a server
 * action submitted from a form is handled in one combined transition that
 * both (a) updates this component's local `state` and (b) refreshes the
 * page's server data, and when (b) causes an ancestor to stop rendering this
 * subtree (the `document.status === "pending"` ternary flips), React never
 * commits this component with its post-submit `state` at all — it goes
 * straight from "pending" to "gone", so an effect keyed on `state` never
 * fires. Pushing the toast from INSIDE the action wrapper — before
 * `useActionState` ever sees the result — sidesteps that: it is a state
 * update on `ToastProvider`, a component this row's disappearance never
 * touches, so it always lands in the same commit. The inline
 * `role="alert"/"status"` text below still renders too, for the common case
 * where the form stays mounted.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  className = "space-y-3",
  submitClassName =
    "inline-flex min-h-10 items-center justify-center rounded-sm bg-ink px-4 text-sm font-medium text-base transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0",
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children?: React.ReactNode;
  submitLabel: string;
  className?: string;
  submitClassName?: string;
}) {
  const toast = useToast();

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData);
      if (result.message) toast.push("ok", result.message);
      else if (result.error) toast.push("error", result.error);
      return result;
    },
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className={className}>
      {children}
      {state.error && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className={submitClassName}>
        {pending ? "…" : submitLabel}
      </button>
    </form>
  );
}
