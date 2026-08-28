import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocationLanding } from "@/components/location-landing";
import { getPublicLocation } from "@/db/queries/listings";
import { bilingualAlternates } from "@/lib/seo";

/** Canonical is always the bare `/autos/[ciudad]` (plan §6.S5 point 7). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; ciudad: string }>;
}): Promise<Metadata> {
  const { locale, ciudad } = await params;
  const location = await getPublicLocation(ciudad);
  if (!location) return {};
  const t = await getTranslations({ locale, namespace: "locationPage" });
  const tc = await getTranslations({ locale, namespace: "common" });
  const title = t("title", { vertical: tc("cars"), location: location.name });
  const description = t("introCar", { location: location.name });
  return {
    title,
    description,
    alternates: bilingualAlternates(locale, `/autos/${ciudad}`),
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function AutosCiudadPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; ciudad: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, ciudad } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  return <LocationLanding vertical="car" basePath="/autos" slug={ciudad} query={query} />;
}
