import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, messageStatusTone } from "@/components/ui/badge";
import { PageHeader, Section, TableWrap, EmptyState, table, th, td } from "@/components/ui/page-header";
import { WhatsAppCta } from "@/components/whatsapp-cta";
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
    <div className="space-y-8">
      <PageHeader
        title="Mensajes por enviar"
        subtitle="Los mensajes se agendan solos cuando una reserva se confirma. Nada se envía automáticamente: abrís WhatsApp, mandás y marcás como enviado."
        actions={<ProcessDueButton action={processDueAction} />}
      />

      <Section title={`Para enviar ahora (${due.length})`}>
        {due.length === 0 ? (
          <EmptyState>Nada pendiente. 🎉</EmptyState>
        ) : (
          <div className="space-y-3">
            {due.map((row) => (
              <article key={row.id} className="space-y-3 rounded-md border border-ink/10 p-4 text-sm">
                <p>
                  <span className="font-medium">{row.label ?? row.templateKey}</span> · {row.guestName} ·{" "}
                  <Link href={`/admin/reservas/${row.bookingId}`} className="text-accent hover:underline">
                    {row.reference}
                  </Link>{" "}
                  · {row.listingTitle}
                </p>
                <p className="text-xs text-ink/50">
                  Programado para {when(row.sendAfter)}
                  {row.sendAfter.getTime() < now - 86_400_000 && (
                    <Badge tone="critical" className="ml-2">atrasado</Badge>
                  )}
                </p>
                <pre className="whitespace-pre-wrap rounded-md bg-ink/[0.03] p-3 font-sans text-sm">{row.body}</pre>
                <div className="flex flex-wrap items-center gap-3">
                  {row.whatsappUrl ? (
                    <WhatsAppCta href={row.whatsappUrl} label="Abrir WhatsApp" evLoc="admin_outbox" className="min-h-10 px-4 text-sm" />
                  ) : (
                    <span className="text-xs text-red-600">
                      Sin teléfono válido — copiá el texto y mandalo a mano
                    </span>
                  )}
                  <ActionForm
                    action={markSentAction}
                    submitLabel="Marcar enviado"
                    className="inline"
                    submitClassName="rounded-sm bg-ink px-3 py-1.5 text-sm text-base disabled:opacity-50"
                  >
                    <input type="hidden" name="scheduledId" value={row.id} />
                  </ActionForm>
                  <ActionForm
                    action={cancelMessageAction}
                    submitLabel="Cancelar"
                    className="inline"
                    submitClassName="rounded-sm border border-ink/20 px-3 py-1.5 text-sm hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                  >
                    <input type="hidden" name="scheduledId" value={row.id} />
                  </ActionForm>
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section title={`Agendados (${scheduled.length})`}>
        {scheduled.length === 0 ? (
          <EmptyState>Sin mensajes agendados.</EmptyState>
        ) : (
          <TableWrap>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Cuándo</th>
                  <th className={th}>Plantilla</th>
                  <th className={th}>Reserva</th>
                  <th className={th}>Huésped</th>
                </tr>
              </thead>
              <tbody>
                {scheduled.map((row) => (
                  <tr key={row.id}>
                    <td className={td}>{when(row.sendAfter)}</td>
                    <td className={td}>{row.label ?? row.templateKey}</td>
                    <td className={td}>{row.reference}</td>
                    <td className={td}>{row.guestName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Últimos enviados">
        {sent.length === 0 ? (
          <EmptyState>Todavía no se envió ninguno.</EmptyState>
        ) : (
          <ul className="divide-y divide-ink/8 text-sm">
            {sent.map((row) => (
              <li key={row.id} className="py-2">
                {row.sentAt ? when(row.sentAt) : "—"} · {row.label ?? row.templateKey} ·{" "}
                {row.reference} · {row.guestName}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
