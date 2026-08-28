"use client";

import { useActionState, useEffect, useState } from "react";
import { draftReplyAction, logMessageAction, type DraftState } from "@/app/actions/messages";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

/**
 * Draft → review → log, in that order (#20 + AI drafts, plan §5.O9).
 *
 * Two sibling forms sharing one piece of state, because the whole point is
 * that the model's output lands in an editable box and a HUMAN decides what
 * gets sent. There is no path here that reaches a guest: "Registrar" writes to
 * the conversation log, and sending is the operator tapping the WhatsApp link.
 *
 * Ugly by design — Sonnet styles this in phase S-2 (plan §6.S3).
 */
export function AiDraftPanel({
  thread,
  listingId,
  bookingId,
  waHref,
  lastInbound,
}: {
  thread: string;
  listingId: number;
  bookingId: number | null;
  waHref: string | null;
  lastInbound: string | null;
}) {
  const [draftState, draftAction, draftPending] = useActionState<DraftState, FormData>(
    draftReplyAction,
    EMPTY_FORM_STATE,
  );
  const [logState, logAction, logPending] = useActionState<FormState, FormData>(
    logMessageAction,
    EMPTY_FORM_STATE,
  );

  const [question, setQuestion] = useState(lastInbound ?? "");
  const [reply, setReply] = useState("");
  const [usedDraft, setUsedDraft] = useState(false);

  // A fresh suggestion replaces whatever was in the box.
  useEffect(() => {
    if (draftState.draft) {
      setReply(draftState.draft);
      setUsedDraft(true);
    }
  }, [draftState.draft]);

  return (
    <section className="space-y-3 rounded border border-neutral-300 p-3">
      <h2 className="font-medium">Responder</h2>

      <form action={draftAction} className="space-y-2">
        <input type="hidden" name="listingId" value={listingId} />
        {bookingId && <input type="hidden" name="bookingId" value={bookingId} />}
        <label className="block space-y-1 text-sm">
          <span>Consulta del huésped</span>
          <textarea
            name="question"
            rows={3}
            required
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className="w-full rounded border border-neutral-300 px-2 py-1"
          />
        </label>
        {draftState.error && (
          <p role="alert" className="text-sm text-red-600">
            {draftState.error}
          </p>
        )}
        <button
          type="submit"
          disabled={draftPending}
          className="rounded border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50"
        >
          {draftPending ? "Redactando…" : "Sugerir respuesta con IA"}
        </button>
        <p className="text-xs text-neutral-500">
          El borrador se genera con la base de información de la publicación. Revisalo
          siempre: nada se envía solo.
        </p>
      </form>

      <form action={logAction} className="space-y-2">
        <input type="hidden" name="thread" value={thread} />
        <input type="hidden" name="direction" value="outbound" />
        {usedDraft && <input type="hidden" name="aiDrafted" value="on" />}
        <label className="block space-y-1 text-sm">
          <span>Respuesta a enviar</span>
          <textarea
            name="body"
            rows={5}
            required
            value={reply}
            onChange={(event) => {
              setReply(event.target.value);
              if (event.target.value !== draftState.draft) setUsedDraft(false);
            }}
            className="w-full rounded border border-neutral-300 px-2 py-1"
          />
        </label>
        {logState.error && (
          <p role="alert" className="text-sm text-red-600">
            {logState.error}
          </p>
        )}
        {logState.message && (
          <p role="status" className="text-sm text-green-700">
            {logState.message}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {waHref && reply.trim() && (
            <a
              href={`${waHref}${encodeURIComponent(reply)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-green-700 px-3 py-1 text-sm text-green-800"
            >
              Abrir en WhatsApp
            </a>
          )}
          <button
            type="submit"
            disabled={logPending}
            className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {logPending ? "…" : "Registrar respuesta"}
          </button>
        </div>
      </form>
    </section>
  );
}
