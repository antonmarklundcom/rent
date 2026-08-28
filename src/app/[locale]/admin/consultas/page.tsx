import { ActionForm } from "@/components/action-form";
import { retryLeadsAction } from "@/app/actions/owner";
import { leadCounts, listLeads } from "@/db/queries/leads";
import { isCrmConfigured } from "@/lib/vendercrm";
import { formatLocalDateTime } from "@/lib/messaging";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Leads (plan §5.O10) — stored here first, forwarded to VenderCRM second.
 *
 * The `pending`/`failed` counts are the whole reason this page exists: if the
 * CRM was unreachable, the lead is still on this list and one button re-sends
 * it. Nothing a visitor submits is ever only in the CRM's hands.
 */
export default async function AdminLeadsPage() {
  await requireAdminPage();
  const [rows, counts] = await Promise.all([listLeads({ limit: 100 }), leadCounts()]);
  const configured = isCrmConfigured();

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Consultas</h1>
        <p className="text-sm text-neutral-600">
          {counts.forwarded} enviada(s) a VenderCRM · {counts.pending} pendiente(s) ·{" "}
          {counts.failed} con error
        </p>
        {!configured && (
          <p className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
            VenderCRM no está configurado (<code>VENDERCRM_API_URL</code> /{" "}
            <code>VENDERCRM_API_KEY</code>). Las consultas se guardan igual y se pueden
            reenviar cuando estén las credenciales.
          </p>
        )}
      </div>

      <ActionForm
        action={retryLeadsAction}
        submitLabel="Reenviar pendientes a VenderCRM"
        className="inline"
        submitClassName="rounded border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50"
      />

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1">Cuándo</th>
            <th>Nombre</th>
            <th>Contacto</th>
            <th>Publicación</th>
            <th>CRM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lead) => (
            <tr key={lead.id} className="border-b align-top">
              <td className="py-1">{formatLocalDateTime(lead.createdAt)}</td>
              <td>
                {lead.name}
                {lead.message && (
                  <span className="block max-w-xs truncate text-xs text-neutral-500">
                    {lead.message}
                  </span>
                )}
              </td>
              <td>
                {lead.phone ?? "—"}
                {lead.email && <span className="block text-xs">{lead.email}</span>}
              </td>
              <td>{lead.listingTitle ?? lead.vertical ?? "—"}</td>
              <td>
                {lead.forwardStatus}
                {lead.forwardError && (
                  <span className="block max-w-xs truncate text-xs text-red-700">
                    {lead.forwardError}
                  </span>
                )}
                {lead.crmContactId && (
                  <span className="block text-xs text-neutral-500">
                    contacto {lead.crmContactId}
                  </span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-1 text-neutral-500">
                Todavía no llegaron consultas.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
