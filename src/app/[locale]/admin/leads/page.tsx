import { RetryLeadsButton } from "./retry-button";
import { retryLeadsAction } from "@/app/actions/panel";
import { leadCounts, listLeads } from "@/db/queries/leads";
import { isCrmConfigured } from "@/lib/vendercrm";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Leads and their CRM status (plan §5.O10).
 *
 * Store-first means this list is complete even when VenderCRM never answered —
 * `pending` and `failed` rows are enquiries we HAVE, not enquiries we lost.
 */
export default async function AdminLeadsPage() {
  await requireAdminPage();
  const [rows, counts] = await Promise.all([listLeads({ limit: 100 }), leadCounts()]);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Consultas (leads)</h1>
        <p className="text-sm text-neutral-600">
          En el CRM: {counts.forwarded} · pendientes: {counts.pending} · con error:{" "}
          {counts.failed}
        </p>
        {!isCrmConfigured() && (
          <p className="text-sm text-amber-700">
            VENDERCRM_API_KEY no está configurada: las consultas se guardan acá y quedan
            pendientes de enviar.
          </p>
        )}
        <RetryLeadsButton action={retryLeadsAction} />
      </header>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-1">Fecha</th>
            <th>Nombre</th>
            <th>Contacto</th>
            <th>Vertical</th>
            <th>CRM</th>
            <th>Mensaje</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lead) => (
            <tr key={lead.id} className="border-b align-top">
              <td className="py-1">{lead.createdAt.toISOString().slice(0, 10)}</td>
              <td>{lead.name}</td>
              <td>
                {lead.phone ?? "—"}
                {lead.email ? <span className="block text-xs">{lead.email}</span> : null}
              </td>
              <td>{lead.vertical ?? "—"}</td>
              <td>
                {lead.forwardStatus}
                {lead.forwardError ? (
                  <span className="block text-xs text-red-600">{lead.forwardError}</span>
                ) : null}
              </td>
              <td className="max-w-xs truncate">{lead.message ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-sm text-neutral-600">Sin consultas todavía.</p>}
    </section>
  );
}
