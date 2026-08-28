import { setRequestLocale } from "next-intl/server";
import { ListingDetail } from "@/components/listing-detail";

/** Car detail — see the note on the stay route about why this is singular. */
export default async function CarDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  return <ListingDetail slug={slug} vertical="car" />;
}
