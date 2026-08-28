"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { requestBookingAction } from "@/app/actions/bookings";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

type Extra = { id: number; name: string; price: string; description: string | null };

/**
 * The public booking-request form (plan §5.O11, restyled §6.S2).
 *
 * It produces an `inquiry` — which never holds dates (plan §9, O-2 decision 5).
 * The engine is what enforces availability, at confirmation; this form only
 * collects. `requestBookingAction` also stores the enquiry as a lead and offers
 * it to VenderCRM, so a failed CRM never costs the request.
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
  const t = useTranslations("booking");
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
        ? { ok: true, message: t("success", { reference: result.data.reference }) }
        : { ok: false, error: result.error };
    },
    EMPTY_FORM_STATE,
  );

  const inputClass =
    "rounded-sm border border-ink/15 bg-surface px-3 py-2.5 text-sm focus:border-accent focus:outline-none";
  const labelClass = "flex flex-col gap-1 text-xs font-medium text-ink/60";

  return (
    <form
      action={formAction}
      data-ev-loc="booking-form"
      className="card--raised card--hair space-y-4 rounded-lg p-5 sm:p-6"
    >
      <h3 className="font-display text-xl">{t("title")}</h3>
      <div className="flex flex-wrap gap-3">
        <label className={labelClass}>
          {vertical === "stay" ? t("checkIn") : t("pickup")}
          <input type="date" name="startAt" required className={inputClass} />
        </label>
        <label className={labelClass}>
          {vertical === "stay" ? t("checkOut") : t("dropoff")}
          <input type="date" name="endAt" required className={inputClass} />
        </label>
        {vertical === "stay" && (
          <label className={labelClass}>
            {t("guests")}
            <input type="number" name="guestCount" min={1} max={30} className={`w-24 ${inputClass}`} />
          </label>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <label className={labelClass}>
          {t("yourName")}
          <input name="guestName" required minLength={2} className={inputClass} />
        </label>
        <label className={labelClass}>
          WhatsApp
          <input name="guestPhone" type="tel" placeholder="0981 123 456" className={inputClass} />
        </label>
        <label className={labelClass}>
          {t("emailOptional")}
          <input name="guestEmail" type="email" className={inputClass} />
        </label>
      </div>

      {extras.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-ink/60">{t("extras")}</legend>
          <div className="flex flex-wrap gap-2">
            {extras.map((extra) => {
              const checked = (selected[extra.id] ?? 0) > 0;
              return (
                <label
                  key={extra.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-2 text-sm ${
                    checked ? "border-accent bg-accent/10" : "border-ink/15"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={checked}
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
              );
            })}
          </div>
        </fieldset>
      )}

      <label className={labelClass}>
        {t("promoCode")}
        <input name="promoCode" className={inputClass} />
      </label>
      <label className={labelClass}>
        {t("notes")}
        <textarea name="notes" rows={3} className={inputClass} />
      </label>

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
      <button
        type="submit"
        disabled={pending}
        data-ev="form_submit"
        data-ev-loc="booking-form"
        className="min-h-12 w-full rounded-sm bg-accent px-6 font-medium text-accent-ink transition-transform hover:-translate-y-0.5 disabled:opacity-50 sm:w-auto"
      >
        {pending ? t("sending") : t("submit")}
      </button>
      <p className="text-xs text-ink/50">{t("disclaimer")}</p>
    </form>
  );
}
