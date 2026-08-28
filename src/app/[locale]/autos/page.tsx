import { getTranslations, setRequestLocale } from "next-intl/server";
import { BrowsePage } from "@/components/browse-page";

export default async function CarsBrowsePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  return (
    <BrowsePage
      vertical="car"
      title={t("cars")}
      detailBase="/auto"
      searchParams={await searchParams}
    />
  );
}
