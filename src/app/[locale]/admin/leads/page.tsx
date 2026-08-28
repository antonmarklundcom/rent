import { RetryLeadsButton } from "./retry-button";
import { Badge, leadForwardTone } from "@/components/ui/badge";
import { PageHeader, Section, TableWrap, EmptyState, table, th, td } from "@/components/ui/page-header";
import { StatRow, StatTile } from "@/components/ui/stat-tile";
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
    <div className="space-y-6">
      <PageHeader title="Consultas (leads)" actions={<RetryLeadsButton action={retryLeadsAction} />} />

      <Section>
        <StatRow>
          <StatTile label="En el CRM" value={counts.forwarded} />
          <StatTile label="Pendientes" value={counts.pending} />
          <StatTile label="Con error" value={counts.failed} />
        </StatRow>
        {!isCrmConfigured() && (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            VENDERCRM_API_KEY no está configurada: las consultas se guardan acá y quedan
            pendientes de enviar.
          </p>
        )}
      </Section>

      <Section>
        {rows.length === 0 ? (
          <EmptyState>Sin consultas todavía.</EmptyState>
        ) : (
          <TableWrap>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Fecha</th>
                  <th className={th}>Nombre</th>
                  <th className={th}>Contacto</th>
                  <th className={th}>Vertical</th>
                  <th className={th}>CRM</th>
                  <th className={th}>Mensaje</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((lead) => (
                  <tr key={lead.id}>
                    <td className={td}>{lead.createdAt.toISOString().slice(0, 10)}</td>
                    <td className={`${td} font-medium`}>{lead.name}</td>
                    <td className={td}>
                      {lead.phone ?? "—"}
                      {lead.email ? <span className="block text-xs text-ink/50">{lead.email}</span> : null}
                    </td>
                    <td className={td}>{lead.vertical === "car" ? "auto" : lead.vertical === "stay" ? "alojamiento" : "—"}</td>
                    <td className={td}>
                      <Badge tone={leadForwardTone(lead.forwardStatus)}>{lead.forwardStatus}</Badge>
                      {lead.forwardError ? (
                        <span className="mt-1 block text-xs text-red-600">{lead.forwardError}</span>
                      ) : null}
                    </td>
                    <td className={`${td} max-w-xs truncate`}>{lead.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
