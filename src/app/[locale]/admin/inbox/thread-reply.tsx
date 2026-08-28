"use client";

import { useActionState, useState, useTransition } from "react";
import { draftReplyAction, logMessageAction } from "@/app/actions/comms";
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

  const digits = normalisePhone(contactPhone);
  const whatsappUrl =
    digits && body.trim()
      ? `https://wa.me/${digits}?text=${encodeURIComponent(body)}`
      : null;

  return (
    <div className="space-y-3 border border-neutral-300 p-3 text-sm">
      {draftingEnabled && (
        <div className="space-y-2 border-b pb-3">
          <label className="flex flex-col">
            Consulta del huésped (para el borrador)
            <textarea
              rows={2}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="border p-1"
              placeholder="¿Tiene cochera?"
            />
          </label>
          <button
            type="button"
            disabled={drafting || question.trim().length < 3}
            className="rounded border px-3 py-1 disabled:opacity-50"
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
            {drafting ? "Redactando…" : "Borrador con IA"}
          </button>
          {notice && <p className="text-amber-700">{notice}</p>}
          <p className="text-xs text-neutral-500">
            El borrador sólo usa la base de información de la publicación. Revisalo antes de
            mandarlo.
          </p>
        </div>
      )}

      <form action={formAction} className="space-y-2">
        {bookingId && <input type="hidden" name="bookingId" value={bookingId} />}
        {listingId && <input type="hidden" name="listingId" value={listingId} />}
        <input type="hidden" name="contactName" value={contactName ?? ""} />
        <input type="hidden" name="contactPhone" value={contactPhone ?? ""} />
        <label className="flex flex-col">
          Mensaje
          <textarea
            name="body"
            rows={4}
            required
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setAiDrafted(false);
            }}
            className="border p-1"
          />
        </label>
        <label className="flex items-center gap-2">
          Dirección
          <select name="direction" defaultValue="outbound" className="border p-1">
            <option value="outbound">Nosotros → huésped</option>
            <option value="inbound">Huésped → nosotros</option>
          </select>
        </label>
        {aiDrafted && (
          <p className="text-xs text-neutral-500">
            Se registrará como borrador de IA aprobado por vos.
          </p>
        )}
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
        <div className="flex flex-wrap items-center gap-3">
          {whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener"
              className="rounded bg-green-700 px-3 py-1 text-white"
            >
              Abrir en WhatsApp
            </a>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-50"
          >
            {pending ? "…" : "Registrar en la conversación"}
          </button>
        </div>
      </form>
    </div>
  );
}
