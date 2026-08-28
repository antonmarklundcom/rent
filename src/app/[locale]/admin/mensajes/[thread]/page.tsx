import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { logMessageAction } from "@/app/actions/messages";
import {
  getThreadContext,
  listScheduledForBooking,
  listThreadMessages,
  parseThreadKey,
} from "@/db/queries/messages";
import { listInfoItems } from "@/db/queries/info";
import { hasAnthropicKey } from "@/lib/ai-drafts";
import { formatLocalDateTime, normalisePhone } from "@/lib/messaging";
import { requireAdminPage } from "@/lib/page-guards";

/** One conversation (#20) with the AI-draft box inline (plan §5.O9). */
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ thread: string }>;
}) {
  await requireAdminPage();
  const { thread: threadParam } = await params;
  const thread = parseThreadKey(threadParam);
  if (!thread) notFound();

  const context = await getThreadContext(thread);
  if (!context) notFound();

  const [items, info, scheduled] = await Promise.all([
    listThreadMessages(thread),
    listInfoItems(context.listingId),
    context.bookingId ? listScheduledForBooking(context.bookingId) : Promise.resolve([]),
  ]);

  const lastInbound = [...items].reverse().find((m) => m.direction === "inbound") ?? null;
  const phone = normalisePhone(context.guestPhone ?? items.find((m) => m.contactPhone)?.contactPhone);
  // The panel appends the encoded body, so this half of the link stops at `text=`.
  const waHref = phone ? `https://wa.me/${phone}?text=` : null;

  return (
    <section className="space-y-6">
      <div>
        <Link href="/admin/mensajes" className="text-sm text-blue-700 underline">
          ← Mensajes
        </Link>
        <h1 className="text-2xl font-semibold">{context.guestName ?? context.listingTitle}</h1>
        <p className="text-sm text-neutral-600">
          {context.listingTitle}
          {context.reference ? ` · ${context.reference}` : ""}
          {context.status ? ` · ${context.status}` : ""}
          {context.startAt && context.endAt
            ? ` · ${formatLocalDateTime(context.startAt)} → ${formatLocalDateTime(context.endAt)}`
            : ""}
        </p>
        {context.guestPhone && (
          <p className="text-xs text-neutral-500">{context.guestPhone}</p>
        )}
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">Conversación ({items.length})</h2>
        {items.length === 0 ? (
          <p className="text-sm text-neutral-500">Todavía no hay mensajes en este hilo.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {items.map((message) => (
              <li
                key={message.id}
                className={
                  message.direction === "inbound"
                    ? "rounded border border-neutral-300 p-2"
                    : "rounded border border-neutral-300 bg-neutral-50 p-2"
                }
              >
                <span className="block text-xs text-neutral-500">
                  {message.direction === "inbound" ? "Huésped" : "Nosotros"} ·{" "}
                  {message.channel} · {formatLocalDateTime(message.createdAt)}
                  {message.aiDrafted ? " · borrador IA aprobado" : ""}
                </span>
                <pre className="whitespace-pre-wrap font-sans">{message.body}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ActionForm action={logMessageAction} submitLabel="Registrar consulta recibida">
        <input type="hidden" name="thread" value={threadParam} />
        <input type="hidden" name="direction" value="inbound" />
        <label className="block space-y-1 text-sm">
          <span>Lo que escribió el huésped</span>
          <textarea
            name="body"
            rows={3}
            required
            className="w-full rounded border border-neutral-300 px-2 py-1"
          />
        </label>
        {!context.bookingId && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span>Nombre</span>
              <input
                name="contactName"
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="space-y-1">
              <span>Teléfono</span>
              <input
                name="contactPhone"
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
          </div>
        )}
      </ActionForm>

      {!hasAnthropicKey() && (
        <p className="rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
          Los borradores con IA están apagados: falta <code>ANTHROPIC_API_KEY</code>. Todo lo
          demás en esta pantalla funciona igual.
        </p>
      )}

      <AiDraftPanel
        thread={threadParam}
        listingId={context.listingId}
        bookingId={context.bookingId}
        waHref={waHref}
        lastInbound={lastInbound?.body ?? null}
      />

      <section className="space-y-1 text-sm">
        <h2 className="font-medium">Base de información ({info.length})</h2>
        {info.length === 0 ? (
          <p className="text-neutral-500">
            Sin datos cargados — el borrador con IA necesita al menos una respuesta acá.
          </p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-neutral-700">
            {info.map((item) => (
              <li key={item.id}>
                <strong>{item.question}</strong> — {item.answer}
              </li>
            ))}
          </ul>
        )}
      </section>

      {scheduled.length > 0 && (
        <section className="space-y-1 text-sm">
          <h2 className="font-medium">Secuencia de esta reserva ({scheduled.length})</h2>
          <ul className="space-y-0.5 text-neutral-700">
            {scheduled.map((row) => (
              <li key={row.id}>
                {row.templateKey} · {row.status} · {formatLocalDateTime(row.sendAfter)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
