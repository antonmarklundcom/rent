import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BrowseFilters } from "@/components/browse-filters";
import { ListingCard } from "@/components/listing-card";
import { WhatsAppCta } from "@/components/whatsapp-cta";
import { browseListings, browseLocations, getPublicLocation } from "@/db/queries/listings";
import { normalisePhone } from "@/lib/messaging";
import type { Vertical } from "@/db/schema";

/**
 * `/alojamientos/[ciudad]`, `/alojamientos/[ciudad]/[barrio]`, `/autos/[ciudad]`,
 * `/autos/[ciudad]/[barrio]` (plan §6.S2) share this component — the only
 * difference between the four routes is which `vertical` and `basePath` they
 * pass in. An unknown slug, or one with zero published listings in this
 * vertical, 404s.
 */
export async function LocationLanding({
  vertical,
  basePath,
  slug,
  parentSlug,
  query,
}: {
  vertical: Vertical;
  basePath: "/alojamientos" | "/autos";
  slug: string;
  /** Set only by the `/[ciudad]/[barrio]` route: the URL's city segment must
   * name this location's actual parent, or the URL is a duplicate-content
   * alias (any city slug + a valid barrio slug would otherwise 200) rather
   * than a real address. */
  parentSlug?: string;
  query: Record<string, string | string[] | undefined>;
}) {
  const one = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const location = await getPublicLocation(slug);
  if (!location) notFound();
  if (parentSlug !== undefined && location.parent?.slug !== parentSlug) notFound();

  const [rows, allLocations] = await Promise.all([
    browseListings({
      vertical,
      locationSlug: slug,
      minPrice: Number(one("min")) || null,
      maxPrice: Number(one("max")) || null,
      guests: Number(one("huespedes")) || null,
      bedrooms: Number(one("dormitorios")) || null,
      seats: Number(one("asientos")) || null,
      sort:
        one("orden") === "price_asc" || one("orden") === "price_desc"
          ? (one("orden") as "price_asc" | "price_desc")
          : "recent",
    }),
    browseLocations(vertical),
  ]);
  if (rows.length === 0) notFound();

  const t = await getTranslations("locationPage");
  const tc = await getTranslations("common");
  const vertLabel = vertical === "stay" ? tc("stays") : tc("cars");

  const siblings = allLocations.filter((l) => l.parentId === location.id);
  const contactPhone = normalisePhone(process.env.NEXT_PUBLIC_CONTACT_PHONE);
  const whatsappHref = contactPhone
    ? `https://wa.me/${contactPhone}?text=${encodeURIComponent(
        t("whatsappIntro", { location: location.name, vertical: vertLabel.toLowerCase() }),
      )}`
    : null;

  return (
    <section className="section pt-10">
      <div className="wrap space-y-6">
        <nav className="flex flex-wrap items-center gap-1 text-sm text-ink/50">
          <Link href={basePath} className="hover:text-accent">
            {vertLabel}
          </Link>
          {location.parent && (
            <>
              <span>/</span>
              <Link href={`${basePath}/${location.parent.slug}`} className="hover:text-accent">
                {location.parent.name}
              </Link>
            </>
          )}
          <span>/</span>
          <span className="text-ink">{location.name}</span>
        </nav>

        <div>
          <span className="eyebrow">{vertLabel}</span>
          <h1>{t("title", { vertical: vertLabel, location: location.name })}</h1>
          <p className="mt-3 max-w-2xl text-ink/70">
            {t(vertical === "stay" ? "introStay" : "introCar", { location: location.name })}
          </p>
        </div>

        <BrowseFilters
          vertical={vertical}
          action={`${basePath}/${slug}`}
          locations={[]}
          lockedLocationLabel={location.name}
          values={{
            ubicacion: slug,
            huespedes: one("huespedes"),
            dormitorios: one("dormitorios"),
            asientos: one("asientos"),
            min: one("min"),
            max: one("max"),
            orden: one("orden"),
          }}
        />

        {siblings.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <span className="text-sm text-ink/50">{t("neighborhoods")}:</span>
            {siblings.map((s) => (
              <Link
                key={s.slug}
                href={`${basePath}/${slug}/${s.slug}`}
                className="rounded-sm border border-ink/15 px-3 py-1 text-sm hover:border-accent hover:text-accent"
              >
                {s.name}
              </Link>
            ))}
          </div>
        )}

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row, i) => (
            <ListingCard key={row.id} listing={row} reveal={i % 6} />
          ))}
        </ul>

        {whatsappHref && (
          <div className="card--accent flex flex-col items-start gap-3 rounded-lg p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink/70">{t("cantFind", { location: location.name })}</p>
            <WhatsAppCta href={whatsappHref} label={t("askUs")} evLoc="location-page" />
          </div>
        )}
      </div>
    </section>
  );
}
