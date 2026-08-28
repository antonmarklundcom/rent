"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { draftReplyAction, logMessageAction } from "@/app/actions/comms";
import { useToast } from "@/components/toast";
import { WhatsAppCta } from "@/components/whatsapp-cta";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";
import { normalisePhone } from "@/lib/messaging";

/**
 * Log a message, with the AI-draft button inline (plan §5.O9, #20).
 *
 * The draft lands in the textarea and nowhere else. Only pressing "Registrar"
 * writes a `messages` row — with `aiDrafted` set, so the log distinguishes
 * "the model suggested this" from "we said this". Nothing is ever sent from
 * here: the wa.me link opens WhatsApp with the text, a human presses send.
 */
export function ThreadReply({
  bookingId,
  listingId,
  contactName,
  contactPhone,
  draftingEnabled,
}: {
  bookingId: number | null;
  listingId: number | null;
  contactName: string | null;
  contactPhone: string | null;
  draftingEnabled: boolean;
}) {
  const [body, setBody] = useState("");
  const [question, setQuestion] = useState("");
  const [aiDrafted, setAiDrafted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafting, startDrafting] = useTransition();

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      formData.set("aiDrafted", aiDrafted ? "1" : "0");
      const result = await logMessageAction(EMPTY_FORM_STATE, formData);
      if (result.ok) {
        setBody("");
        setAiDrafted(false);
      }
      return result;
    },
    EMPTY_FORM_STATE,
  );

  const toast = useToast();
  useEffect(() => {
    if (state.message) toast.push("ok", state.message);
    else if (state.error) toast.push("error", state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const digits = normalisePhone(contactPhone);
  const whatsappUrl =
    digits && body.trim()
      ? `https://wa.me/${digits}?text=${encodeURIComponent(body)}`
      : null;

  return (
    <div className="card--raised card--hair space-y-4 rounded-lg p-4 text-sm">
      {draftingEnabled && (
        <div className="space-y-2 border-b border-ink/10 pb-4">
          <label className="flex flex-col gap-1">
            <span className="text-ink/70">Consulta del huésped (para el borrador)</span>
            <textarea
              rows={2}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="w-full rounded-sm border border-ink/15 bg-surface px-3 py-2 focus:border-accent focus:outline-none"
              placeholder="¿Tiene cochera?"
            />
          </label>
          <button
            type="button"
            disabled={drafting || question.trim().length < 3}
            className="rounded-sm border border-accent/40 bg-accent/10 px-3 py-1.5 text-accent disabled:opacity-50"
            onClick={() =>
              startDrafting(async () => {
                setNotice(null);
                const result = await draftReplyAction({ bookingId, listingId, question });
                if (result.ok && result.draft) {
                  setBody(result.draft);
                  setAiDrafted(true);
                } else {
                  setNotice(result.notice ?? "No se pudo generar el borrador");
                }
              })
            }
          >
            {drafting ? "Redactando…" : "✨ Borrador con IA"}
          </button>
          {notice && <p className="text-amber-700">{notice}</p>}
          <p className="text-xs text-ink/50">
            El borrador sólo usa la base de información de la publicación. Revisalo antes de
            mandarlo.
          </p>
        </div>
      )}

      <form action={formAction} className="space-y-3">
        {bookingId && <input type="hidden" name="bookingId" value={bookingId} />}
        {listingId && <input type="hidden" name="listingId" value={listingId} />}
        <input type="hidden" name="contactName" value={contactName ?? ""} />
        <input type="hidden" name="contactPhone" value={contactPhone ?? ""} />
        <label className="flex flex-col gap-1">
          <span className="text-ink/70">Mensaje</span>
          <textarea
            name="body"
            rows={4}
            required
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setAiDrafted(false);
            }}
            className="w-full rounded-sm border border-ink/15 bg-surface px-3 py-2 focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-ink/70">Dirección</span>
          <select
            name="direction"
            defaultValue="outbound"
            className="rounded-sm border border-ink/15 bg-surface px-2 py-1.5"
          >
            <option value="outbound">Nosotros → huésped</option>
            <option value="inbound">Huésped → nosotros</option>
          </select>
        </label>
        {aiDrafted && (
          <p className="text-xs text-ink/50">Se registrará como borrador de IA aprobado por vos.</p>
        )}
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
        <div className="flex flex-wrap items-center gap-3">
          {whatsappUrl && (
            <WhatsAppCta href={whatsappUrl} label="Abrir en WhatsApp" evLoc="admin_inbox" className="min-h-10 px-4 text-sm" />
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-sm bg-ink px-4 py-2 text-base disabled:opacity-50"
          >
            {pending ? "…" : "Registrar en la conversación"}
          </button>
        </div>
      </form>
    </div>
  );
}
