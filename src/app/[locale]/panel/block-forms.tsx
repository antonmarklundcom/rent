"use client";

import { useActionState, useEffect, useTransition } from "react";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";
import { useToast } from "@/components/toast";
import { fieldClass, labelClass } from "@/components/ui/field";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/**
 * Owner blocked dates (#15).
 *
 * The engine actions (`createBlockAction` / `deleteBlockAction`) return
 * `ActionResult`, not `FormState`, because they predate the form wrapper — so
 * this component adapts rather than changing an O-2 signature Sonnet also has
 * to leave alone (plan §4.7).
 *
 * `datetime-local` is read as UTC (the same fix O-3 applied on the admin
 * screens): a block the owner sets for the 3rd must not become the 2nd because
 * the server sits in another timezone.
 */
export function BlockDatesForm({
  listings,
  action,
}: {
  listings: { id: number; title: string }[];
  action: (input: {
    listingId: number;
    startAt: Date;
    endAt: Date;
    reason: "owner_use" | "maintenance";
    note?: string | null;
  }) => Promise<ActionResult<{ id: number }>>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const start = String(formData.get("startAt") ?? "");
      const end = String(formData.get("endAt") ?? "");
      if (!start || !end) return { ok: false, error: "Elegí las dos fechas" };
      const result = await action({
        listingId: Number(formData.get("listingId")),
        startAt: new Date(`${start}T00:00:00Z`),
        endAt: new Date(`${end}T00:00:00Z`),
        reason: (formData.get("reason") as "owner_use" | "maintenance") ?? "owner_use",
        note: String(formData.get("note") ?? "") || null,
      });
      return result.ok
        ? { ok: true, message: "Fechas bloqueadas" }
        : { ok: false, error: result.error };
    },
    EMPTY_FORM_STATE,
  );

  const toast = useToast();
  useEffect(() => {
    if (state.message) toast.push("ok", state.message);
    else if (state.error) toast.push("error", state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (listings.length === 0) {
    return <p className="text-sm text-ink/55">Cargá una publicación primero.</p>;
  }

  return (
    <form action={formAction} className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className={labelClass}>
          <span className="text-ink/70">Publicación</span>
          <select name="listingId" className={fieldClass}>
            {listings.map((listing) => (
              <option key={listing.id} value={listing.id}>
                {listing.title}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span className="text-ink/70">Desde</span>
          <input type="date" name="startAt" required className={fieldClass} />
        </label>
        <label className={labelClass}>
          <span className="text-ink/70">Hasta (excluido)</span>
          <input type="date" name="endAt" required className={fieldClass} />
        </label>
        <label className={labelClass}>
          <span className="text-ink/70">Motivo</span>
          <select name="reason" className={fieldClass}>
            <option value="owner_use">Uso propio</option>
            <option value="maintenance">Mantenimiento</option>
          </select>
        </label>
        <label className={labelClass}>
          <span className="text-ink/70">Nota</span>
          <input name="note" className={fieldClass} />
        </label>
      </div>
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-emerald-700">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-10 items-center justify-center rounded-sm bg-ink px-4 text-sm font-medium text-base transition-transform hover:-translate-y-0.5 disabled:opacity-50"
      >
        {pending ? "…" : "Bloquear"}
      </button>
    </form>
  );
}

export function DeleteBlockButton({
  blockId,
  action,
}: {
  blockId: number;
  action: (blockId: number) => Promise<ActionResult<{ id: number }>>;
}) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  return (
    <button
      type="button"
      disabled={pending}
      className="shrink-0 rounded-sm border border-ink/20 px-3 py-1 text-xs hover:border-ink/40 disabled:opacity-50"
      onClick={() =>
        startTransition(async () => {
          const result = await action(blockId);
          // This row disappears from the list the instant this succeeds —
          // the toast (hoisted above the list) is what actually gets seen.
          toast.push(result.ok ? "ok" : "error", result.ok ? "Bloqueo liberado" : result.error);
        })
      }
    >
      {pending ? "…" : "Liberar"}
    </button>
  );
}
