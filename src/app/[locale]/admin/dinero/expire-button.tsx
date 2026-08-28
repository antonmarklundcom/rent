"use client";

import { useTransition } from "react";
import type { FormState } from "@/lib/form-state";
import { useToast } from "@/components/toast";

/** Sweep payment links past their expiry (#8). Not on a cron yet — see KNOWN-ISSUES. */
export function ExpireLinksButton({ action }: { action: () => Promise<FormState> }) {
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
      {pending ? "…" : "Vencer links pasados de fecha"}
    </button>
  );
}
