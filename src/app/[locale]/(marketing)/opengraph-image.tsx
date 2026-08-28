import { getTranslations } from "next-intl/server";
import { ogImageContentType, ogImageSize, renderOgImage } from "@/components/og-image";

export const size = ogImageSize;
export const contentType = ogImageContentType;
export const alt = "alquilar.com.py";

/**
 * Home page share image (plan §6.S5 point 2). `(marketing)` is a route
 * GROUP, so this file is scoped to the leaf route it sits beside — `/` —
 * and does NOT cascade to sibling segments like `nosotros/` or `contacto/`
 * (confirmed live: unlike `icon.png`, an `opengraph-image` file does not
 * inherit across route-group siblings). Each shareable route gets its own
 * file; `nosotros`/`contacto` get one too even though they are not on the
 * plan's explicit "main shareable pages" list, for consistency.
 */
export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
  return renderOgImage({ eyebrow: t("metaTitle"), title: t("title") });
}
