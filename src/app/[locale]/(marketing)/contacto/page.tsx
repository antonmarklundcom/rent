import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ContactForm } from "@/components/contact-form";
import { WhatsAppCta } from "@/components/whatsapp-cta";
import { bilingualAlternates } from "@/lib/seo";
import { normalisePhone } from "@/lib/messaging";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });
  const title = t("title");
  const description = t("intro");
  return {
    title,
    description,
    alternates: bilingualAlternates(locale, "/contacto"),
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contact");

  const contactPhone = normalisePhone(process.env.NEXT_PUBLIC_CONTACT_PHONE);
  const whatsappHref = contactPhone
    ? `https://wa.me/${contactPhone}?text=${encodeURIComponent(t("whatsappIntro"))}`
    : null;

  return (
    <section className="section pt-12">
      <div className="wrap grid gap-10 lg:grid-cols-[5fr_7fr]">
        <div data-reveal={0}>
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1>{t("title")}</h1>
          <p className="mt-4 text-ink/70">{t("intro")}</p>
          {whatsappHref && (
            <div className="mt-6">
              <WhatsAppCta href={whatsappHref} label={t("whatsappCta")} evLoc="contacto-hero" />
            </div>
          )}
          {contactPhone && (
            <a
              href={`tel:+${contactPhone}`}
              data-ev="call_click"
              data-ev-loc="contacto-hero"
              className="mt-3 block text-sm text-ink/60 hover:text-accent"
            >
              {t("orCall")} +{contactPhone}
            </a>
          )}
        </div>
        <div data-reveal={1}>
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
