import { getTranslations, setRequestLocale } from "next-intl/server";
import { listPublishedListings } from "@/db/queries/listings";
import { formatMoney } from "@/lib/money";

export default async function BrowsePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  const rows = await listPublishedListings("stay");

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("stays")}</h1>
      <ul className="space-y-2 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="border-b border-neutral-200 pb-2">
            <strong>{row.title}</strong>
            {row.locationName ? ` — ${row.locationName}` : ""} —{" "}
            {formatMoney(row.price, row.currency)}
          </li>
        ))}
      </ul>
    </section>
  );
}
