import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { adminCounts, operationsCounts } from "@/db/queries/stats";
import { requireAdminPage } from "@/lib/page-guards";

export default async function AdminPage() {
  const user = await requireAdminPage();

  const t = await getTranslations("admin");
  const [counts, ops] = await Promise.all([adminCounts(), operationsCounts()]);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p>{t("welcome", { name: user.name })}</p>
      <h2 className="font-medium">{t("counts")}</h2>
      <ul className="list-disc pl-5 text-sm">
        <li>
          {t("users")}: {counts.users}
        </li>
        <li>
          {t("listings")}: {counts.listings}
        </li>
        <li>
          {t("bookings")}: {counts.bookings}
        </li>
        <li>limpieza: {counts.cleaningTasks}</li>
      </ul>

      <h2 className="font-medium">Operaciones</h2>
      <ul className="list-disc pl-5 text-sm">
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
      </ul>
    </section>
  );
}
