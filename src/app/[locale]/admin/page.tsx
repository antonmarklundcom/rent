import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { commsCounts } from "@/db/queries/messages";
import { leadCounts } from "@/db/queries/leads";
import { adminCounts, operationsCounts } from "@/db/queries/stats";
import { requireAdminPage } from "@/lib/page-guards";

type Entry = { href: string; label: string; detail: string };

/** The admin index (plan §5.O11): one link per entity, with what needs doing. */
export default async function AdminPage() {
  const user = await requireAdminPage();
  const t = await getTranslations("admin");

  const [counts, ops, comms, leads] = await Promise.all([
    adminCounts(),
    operationsCounts(),
    commsCounts(),
    leadCounts(),
  ]);

  const sections: { title: string; entries: Entry[] }[] = [
    {
      title: "Reservas y publicaciones",
      entries: [
        {
          href: "/admin/reservas",
          label: t("bookings"),
          detail: `${counts.bookings} en total`,
        },
        {
          href: "/admin/publicaciones",
          label: t("listings"),
          detail: `${counts.listings} cargada(s)`,
        },
        {
          href: "/admin/precios",
          label: "Adicionales y códigos",
          detail: "extras (#10) y promociones (#18)",
        },
      ],
    },
    {
      title: "Operaciones",
      entries: [
        {
          href: "/admin/limpieza",
          label: t("cleaning"),
          detail: `${t("openTasks")}: ${ops.openTasks} · ${t("lowStock")}: ${ops.lowStock}`,
        },
        {
          href: "/admin/mantenimiento",
          label: t("maintenance"),
          detail: `${t("openTickets")}: ${ops.openTickets}`,
        },
        {
          href: "/admin/flota",
          label: t("fleet"),
          detail: `${t("dueReminders")}: ${ops.dueReminders} · ${t("pendingDocuments")}: ${ops.pendingDocuments}`,
        },
      ],
    },
    {
      title: "Comunicación y crecimiento",
      entries: [
        {
          href: "/admin/mensajes",
          label: "Mensajes",
          detail: `${comms.due} para enviar · ${comms.threads} conversación(es)`,
        },
        {
          href: "/admin/consultas",
          label: "Consultas",
          detail: `${leads.pending} pendiente(s) · ${leads.failed} con error de envío`,
        },
        {
          href: "/admin/propietarios",
          label: "Propietarios",
          detail: "checklist de puesta en marcha (#19)",
        },
      ],
    },
    {
      title: "Dinero y control",
      entries: [
        {
          href: "/admin/dinero",
          label: "Cobros y liquidaciones",
          detail: "links de pago (#8) y estados de cuenta (#3)",
        },
        {
          href: "/admin/analitica",
          label: "Analítica",
          detail: "ocupación, ingresos, flota, orígenes (#12)",
        },
        ...(user.role === "super_admin"
          ? [
              {
                href: "/admin/usuarios",
                label: t("users"),
                detail: `${counts.users} cuenta(s)`,
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p>{t("welcome", { name: user.name })}</p>
      </div>

      {sections.map((section) => (
        <section key={section.title} className="space-y-1">
          <h2 className="font-medium">{section.title}</h2>
          <ul className="space-y-1 text-sm">
            {section.entries.map((entry) => (
              <li key={entry.href}>
                <Link href={entry.href} className="text-blue-700 underline">
                  {entry.label}
                </Link>{" "}
                <span className="text-neutral-600">— {entry.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
