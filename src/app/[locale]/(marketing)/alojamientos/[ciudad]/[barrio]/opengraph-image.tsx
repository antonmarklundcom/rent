import { getTranslations } from "next-intl/server";
import { ogImageContentType, ogImageSize, renderOgImage } from "@/components/og-image";
import { getPublicLocation } from "@/db/queries/listings";

export const size = ogImageSize;
export const contentType = ogImageContentType;
export const alt = "alquilar.com.py";

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; ciudad: string; barrio: string }>;
}) {
  const { locale, barrio } = await params;
  const [location, t, tc] = await Promise.all([
    getPublicLocation(barrio),
    getTranslations({ locale, namespace: "locationPage" }),
    getTranslations({ locale, namespace: "common" }),
  ]);
  const title = location ? t("title", { vertical: tc("stays"), location: location.name }) : tc("stays");
  return renderOgImage({ eyebrow: tc("stays"), title });
}
