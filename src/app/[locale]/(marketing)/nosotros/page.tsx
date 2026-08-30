import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ButtonLink } from "@/components/ui/button";
import { bilingualAlternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  const title = t("title");
  const description = t("statement");
  return {
    title,
    description,
    alternates: bilingualAlternates(locale, "/nosotros"),
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");

  const steps = [t("step1"), t("step2"), t("step3"), t("step4")];

  return (
    <>
      <section className="section pt-12">
        <div className="wrap max-w-2xl" style={{ marginLeft: "clamp(0px, 8vw, 160px)" }}>
          <span className="eyebrow">{t("eyebrow")}</span>
          <p className="statement">{t("statement")}</p>
        </div>
      </section>

      <section className="section pt-0">
        <div className="wrap grid gap-8 lg:grid-cols-[4fr_7fr]">
          <div>
            <h2>{t("howTitle")}</h2>
          </div>
          <p className="text-ink/70">{t("howBody")}</p>
        </div>
      </section>

      <section className="section pt-0">
        <div className="wrap">
          <span className="eyebrow">{t("stepsEyebrow")}</span>
          <h2 className="mb-8">{t("stepsTitle")}</h2>
          <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <li key={step} data-reveal={i} className="relative">
                <span className="font-display text-5xl text-accent/25">{i + 1}</span>
                <p className="mt-2 font-medium">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="grain bg-ink text-base">
        <div className="wrap py-10 text-sm sm:flex sm:items-center sm:justify-between">
          <p className="max-w-md">{t("modelNote")}</p>
          <p className="mt-3 max-w-md text-base/70 sm:mt-0">{t("noEscrowNote")}</p>
        </div>
      </section>

      <section className="section">
        <div className="wrap max-w-2xl text-center">
          <h2>{t("ctaTitle")}</h2>
          <p className="mx-auto mt-3 text-ink/60">{t("ctaBody")}</p>
          <div className="mt-6 flex justify-center">
            <ButtonLink href="/contacto" data-ev="nav_click" data-ev-loc="about-cta">
              {t("ctaButton")}
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
