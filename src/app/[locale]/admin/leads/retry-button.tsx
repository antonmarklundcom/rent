"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/lib/form-state";

/** Re-attempt the CRM forward for every lead that has not landed yet. */
export function RetryLeadsButton({ action }: { action: () => Promise<FormState> }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<FormState>({});

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        onClick={() => startTransition(async () => setState(await action()))}
      >
        {pending ? "…" : "Reintentar envío al CRM"}
      </button>
      {state.message && <span className="text-sm text-green-700">{state.message}</span>}
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
    </span>
  );
}
