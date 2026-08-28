"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * General enquiry form → `POST /api/leads` (plan §5.O10). No listing attached;
 * `vertical` lets the admin leads list filter it. Store-first, CRM-second is
 * handled entirely by the route — this component only submits and shows the
 * result.
 */
export function ContactForm() {
  const t = useTranslations("contact");
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");

  const inputClass =
    "rounded-sm border border-ink/15 bg-surface px-3 py-2.5 text-sm focus:border-accent focus:outline-none";
  const labelClass = "flex flex-col gap-1 text-xs font-medium text-ink/60";

  return (
    <form
      className="card--raised card--hair space-y-4 rounded-lg p-5 sm:p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setStatus("sending");
        const form = new FormData(event.currentTarget);
        try {
          const res = await fetch("/api/leads", { method: "POST", body: form });
          const data = (await res.json()) as { ok: boolean };
          setStatus(data.ok ? "ok" : "error");
          if (data.ok) event.currentTarget.reset();
        } catch {
          setStatus("error");
        }
      }}
    >
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <label className={labelClass}>
        {t("name")}
        <input name="name" required minLength={2} className={inputClass} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          WhatsApp
          <input name="phone" type="tel" placeholder="0981 123 456" className={inputClass} />
        </label>
        <label className={labelClass}>
          {t("email")}
          <input name="email" type="email" className={inputClass} />
        </label>
      </div>
      <label className={labelClass}>
        {t("message")}
        <textarea name="message" required minLength={5} rows={4} className={inputClass} />
      </label>

      {status === "ok" && <p className="text-sm text-green-700">{t("success")}</p>}
      {status === "error" && <p className="text-sm text-red-600">{t("error")}</p>}

      <button
        type="submit"
        disabled={status === "sending"}
        data-ev="form_submit"
        data-ev-loc="contacto"
        className="min-h-12 w-full rounded-sm bg-accent px-6 font-medium text-accent-ink transition-transform hover:-translate-y-0.5 disabled:opacity-50 sm:w-auto"
      >
        {status === "sending" ? t("sending") : t("submit")}
      </button>
    </form>
  );
}
