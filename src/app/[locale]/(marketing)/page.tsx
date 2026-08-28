import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ListingCard } from "@/components/listing-card";
import { SafeImage } from "@/components/safe-image";
import { ButtonLink } from "@/components/ui/button";
import { browseListings, browseLocations } from "@/db/queries/listings";

/**
 * Home (plan §5.O11 → §6.S2): dual-vertical hero, featured listings for each
 * vertical, a trust ribbon, location links and a statement CTA for owners.
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

  const cityLinks = new Map<string, { name: string; hasStays: boolean; hasCars: boolean }>();
  for (const l of stayLocations.filter((l) => l.parentId === null)) {
    cityLinks.set(l.slug, { name: l.name, hasStays: true, hasCars: false });
  }
  for (const l of carLocations.filter((l) => l.parentId === null)) {
    const existing = cityLinks.get(l.slug);
    if (existing) existing.hasCars = true;
    else cityLinks.set(l.slug, { name: l.name, hasStays: false, hasCars: true });
  }

  return (
    <>
      {/* P1 — asymmetric split hero. Visual above text on mobile. */}
      <section className="section pt-10 sm:pt-14">
        <div className="wrap grid items-center gap-10 lg:grid-cols-[7fr_5fr] lg:gap-16">
          <div data-reveal={0}>
            <span className="eyebrow">{tc("tagline")}</span>
            <h1 className="statement">{t("title")}</h1>
            <p className="mt-5 text-lg text-ink/70">{t("intro")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/alojamientos" data-ev="nav_click" data-ev-loc="hero">
                {t("browseStays")}
              </ButtonLink>
              <ButtonLink href="/autos" variant="ghost" data-ev="nav_click" data-ev-loc="hero">
                {t("browseCars")}
              </ButtonLink>
            </div>
          </div>
          <div
            data-reveal={1}
            className="scrim aspect-[4/3] overflow-hidden rounded-lg bg-ink/10 lg:aspect-[5/6]"
          >
            <SafeImage
              src="/images/hero-home.jpg"
              alt=""
              fetchPriority="high"
              width={900}
              height={1080}
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* P8 — full-bleed trust ribbon */}
      <section className="grain bg-ink text-base">
        <div className="wrap grid gap-6 py-8 text-sm sm:grid-cols-3">
          <p>
            <strong className="font-display text-lg italic">{t("trust1Title")}</strong>
            <br />
            {t("trust1Body")}
          </p>
          <p>
            <strong className="font-display text-lg italic">{t("trust2Title")}</strong>
            <br />
            {t("trust2Body")}
          </p>
          <p>
            <strong className="font-display text-lg italic">{t("trust3Title")}</strong>
            <br />
            {t("trust3Body")}
          </p>
        </div>
      </section>

      {/* P3 — staggered-weight grid, one per vertical */}
      <section className="section">
        <div className="wrap">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <span className="eyebrow">{tc("stays")}</span>
              <h2>{t("featuredStays")}</h2>
            </div>
            <Link href="/alojamientos" className="hidden text-sm font-medium hover:text-accent sm:block">
              {t("seeAll")} →
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stays.map((row, i) => (
              <ListingCard key={row.id} listing={row} reveal={i} />
            ))}
          </ul>
          {stays.length === 0 && <p className="text-ink/60">{t("noneYet")}</p>}
        </div>
      </section>

      <section className="section pt-0">
        <div className="wrap">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <span className="eyebrow">{tc("cars")}</span>
              <h2>{t("featuredCars")}</h2>
            </div>
            <Link href="/autos" className="hidden text-sm font-medium hover:text-accent sm:block">
              {t("seeAll")} →
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cars.map((row, i) => (
              <ListingCard key={row.id} listing={row} reveal={i} />
            ))}
          </ul>
          {cars.length === 0 && <p className="text-ink/60">{t("noneYet")}</p>}
        </div>
      </section>

      {/* P4 — editorial two-column: heading left, location list right */}
      {cityLinks.size > 0 && (
        <section className="section pt-0">
          <div className="wrap grid gap-8 lg:grid-cols-[4fr_7fr]">
            <div>
              <span className="eyebrow">{t("locationsEyebrow")}</span>
              <h2>{t("locationsTitle")}</h2>
            </div>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              {[...cityLinks.entries()].map(([slug, city]) => (
                <li key={slug} className="space-y-1">
                  <p className="font-medium">{city.name}</p>
                  <p className="flex gap-3 text-sm">
                    {city.hasStays && (
                      <Link href={`/alojamientos/${slug}`} className="text-accent hover:underline">
                        {tc("stays")}
                      </Link>
                    )}
                    {city.hasCars && (
                      <Link href={`/autos/${slug}`} className="text-accent hover:underline">
                        {tc("cars")}
                      </Link>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* P9 — oversized statement CTA, owners */}
      <section className="section">
        <div className="wrap max-w-3xl text-center">
          <p className="statement">{t("ownerCta")}</p>
          <p className="mx-auto mt-4 text-ink/60">{t("ownerCtaBody")}</p>
          <div className="mt-6 flex justify-center">
            <ButtonLink href="/contacto" data-ev="nav_click" data-ev-loc="owner-cta">
              {t("ownerCtaButton")}
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
