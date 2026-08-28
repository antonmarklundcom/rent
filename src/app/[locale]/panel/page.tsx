import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { listListingsForUser } from "@/db/queries/listings";
import { formatMoney } from "@/lib/money";

/** Owner panel. Server-side role gate — hidden UI is never the boundary. */
export default async function PanelPage() {
  const user = await getSessionUser();
  if (!user) redirect("/ingresar");
  if (user.role === "cleaner") redirect("/");

  const t = await getTranslations("panel");
  const tStatus = await getTranslations("listingStatus");
  const rows = await listListingsForUser(user);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p>{t("welcome", { name: user.name })}</p>
      <h2 className="font-medium">{t("listings")}</h2>
      {rows.length === 0 ? (
        <p className="text-neutral-600">{t("noListings")}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-neutral-200">
                <td className="py-1">{row.title}</td>
                <td className="py-1">{row.vertical}</td>
                <td className="py-1">{tStatus(row.status)}</td>
                <td className="py-1">{formatMoney(row.price, row.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
