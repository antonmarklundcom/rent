import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BrowseFilters } from "@/components/browse-filters";
import { JsonLd } from "@/components/json-ld";
import { ListingCard } from "@/components/listing-card";
import { browseListings, browseLocations } from "@/db/queries/listings";
import { VEHICLE_TYPES, type VehicleType } from "@/db/schema";
import { absoluteLocaleUrl, bilingualAlternates, buildItemListJsonLd } from "@/lib/seo";

/**
 * Browse autos (plan §5.O11 → §6.S2 restyle). Same engine as alojamientos,
 * different typed facts — the vertical is the only difference (plan §2).
 *
 * Canonical is always the bare `/autos`, filters never fork it (plan §6.S5
 * point 7) — see the matching comment on `alojamientos/page.tsx`.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "browse" });
  return {
    title: t("carMetaTitle"),
    description: t("carMetaDescription"),
    alternates: bilingualAlternates(locale, "/autos"),
    openGraph: { title: t("carMetaTitle"), description: t("carMetaDescription"), type: "website" },
    twitter: { card: "summary_large_image", title: t("carMetaTitle"), description: t("carMetaDescription") },
  };
}

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
  const t = await getTranslations("browse");
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
    <section className="section pt-10">
      {rows.length > 0 && (
        <JsonLd
          data={buildItemListJsonLd(
            rows.map((row) => ({ name: row.title, url: absoluteLocaleUrl(locale, `/publicacion/${row.slug}`) })),
          )}
        />
      )}
      <div className="wrap space-y-6">
        <div>
          <span className="eyebrow">{t("carEyebrow")}</span>
          <h1>{t("carTitle")}</h1>
        </div>
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
        <p className="text-sm text-ink/60">{t("results", { count: rows.length })}</p>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row, i) => (
            <ListingCard key={row.id} listing={row} reveal={i % 6} />
          ))}
        </ul>
        {rows.length === 0 && <p className="text-ink/60">{t("emptyCars")}</p>}
      </div>
    </section>
  );
}
