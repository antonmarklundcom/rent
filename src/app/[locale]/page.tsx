import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ListingCard } from "@/components/listing-card";
import { browseListings, browseLocations } from "@/db/queries/listings";

/**
 * Home (plan §5.O11): both verticals, a few featured listings and the location
 * links that seed the SEO landing pages Sonnet builds in §6.S2/S5.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tc = await getTranslations("common");

  const [stays, cars, stayLocations, carLocations] = await Promise.all([
    browseListings({ vertical: "stay", limit: 4 }),
    browseListings({ vertical: "car", limit: 4 }),
    browseLocations("stay"),
    browseLocations("car"),
  ]);

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-neutral-600">{t("intro")}</p>
        <p className="flex gap-3">
          <Link className="rounded bg-neutral-900 px-3 py-2 text-white" href="/alojamientos">
            {t("browseStays")}
          </Link>
          <Link className="rounded border px-3 py-2" href="/autos">
            {t("browseCars")}
          </Link>
        </p>
      </section>

      <section>
        <h2 className="font-medium">{tc("stays")}</h2>
        <ul>
          {stays.map((row) => (
            <ListingCard key={row.id} listing={row} />
          ))}
        </ul>
        <p className="pt-2 text-sm">
          {stayLocations.map((location) => (
            <Link
              key={location.id}
              href={`/alojamientos?ubicacion=${location.slug}`}
              className="mr-3 text-blue-700 underline"
            >
              {location.name}
            </Link>
          ))}
        </p>
      </section>

      <section>
        <h2 className="font-medium">{tc("cars")}</h2>
        <ul>
          {cars.map((row) => (
            <ListingCard key={row.id} listing={row} />
          ))}
        </ul>
        <p className="pt-2 text-sm">
          {carLocations.map((location) => (
            <Link
              key={location.id}
              href={`/autos?ubicacion=${location.slug}`}
              className="mr-3 text-blue-700 underline"
            >
              {location.name}
            </Link>
          ))}
        </p>
      </section>
    </div>
  );
}
