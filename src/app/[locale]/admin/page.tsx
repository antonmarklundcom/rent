import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PageHeader, Section } from "@/components/ui/page-header";
import { StatRow, StatTile } from "@/components/ui/stat-tile";
import { countAwaitingReply, countDueMessages } from "@/db/queries/messages";
import { leadCounts } from "@/db/queries/leads";
import { adminCounts, operationsCounts } from "@/db/queries/stats";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Admin landing (plan §5.O11, restyled §6.S3): today's operational backlog up
 * front, portfolio counts underneath. The full entity map lives in the
 * sidebar nav (`AdminLayout`) now, so this page leads with what needs a human
 * today rather than repeating every link.
 */
function Todo({
  href,
  label,
  count,
  hint,
}: {
  href: string;
  label: string;
  count: number;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm transition-colors ${
        count > 0
          ? "border-accent/25 bg-accent/5 hover:border-accent/50"
          : "border-ink/10 hover:border-ink/25"
      }`}
    >
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink/50">{hint}</span>}
      </span>
      <span
        className={`font-display text-2xl italic ${count > 0 ? "text-accent" : "text-ink/30"}`}
      >
        {count}
      </span>
    </Link>
  );
}

export default async function AdminPage() {
  const user = await requireAdminPage();

  const t = await getTranslations("admin");
  const [counts, ops, due, awaiting, leads] = await Promise.all([
    adminCounts(),
    operationsCounts(),
    countDueMessages(),
    countAwaitingReply(),
    leadCounts(),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} subtitle={t("welcome", { name: user.name })} />

      <Section title="Hoy" description="Lo que necesita una persona ahora mismo.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Todo href="/admin/mensajes" label="Mensajes por enviar" count={due} />
          <Todo href="/admin/inbox" label="Conversaciones sin responder" count={awaiting} />
          <Todo
            href="/admin/limpieza"
            label={t("cleaning")}
            count={ops.openTasks}
            hint={`${t("lowStock")}: ${ops.lowStock}`}
          />
          <Todo href="/admin/mantenimiento" label={t("openTickets")} count={ops.openTickets} />
          <Todo
            href="/admin/flota"
            label={t("dueReminders")}
            count={ops.dueReminders}
            hint={`${t("pendingDocuments")}: ${ops.pendingDocuments}`}
          />
          <Todo
            href="/admin/leads"
            label="Consultas sin enviar al CRM"
            count={leads.pending + leads.failed}
          />
        </div>
      </Section>

      <Section title="Cartera" description="Resumen de la base de datos.">
        <StatRow>
          <StatTile label={t("bookings")} value={counts.bookings} />
          <StatTile label={t("listings")} value={counts.listings} />
          <StatTile label={t("users")} value={counts.users} />
        </StatRow>
      </Section>
    </div>
  );
}
