import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ListingCard } from "@/components/listing-card";
import { SafeImage } from "@/components/safe-image";
import { ButtonLink } from "@/components/ui/button";
import { WhatsAppCta } from "@/components/whatsapp-cta";
import { browseListings, browseLocations } from "@/db/queries/listings";
import { normalisePhone } from "@/lib/messaging";

/**
 * English tourist landing page (plan §1.3): only ever served at `/en/...` —
 * the `es` path 404s so it is never duplicate content under the default
 * locale (§6.S5 owns hreflang/canonicals; this page just refuses to exist
 * outside `en`).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== "en") return {};
  const t = await getTranslations({ locale, namespace: "rentCar" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function RentCarParaguayPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== "en") notFound();
  setRequestLocale(locale);
  const t = await getTranslations("rentCar");

  const [cars, locations] = await Promise.all([
    browseListings({ vertical: "car", limit: 6 }),
    browseLocations("car"),
  ]);
  const cities = locations.filter((l) => l.parentId === null);

  const contactPhone = normalisePhone(process.env.NEXT_PUBLIC_CONTACT_PHONE);
  const whatsappHref = contactPhone
    ? `https://wa.me/${contactPhone}?text=${encodeURIComponent(t("whatsappIntro"))}`
    : null;

  const faqs = [
    [t("faq1Q"), t("faq1A")],
    [t("faq2Q"), t("faq2A")],
    [t("faq3Q"), t("faq3A")],
  ];

  return (
    <>
      <section className="section pt-10">
        <div className="wrap grid items-center gap-10 lg:grid-cols-[7fr_5fr]">
          <div data-reveal={0}>
            <span className="eyebrow">{t("eyebrow")}</span>
            <h1 className="statement">{t("title")}</h1>
            <p className="mt-5 text-lg text-ink/70">{t("intro")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/autos" data-ev="nav_click" data-ev-loc="rent-car-hero">
                {t("browseButton")}
              </ButtonLink>
              {whatsappHref && (
                <WhatsAppCta href={whatsappHref} label={t("whatsappCta")} evLoc="rent-car-hero" />
              )}
            </div>
          </div>
          <div data-reveal={1} className="scrim aspect-[4/3] overflow-hidden rounded-lg bg-ink/10">
            <SafeImage
              src="/images/hero-rent-car.jpg"
              alt=""
              fetchPriority="high"
              width={900}
              height={675}
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </section>

      <section className="section pt-0">
        <div className="wrap">
          <h2>{t("fleetTitle")}</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cars.map((row, i) => (
              <ListingCard key={row.id} listing={row} reveal={i % 6} />
            ))}
          </ul>
        </div>
      </section>

      {cities.length > 0 && (
        <section className="grain bg-ink text-base">
          <div className="wrap py-10">
            <p className="eyebrow !text-base/50">{t("citiesEyebrow")}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {cities.map((city) => (
                <span key={city.slug} className="rounded-sm border border-base/20 px-3 py-1.5 text-sm">
                  {city.name}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="wrap grid gap-8 lg:grid-cols-[4fr_7fr]">
          <div>
            <h2>{t("faqTitle")}</h2>
          </div>
          <dl className="space-y-6">
            {faqs.map(([q, a]) => (
              <div key={q}>
                <dt className="font-medium">{q}</dt>
                <dd className="mt-1 text-ink/70">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
