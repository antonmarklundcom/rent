import { getTranslations, setRequestLocale } from "next-intl/server";
import { BrowsePage } from "@/components/browse-page";

export default async function StaysBrowsePage({
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
      vertical="stay"
      title={t("stays")}
      detailBase="/alojamiento"
      searchParams={await searchParams}
    />
  );
}
