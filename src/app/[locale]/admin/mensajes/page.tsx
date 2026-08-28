import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import {
  cancelMessageAction,
  markSentAction,
  processDueAction,
} from "@/app/actions/comms";
import { ProcessDueButton } from "./process-button";
import { listOutbox } from "@/db/queries/messages";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * The outbox (plan §5.O9, feature #4/#11).
 *
 * Nothing here sends. Each due message shows its rendered body, a wa.me link
 * that opens WhatsApp with that body already typed, and a "marcar enviado"
 * button that both closes the queue row and writes the conversation log.
 * That is v1's delivery model (plan §1.5) and it is deliberate: no message
 * reaches a guest without a person having read it.
 */
function when(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export default async function AdminOutboxPage() {
  await requireAdminPage();
  const [due, scheduled, sent] = await Promise.all([
    listOutbox({ statuses: ["due"] }),
    listOutbox({ statuses: ["scheduled"], limit: 50 }),
    listOutbox({ statuses: ["sent"], limit: 20 }),
  ]);
  const now = Date.now();

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Mensajes por enviar</h1>
        <p className="text-sm text-neutral-600">
          Los mensajes se agendan solos cuando una reserva se confirma. Nada se envía
          automáticamente: abrís WhatsApp, mandás y marcás como enviado.
        </p>
        <ProcessDueButton action={processDueAction} />
      </header>

      <section className="space-y-3">
        <h2 className="font-medium">Para enviar ahora ({due.length})</h2>
        {due.length === 0 ? (
          <p className="text-sm text-neutral-600">Nada pendiente. 🎉</p>
        ) : (
          due.map((row) => (
            <article key={row.id} className="space-y-2 border border-neutral-300 p-3 text-sm">
              <p className="font-medium">
                {row.label ?? row.templateKey} · {row.guestName} ·{" "}
                <Link
                  href={`/admin/reservas/${row.bookingId}`}
                  className="text-blue-700 underline"
                >
                  {row.reference}
                </Link>{" "}
                · {row.listingTitle}
              </p>
              <p className="text-xs text-neutral-500">
                Programado para {when(row.sendAfter)}
                {row.sendAfter.getTime() < now - 86_400_000 ? " (atrasado)" : ""}
              </p>
              <pre className="whitespace-pre-wrap border bg-neutral-50 p-2">{row.body}</pre>
              <div className="flex flex-wrap items-center gap-3">
                {row.whatsappUrl ? (
                  <a
                    href={row.whatsappUrl}
                    target="_blank"
                    rel="noopener"
                    className="rounded bg-green-700 px-3 py-1 text-white"
                  >
                    Abrir WhatsApp
                  </a>
                ) : (
                  <span className="text-xs text-red-600">
                    Sin teléfono válido — copiá el texto y mandalo a mano
                  </span>
                )}
                <ActionForm
                  action={markSentAction}
                  submitLabel="Marcar enviado"
                  className="inline"
                  submitClassName="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-50"
                >
                  <input type="hidden" name="scheduledId" value={row.id} />
                </ActionForm>
                <ActionForm
                  action={cancelMessageAction}
                  submitLabel="Cancelar"
                  className="inline"
                  submitClassName="rounded border px-3 py-1 disabled:opacity-50"
                >
                  <input type="hidden" name="scheduledId" value={row.id} />
                </ActionForm>
              </div>
            </article>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Agendados ({scheduled.length})</h2>
        {scheduled.length === 0 ? (
          <p className="text-sm text-neutral-600">Sin mensajes agendados.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-1">Cuándo</th>
                <th>Plantilla</th>
                <th>Reserva</th>
                <th>Huésped</th>
              </tr>
            </thead>
            <tbody>
              {scheduled.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="py-1">{when(row.sendAfter)}</td>
                  <td>{row.label ?? row.templateKey}</td>
                  <td>{row.reference}</td>
                  <td>{row.guestName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Últimos enviados</h2>
        {sent.length === 0 ? (
          <p className="text-sm text-neutral-600">Todavía no se envió ninguno.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {sent.map((row) => (
              <li key={row.id}>
                {row.sentAt ? when(row.sentAt) : "—"} · {row.label ?? row.templateKey} ·{" "}
                {row.reference} · {row.guestName}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
