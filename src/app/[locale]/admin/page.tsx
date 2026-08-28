import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { countAwaitingReply, countDueMessages } from "@/db/queries/messages";
import { leadCounts } from "@/db/queries/leads";
import { adminCounts, operationsCounts } from "@/db/queries/stats";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Admin landing (plan §5.O11): counts, the operational backlog, and one link
 * per entity screen. This is the map — every §3 feature is reachable from here.
 */
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
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p>{t("welcome", { name: user.name })}</p>
      </header>

      <section className="space-y-1">
        <h2 className="font-medium">Hoy</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>
            <Link href="/admin/mensajes" className="text-blue-700 underline">
              Mensajes por enviar
            </Link>
            : {due}
          </li>
          <li>
            <Link href="/admin/inbox" className="text-blue-700 underline">
              Conversaciones sin responder
            </Link>
            : {awaiting}
          </li>
          <li>
            <Link href="/admin/limpieza" className="text-blue-700 underline">
              {t("cleaning")}
            </Link>{" "}
            — {t("openTasks")}: {ops.openTasks} · {t("lowStock")}: {ops.lowStock}
          </li>
          <li>
            <Link href="/admin/mantenimiento" className="text-blue-700 underline">
              {t("maintenance")}
            </Link>{" "}
            — {t("openTickets")}: {ops.openTickets}
          </li>
          <li>
            <Link href="/admin/flota" className="text-blue-700 underline">
              {t("fleet")}
            </Link>{" "}
            — {t("dueReminders")}: {ops.dueReminders} · {t("pendingDocuments")}:{" "}
            {ops.pendingDocuments}
          </li>
          <li>
            <Link href="/admin/leads" className="text-blue-700 underline">
              Consultas sin enviar al CRM
            </Link>
            : {leads.pending + leads.failed}
          </li>
        </ul>
      </section>

      <section className="space-y-1">
        <h2 className="font-medium">Gestión</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>
            <Link href="/admin/reservas" className="text-blue-700 underline">
              {t("bookings")}
            </Link>{" "}
            ({counts.bookings})
          </li>
          <li>
            <Link href="/admin/publicaciones" className="text-blue-700 underline">
              {t("listings")}
            </Link>{" "}
            ({counts.listings})
          </li>
          <li>
            <Link href="/admin/propietarios" className="text-blue-700 underline">
              Propietarios y onboarding
            </Link>
          </li>
          <li>
            <Link href="/admin/usuarios" className="text-blue-700 underline">
              {t("users")}
            </Link>{" "}
            ({counts.users})
          </li>
          <li>
            <Link href="/admin/plantillas" className="text-blue-700 underline">
              Plantillas de mensajes
            </Link>
          </li>
          <li>
            <Link href="/admin/dinero" className="text-blue-700 underline">
              Dinero — links de pago, estados, extras y códigos
            </Link>
          </li>
          <li>
            <Link href="/admin/analitica" className="text-blue-700 underline">
              Analítica
            </Link>
          </li>
        </ul>
      </section>
    </section>
  );
}
