import { setRequestLocale } from "next-intl/server";
import { LocationLanding } from "@/components/location-landing";

export default async function AlojamientosBarrioPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; ciudad: string; barrio: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, barrio } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  return <LocationLanding vertical="stay" basePath="/alojamientos" slug={barrio} query={query} />;
}
