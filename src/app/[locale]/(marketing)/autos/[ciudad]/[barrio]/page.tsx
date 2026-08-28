import { setRequestLocale } from "next-intl/server";
import { LocationLanding } from "@/components/location-landing";

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
