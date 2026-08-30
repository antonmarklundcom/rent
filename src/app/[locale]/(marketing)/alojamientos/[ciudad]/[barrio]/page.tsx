import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocationLanding } from "@/components/location-landing";
import { getPublicLocation } from "@/db/queries/listings";
import { bilingualAlternates } from "@/lib/seo";

/**
 * Only resolves metadata for a barrio whose own `ciudad` segment matches —
 * same guard `LocationLanding` applies for the page itself (S-1 pre-handoff
 * audit fix), so a mismatched city/barrio pair never gets a canonical tag
 * pointing at a URL that itself 404s.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; ciudad: string; barrio: string }>;
}): Promise<Metadata> {
  const { locale, ciudad, barrio } = await params;
  const location = await getPublicLocation(barrio);
  if (!location || location.parent?.slug !== ciudad) return {};
  const t = await getTranslations({ locale, namespace: "locationPage" });
  const tc = await getTranslations({ locale, namespace: "common" });
  const title = t("title", { vertical: tc("stays"), location: location.name });
  const description = t("introStay", { location: location.name });
  return {
    title,
    description,
    alternates: bilingualAlternates(locale, `/alojamientos/${ciudad}/${barrio}`),
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function AlojamientosBarrioPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; ciudad: string; barrio: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, ciudad, barrio } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  return (
    <LocationLanding
      vertical="stay"
      basePath="/alojamientos"
      slug={barrio}
      parentSlug={ciudad}
      query={query}
    />
  );
}
