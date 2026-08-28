import { setRequestLocale } from "next-intl/server";
import { ListingDetail } from "@/components/listing-detail";

/**
 * Listing detail, singular route (plan §9, O-4 route-map decision):
 * `/alojamientos/[ciudad]` is reserved for phase S-2's location landing pages.
 */
export default async function StayDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  return <ListingDetail slug={slug} vertical="stay" />;
}
