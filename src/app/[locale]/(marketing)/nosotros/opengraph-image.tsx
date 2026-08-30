import { getTranslations } from "next-intl/server";
import { ogImageContentType, ogImageSize, renderOgImage } from "@/components/og-image";

export const size = ogImageSize;
export const contentType = ogImageContentType;
export const alt = "alquilar.com.py";

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return renderOgImage({ eyebrow: t("eyebrow"), title: t("statement") });
}
