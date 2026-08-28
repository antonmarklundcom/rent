import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-neutral-600">{t("intro")}</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <Link className="underline" href="/alojamientos">
            {t("browseStays")}
          </Link>
        </li>
        <li>
          <Link className="underline" href="/autos">
            {t("browseCars")}
          </Link>
        </li>
      </ul>
    </section>
  );
}
