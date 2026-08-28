"use client";

import { useActionState, useState } from "react";
import { requestBookingAction } from "@/app/actions/bookings";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

type Extra = { id: number; name: string; price: string; description: string | null };

/**
 * The public booking-request form (plan §5.O11).
 *
 * It produces an `inquiry` — which never holds dates (plan §9, O-2 decision 5).
 * The engine is what enforces availability, at confirmation; this form only
 * collects. `requestBookingAction` also stores the enquiry as a lead and offers
 * it to VenderCRM, so a failed CRM never costs the request.
 *
 * Ugly on purpose. Window 2 designs it (plan §6.S2).
 */
export function BookingRequestForm({
  listingId,
  extras,
  vertical,
}: {
  listingId: number;
  extras: Extra[];
  vertical: "stay" | "car";
}) {
  const [selected, setSelected] = useState<Record<number, number>>({});

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const result = await requestBookingAction({
        listingId,
        startAt: String(formData.get("startAt") ?? ""),
        endAt: String(formData.get("endAt") ?? ""),
        guestName: String(formData.get("guestName") ?? ""),
        guestPhone: String(formData.get("guestPhone") ?? "") || null,
        guestEmail: String(formData.get("guestEmail") ?? "") || null,
        guestCount: Number(formData.get("guestCount")) || null,
        notes: String(formData.get("notes") ?? "") || null,
        promoCode: String(formData.get("promoCode") ?? "") || null,
        extras: Object.entries(selected)
          .filter(([, qty]) => qty > 0)
          .map(([extraId, qty]) => ({ extraId: Number(extraId), qty })),
      });
      return result.ok
        ? {
            ok: true,
            message: `¡Listo! Tu solicitud quedó registrada con el código ${result.data.reference}. Te escribimos para confirmar.`,
          }
        : { ok: false, error: result.error };
    },
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-2 border border-neutral-300 p-3 text-sm">
      <h3 className="font-medium">Pedí tu reserva</h3>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col">
          {vertical === "stay" ? "Check-in" : "Retiro"}
          <input type="date" name="startAt" required className="border p-1" />
        </label>
        <label className="flex flex-col">
          {vertical === "stay" ? "Check-out" : "Devolución"}
          <input type="date" name="endAt" required className="border p-1" />
        </label>
        {vertical === "stay" && (
          <label className="flex flex-col">
            Huéspedes
            <input type="number" name="guestCount" min={1} max={30} className="w-24 border p-1" />
          </label>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col">
          Tu nombre
          <input name="guestName" required minLength={2} className="border p-1" />
        </label>
        <label className="flex flex-col">
          WhatsApp
          <input name="guestPhone" type="tel" placeholder="0981 123 456" className="border p-1" />
        </label>
        <label className="flex flex-col">
          Correo (opcional)
          <input name="guestEmail" type="email" className="border p-1" />
        </label>
      </div>

      {extras.length > 0 && (
        <fieldset className="space-y-1">
          <legend>Extras</legend>
          {extras.map((extra) => (
            <label key={extra.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={(selected[extra.id] ?? 0) > 0}
                onChange={(event) =>
                  setSelected((current) => ({
                    ...current,
                    [extra.id]: event.target.checked ? 1 : 0,
                  }))
                }
              />
              {extra.name} — {extra.price}
              {extra.description ? ` (${extra.description})` : ""}
            </label>
          ))}
        </fieldset>
      )}

      <label className="flex flex-col">
        Código promocional (opcional)
        <input name="promoCode" className="border p-1" />
      </label>
      <label className="flex flex-col">
        Consulta o comentario
        <textarea name="notes" rows={3} className="border p-1" />
      </label>

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
        className="rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-50"
      >
        {pending ? "Enviando…" : "Enviar solicitud"}
      </button>
      <p className="text-xs text-neutral-500">
        No es una reserva confirmada: te escribimos por WhatsApp para cerrarla.
      </p>
    </form>
  );
}
