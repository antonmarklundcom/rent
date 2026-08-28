import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { cancelMessageAction, markMessageSentAction } from "@/app/actions/messages";
import { listInboxThreads, listOutbox } from "@/db/queries/messages";
import { formatLocalDateTime, waLink } from "@/lib/messaging";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Outbox + unified inbox (#4, #11, #20 — plan §5.O9).
 *
 * "Enviar" is a link to the operator's own WhatsApp with the body pre-filled,
 * and "marcar enviado" is the operator saying they did it. Nothing on this page
 * sends anything by itself (plan §1.5). Functional, not designed: Sonnet styles
 * it in phase S-2 (plan §6.S3).
 */
export default async function AdminMessagesPage() {
  await requireAdminPage();

  const [due, upcoming, threads] = await Promise.all([
    listOutbox({ statuses: ["due"] }),
    listOutbox({ statuses: ["scheduled"], limit: 30 }),
    listInboxThreads({ limit: 50 }),
  ]);

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">Mensajes</h1>
        <Link href="/admin/mensajes/plantillas" className="text-sm text-blue-700 underline">
          plantillas
        </Link>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">Para enviar ahora ({due.length})</h2>
        <p className="text-xs text-neutral-500">
          Nada se envía solo. Abrí WhatsApp, mandá el texto y marcá el mensaje como enviado.
        </p>
        {due.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No hay mensajes vencidos. Corré <code>npm run messages</code> para procesar la cola.
          </p>
        ) : (
          <ul className="space-y-3">
            {due.map((row) => {
              const href = waLink(row.guestPhone, row.renderedBody);
              return (
                <li key={row.id} className="space-y-2 rounded border border-neutral-300 p-3">
                  <div className="text-sm">
                    <strong>{row.guestName}</strong> · {row.reference} · {row.listingTitle}
                    <span className="block text-xs text-neutral-500">
                      {row.templateKey} · vencía {formatLocalDateTime(row.sendAfter)}
                      {row.guestPhone ? ` · ${row.guestPhone}` : " · sin teléfono"}
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap rounded bg-neutral-50 p-2 text-sm">
                    {row.renderedBody}
                  </pre>
                  <div className="flex flex-wrap items-start gap-2">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-green-700 px-3 py-1 text-sm text-green-800"
                      >
                        Abrir en WhatsApp
                      </a>
                    ) : (
                      <span className="text-xs text-red-700">
                        La reserva no tiene teléfono cargado.
                      </span>
                    )}
                    <ActionForm
                      action={markMessageSentAction}
                      submitLabel="Marcar enviado"
                      className="inline"
                      submitClassName="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50"
                    >
                      <input type="hidden" name="scheduledId" value={row.id} />
                    </ActionForm>
                    <ActionForm
                      action={cancelMessageAction}
                      submitLabel="Cancelar"
                      className="inline"
                      submitClassName="rounded border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50"
                    >
                      <input type="hidden" name="scheduledId" value={row.id} />
                    </ActionForm>
                    <Link
                      href={`/admin/mensajes/b${row.bookingId}`}
                      className="px-1 py-1 text-sm text-blue-700 underline"
                    >
                      ver conversación
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Programados ({upcoming.length})</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-neutral-500">La cola está vacía.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Cuándo</th>
                <th>Plantilla</th>
                <th>Reserva</th>
                <th>Huésped</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="py-1">{formatLocalDateTime(row.sendAfter)}</td>
                  <td>{row.templateKey}</td>
                  <td>{row.reference}</td>
                  <td>{row.guestName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Conversaciones ({threads.length}) — #20</h2>
        {threads.length === 0 ? (
          <p className="text-sm text-neutral-500">Todavía no hay mensajes registrados.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {threads.map((thread) => (
              <li key={thread.threadKey} className="border-b border-neutral-200 pb-2">
                <Link
                  href={`/admin/mensajes/${thread.threadKey}`}
                  className="text-blue-700 underline"
                >
                  {thread.contactName ?? "Sin nombre"} · {thread.listingTitle}
                </Link>
                <span className="block text-xs text-neutral-500">
                  {thread.reference ? `${thread.reference} · ` : ""}
                  {thread.messageCount} mensaje(s) · último{" "}
                  {thread.lastDirection === "inbound" ? "recibido" : "enviado"}{" "}
                  {formatLocalDateTime(thread.lastAt)}
                </span>
                <span className="block truncate text-neutral-700">{thread.lastBody}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
