"use client";

import { useActionState, useState, useTransition } from "react";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

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

  if (listings.length === 0) {
    return <p className="text-sm text-neutral-600">Cargá una publicación primero.</p>;
  }

  return (
    <form action={formAction} className="space-y-2 border border-neutral-300 p-3 text-sm">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col">
          Publicación
          <select name="listingId" className="border p-1">
            {listings.map((listing) => (
              <option key={listing.id} value={listing.id}>
                {listing.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Desde
          <input type="date" name="startAt" required className="border p-1" />
        </label>
        <label className="flex flex-col">
          Hasta (excluido)
          <input type="date" name="endAt" required className="border p-1" />
        </label>
        <label className="flex flex-col">
          Motivo
          <select name="reason" className="border p-1">
            <option value="owner_use">Uso propio</option>
            <option value="maintenance">Mantenimiento</option>
          </select>
        </label>
        <label className="flex flex-col">
          Nota
          <input name="note" className="border p-1" />
        </label>
      </div>
      {state.error && (
        <p role="alert" className="text-red-600">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-green-700">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-50"
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
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
        onClick={() =>
          startTransition(async () => {
            const result = await action(blockId);
            setError(result.ok ? null : result.error);
          })
        }
      >
        {pending ? "…" : "Liberar"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </>
  );
}
