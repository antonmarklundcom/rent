import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ButtonLink } from "@/components/ui/button";

/** 404 (plan §6.S2). Rendered inside the locale layout, so it already has the
 * right `lang`, fonts and header — it just needs its own body. */
export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <section className="section flex min-h-[60vh] items-center justify-center pt-12 text-center">
      <div className="wrap max-w-md">
        <p className="font-display text-6xl italic text-accent">404</p>
        <h1 className="mt-4">{t("title")}</h1>
        <p className="mt-3 text-ink/60">{t("body")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/">{t("home")}</ButtonLink>
          <Link
            href="/contacto"
            className="inline-flex min-h-12 items-center rounded-sm border border-ink/20 px-6 hover:border-ink/40"
          >
            {t("contact")}
          </Link>
        </div>
      </div>
    </section>
  );
}
