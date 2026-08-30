import { getTranslations } from "next-intl/server";
import { ogImageContentType, ogImageSize, renderOgImage } from "@/components/og-image";
import { getPublicListing } from "@/db/queries/listings";

export const size = ogImageSize;
export const contentType = ogImageContentType;
export const alt = "alquilar.com.py";

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const [listing, tc] = await Promise.all([
    getPublicListing(slug),
    getTranslations({ locale, namespace: "common" }),
  ]);
  const eyebrow = listing ? (listing.locationName ?? tc("brand")) : tc("brand");
  const title = listing?.listing.title ?? tc("brand");
  return renderOgImage({ eyebrow, title });
}
