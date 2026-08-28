import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listLocationsWithListings, listPublishedListings } from "@/db/queries/listings";
import { formatMoney } from "@/lib/money";

/**
 * Home (plan §5.O11): both verticals, a few live listings and the location
 * links phase S-2 turns into landing pages. Ugly by design.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tCommon = await getTranslations("common");

  const [stays, cars, locations] = await Promise.all([
    listPublishedListings("stay", { limit: 6 }),
    listPublishedListings("car", { limit: 6 }),
    listLocationsWithListings(),
  ]);

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-neutral-600">{t("intro")}</p>
        <div className="flex gap-3 text-sm">
          <Link href="/alojamientos" className="rounded border border-neutral-400 px-3 py-2">
            {t("browseStays")}
          </Link>
          <Link href="/autos" className="rounded border border-neutral-400 px-3 py-2">
            {t("browseCars")}
          </Link>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">{tCommon("stays")}</h2>
        <ul className="space-y-1 text-sm">
          {stays.map((row) => (
            <li key={row.id}>
              <Link href={`/alojamiento/${row.slug}`} className="text-blue-700 underline">
                {row.title}
              </Link>{" "}
              — {row.locationName ?? "Paraguay"} · {formatMoney(row.price, row.currency)}
            </li>
          ))}
          {stays.length === 0 && (
            <li className="text-neutral-500">Todavía no hay alojamientos publicados.</li>
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">{tCommon("cars")}</h2>
        <ul className="space-y-1 text-sm">
          {cars.map((row) => (
            <li key={row.id}>
              <Link href={`/auto/${row.slug}`} className="text-blue-700 underline">
                {row.title}
              </Link>{" "}
              — {row.locationName ?? "Paraguay"} · {formatMoney(row.price, row.currency)}
            </li>
          ))}
          {cars.length === 0 && (
            <li className="text-neutral-500">Todavía no hay autos publicados.</li>
          )}
        </ul>
      </section>

      {locations.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Zonas</h2>
          <ul className="flex flex-wrap gap-3 text-sm">
            {locations.map((location) => (
              <li key={location.id}>
                <Link
                  href={`/alojamientos?ubicacion=${location.id}`}
                  className="text-blue-700 underline"
                >
                  {location.name}
                </Link>{" "}
                <span className="text-neutral-500">({location.listingCount})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-sm">
        <Link href="/contacto" className="text-blue-700 underline">
          ¿Tenés una propiedad o un auto para alquilar? Escribinos.
        </Link>
      </p>
    </section>
  );
}
