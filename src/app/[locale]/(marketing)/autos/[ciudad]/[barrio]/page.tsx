import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocationLanding } from "@/components/location-landing";
import { getPublicLocation } from "@/db/queries/listings";
import { bilingualAlternates } from "@/lib/seo";

/** Same city/barrio-match guard as the alojamientos barrio page. */
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
  const title = t("title", { vertical: tc("cars"), location: location.name });
  const description = t("introCar", { location: location.name });
  return {
    title,
    description,
    alternates: bilingualAlternates(locale, `/autos/${ciudad}/${barrio}`),
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function AutosBarrioPage({
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
      vertical="car"
      basePath="/autos"
      slug={barrio}
      parentSlug={ciudad}
      query={query}
    />
  );
}
