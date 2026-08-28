"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/lib/form-state";

/**
 * Run the "due" sweep by hand — the same call `npm run messages` makes on cron.
 * It exists because the cron may not be configured yet on a fresh deploy
 * (plan §6.S6 leaves that to S-3), and an operator should not have to wait for
 * it to see today's messages.
 */
export function ProcessDueButton({ action }: { action: () => Promise<FormState> }) {
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
        {pending ? "…" : "Actualizar pendientes"}
      </button>
      {state.message && <span className="text-sm text-green-700">{state.message}</span>}
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
    </span>
  );
}
