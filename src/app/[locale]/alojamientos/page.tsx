import { getTranslations, setRequestLocale } from "next-intl/server";
import { BrowseFilters } from "@/components/browse-filters";
import { ListingCard } from "@/components/listing-card";
import { browseListings, browseLocations } from "@/db/queries/listings";
import { PROPERTY_TYPES, type PropertyType } from "@/db/schema";

/**
 * Browse alojamientos (plan §5.O11). Filters are GET params so every filtered
 * view is a real URL — Sonnet adds canonicals and copy in Window 2 (§6.S2/S5).
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
  const t = await getTranslations("common");
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
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("stays")}</h1>
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
      <p className="text-sm text-neutral-600">{rows.length} resultado(s)</p>
      <ul>
        {rows.map((row) => (
          <ListingCard key={row.id} listing={row} />
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="text-neutral-600">No encontramos alojamientos con esos filtros.</p>
      )}
    </section>
  );
}
