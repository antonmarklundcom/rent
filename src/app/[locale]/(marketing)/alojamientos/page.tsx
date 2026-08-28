import { getTranslations, setRequestLocale } from "next-intl/server";
import { BrowseFilters } from "@/components/browse-filters";
import { ListingCard } from "@/components/listing-card";
import { browseListings, browseLocations } from "@/db/queries/listings";
import { PROPERTY_TYPES, type PropertyType } from "@/db/schema";

/**
 * Browse alojamientos (plan §5.O11 → §6.S2 restyle). Filters are GET params so
 * every filtered view is a real URL — S-2 (§6.S5) adds canonicals.
 */
export default async function BrowseStaysPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const one = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const t = await getTranslations("browse");
  const tipo = one("tipo");

  const [rows, locations] = await Promise.all([
    browseListings({
      vertical: "stay",
      locationSlug: one("ubicacion") ?? null,
      propertyType: (PROPERTY_TYPES as readonly string[]).includes(tipo ?? "")
        ? (tipo as PropertyType)
        : null,
      guests: Number(one("huespedes")) || null,
      bedrooms: Number(one("dormitorios")) || null,
      minPrice: Number(one("min")) || null,
      maxPrice: Number(one("max")) || null,
      sort:
        one("orden") === "price_asc" || one("orden") === "price_desc"
          ? (one("orden") as "price_asc" | "price_desc")
          : "recent",
    }),
    browseLocations("stay"),
  ]);

  return (
    <section className="section pt-10">
      <div className="wrap space-y-6">
        <div>
          <span className="eyebrow">{t("stayEyebrow")}</span>
          <h1>{t("stayTitle")}</h1>
        </div>
        <BrowseFilters
          vertical="stay"
          action="/alojamientos"
          locations={locations.map((l) => ({ slug: l.slug, name: l.name, listings: Number(l.listings) }))}
          values={{
            ubicacion: one("ubicacion"),
            tipo,
            huespedes: one("huespedes"),
            dormitorios: one("dormitorios"),
            min: one("min"),
            max: one("max"),
            orden: one("orden"),
          }}
        />
        <p className="text-sm text-ink/60">{t("results", { count: rows.length })}</p>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row, i) => (
            <ListingCard key={row.id} listing={row} reveal={i % 6} />
          ))}
        </ul>
        {rows.length === 0 && <p className="text-ink/60">{t("emptyStays")}</p>}
      </div>
    </section>
  );
}
