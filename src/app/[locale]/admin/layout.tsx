import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { AdminNav } from "@/components/ui/admin-nav";
import { ToastProvider } from "@/components/toast";
import { countAwaitingReply, countDueMessages } from "@/db/queries/messages";
import { leadCounts } from "@/db/queries/leads";
import { operationsCounts } from "@/db/queries/stats";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Shared chrome for every `/admin/*` screen (plan §6.S3): a sidebar/tab nav
 * with the same operational counts the overview page shows, plus the toast
 * host every `ActionForm` on these routes reports into (fix #5 — the toast
 * must sit above whatever row an action swaps out, so it lives here, one
 * level above every page, not inside any of them).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  const t = await getTranslations("admin");
  const [ops, due, awaiting, leads] = await Promise.all([
    operationsCounts(),
    countDueMessages(),
    countAwaitingReply(),
    leadCounts(),
  ]);

  const items = [
    { href: "/admin", label: "Resumen" },
    { href: "/admin/mensajes", label: "Mensajes por enviar", badge: due },
    { href: "/admin/inbox", label: "Bandeja unificada", badge: awaiting },
    { href: "/admin/analitica", label: "Analítica" },
    { href: "/admin/reservas", label: t("bookings") },
    { href: "/admin/publicaciones", label: t("listings") },
    { href: "/admin/limpieza", label: t("cleaning"), badge: ops.openTasks },
    { href: "/admin/mantenimiento", label: t("maintenance"), badge: ops.openTickets },
    { href: "/admin/flota", label: t("fleet"), badge: ops.dueReminders },
    { href: "/admin/propietarios", label: "Propietarios" },
    { href: "/admin/leads", label: "Consultas (CRM)", badge: leads.pending + leads.failed },
    { href: "/admin/plantillas", label: "Plantillas" },
    { href: "/admin/dinero", label: "Dinero" },
    { href: "/admin/usuarios", label: t("users") },
  ];

  return (
    <ToastProvider>
      <div className="wrap grid gap-6 py-6 md:grid-cols-[13rem_1fr] md:py-10">
        <AdminNav items={items} />
        <div className="min-w-0 space-y-8">{children}</div>
      </div>
    </ToastProvider>
  );
}
