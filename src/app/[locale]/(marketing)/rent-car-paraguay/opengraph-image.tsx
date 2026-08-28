import { getTranslations } from "next-intl/server";
import { ogImageContentType, ogImageSize, renderOgImage } from "@/components/og-image";

export const size = ogImageSize;
export const contentType = ogImageContentType;
export const alt = "alquilar.com.py";

/** English-only page (plan §6.S2) — the image is English regardless of the
 * requested locale segment, since the page itself only ever resolves under `en`. */
export default async function Image() {
  const t = await getTranslations({ locale: "en", namespace: "rentCar" });
  return renderOgImage({ eyebrow: t("eyebrow"), title: t("title") });
}
