import { getTranslations, setRequestLocale } from "next-intl/server";
import { BrowseFilters } from "@/components/browse-filters";
import { ListingCard } from "@/components/listing-card";
import { browseListings, browseLocations } from "@/db/queries/listings";
import { VEHICLE_TYPES, type VehicleType } from "@/db/schema";

/**
 * Browse autos (plan §5.O11). Same engine as alojamientos, different typed
 * facts — the vertical is the only difference, per plan §2.
 */
export default async function BrowseCarsPage({
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
      vertical: "car",
      locationSlug: one("ubicacion") ?? null,
      vehicleType: (VEHICLE_TYPES as readonly string[]).includes(tipo ?? "")
        ? (tipo as VehicleType)
        : null,
      seats: Number(one("asientos")) || null,
      minPrice: Number(one("min")) || null,
      maxPrice: Number(one("max")) || null,
      sort:
        one("orden") === "price_asc" || one("orden") === "price_desc"
          ? (one("orden") as "price_asc" | "price_desc")
          : "recent",
    }),
    browseLocations("car"),
  ]);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("cars")}</h1>
      <BrowseFilters
        vertical="car"
        action="/autos"
        locations={locations.map((l) => ({ slug: l.slug, name: l.name, listings: Number(l.listings) }))}
        values={{
          ubicacion: one("ubicacion"),
          tipo,
          asientos: one("asientos"),
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
        <p className="text-neutral-600">No encontramos autos con esos filtros.</p>
      )}
    </section>
  );
}
