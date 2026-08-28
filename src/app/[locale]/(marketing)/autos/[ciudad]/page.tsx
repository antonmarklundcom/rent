import { setRequestLocale } from "next-intl/server";
import { LocationLanding } from "@/components/location-landing";

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
