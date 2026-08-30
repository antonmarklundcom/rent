"use client";

import { useTransition } from "react";
import type { FormState } from "@/lib/form-state";
import { useToast } from "@/components/toast";

/**
 * Run the "due" sweep by hand — the same call `npm run messages` makes on cron.
 * It exists because the cron may not be configured yet on a fresh deploy
 * (plan §6.S6 leaves that to S-3), and an operator should not have to wait for
 * it to see today's messages.
 */
export function ProcessDueButton({ action }: { action: () => Promise<FormState> }) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  return (
    <button
      type="button"
      disabled={pending}
      className="rounded-sm border border-ink/20 px-3 py-1.5 text-sm hover:border-ink/40 disabled:opacity-50"
      onClick={() =>
        startTransition(async () => {
          const state = await action();
          toast.push(state.error ? "error" : "ok", state.error ?? state.message ?? "Listo");
        })
      }
    >
      {pending ? "…" : "Actualizar pendientes"}
    </button>
  );
}
