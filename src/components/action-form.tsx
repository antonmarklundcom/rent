"use client";

import { useActionState } from "react";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

/**
 * The one form wrapper the O-3 screens use: it holds the `useActionState`
 * plumbing so every page can stay a server component that just describes its
 * fields. Ugly by design — Window 2 restyles this in one place (plan §6.S3).
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  className = "space-y-2 rounded border border-neutral-200 p-3",
  submitClassName = "rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-50",
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children?: React.ReactNode;
  submitLabel: string;
  className?: string;
  submitClassName?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className={className}>
      {children}
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-green-700">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className={submitClassName}>
        {pending ? "…" : submitLabel}
      </button>
    </form>
  );
}
