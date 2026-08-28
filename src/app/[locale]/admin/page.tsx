import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { adminCounts } from "@/db/queries/stats";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/ingresar");
  if (user.role !== "admin" && user.role !== "super_admin") redirect("/");

  const t = await getTranslations("admin");
  const counts = await adminCounts();

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
    </section>
  );
}
