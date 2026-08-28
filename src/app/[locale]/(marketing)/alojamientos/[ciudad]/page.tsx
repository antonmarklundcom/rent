import { setRequestLocale } from "next-intl/server";
import { LocationLanding } from "@/components/location-landing";

export default async function AlojamientosCiudadPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; ciudad: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, ciudad } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  return <LocationLanding vertical="stay" basePath="/alojamientos" slug={ciudad} query={query} />;
}
