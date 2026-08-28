import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BookingRequestForm } from "@/components/booking-request-form";
import { Gallery } from "@/components/gallery";
import { WhatsAppCta } from "@/components/whatsapp-cta";
import { listOccupiedRanges } from "@/db/queries/availability";
import { listExtrasForListing } from "@/db/queries/extras";
import { getPublicListing } from "@/db/queries/listings";
import { listInfoItems } from "@/db/queries/messages";
import { MS_PER_DAY } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { normalisePhone } from "@/lib/messaging";

/**
 * Public listing detail (plan §5.O11 → §6.S2 restyle): gallery, typed key
 * facts, occupied dates, extras picker, cancellation policy, WhatsApp CTA and
 * the booking-request form.
 *
 * Only `published` listings resolve — `getPublicListing` enforces that in the
 * query, so a paused listing 404s here rather than quietly rendering.
 */
function fmt(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getPublicListing(slug);
  if (!listing) return {};
  return {
    title: listing.listing.title,
    description: listing.listing.description?.slice(0, 160),
  };
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("listing");

  const listing = await getPublicListing(slug);
  if (!listing) notFound();

  const now = new Date();
  const window = { startAt: now, endAt: new Date(now.getTime() + 180 * MS_PER_DAY) };
  const [occupied, extras, info] = await Promise.all([
    listOccupiedRanges(listing.listing.id, window),
    listExtrasForListing({ id: listing.listing.id, vertical: listing.listing.vertical }),
    listInfoItems(listing.listing.id),
  ]);

  const isStay = listing.listing.vertical === "stay";
  const facts = isStay
    ? [
        [t("factType"), listing.stay?.propertyType ? t(`propertyType.${listing.stay.propertyType}`) : null],
        [t("factBedrooms"), listing.stay?.bedrooms],
        [t("factBathrooms"), listing.stay?.bathrooms],
        [t("factGuests"), listing.stay?.maxGuests],
        [t("factArea"), listing.stay?.areaM2 ? `${listing.stay.areaM2} m²` : null],
        [t("factCheckIn"), listing.stay?.checkInTime],
        [t("factCheckOut"), listing.stay?.checkOutTime],
      ]
    : [
        [t("factType"), listing.carVehicleType ? t(`vehicleType.${listing.carVehicleType}`) : null],
        [t("factMake"), listing.carMake],
        [t("factModel"), listing.carModel],
        [t("factYear"), listing.carYear],
        [t("factTransmission"), listing.carTransmission],
        [t("factFuel"), listing.carFuel],
        [t("factSeats"), listing.carSeats],
        [t("factKmLimit"), listing.carDailyKmLimit],
      ];

  const contactPhone = normalisePhone(process.env.NEXT_PUBLIC_CONTACT_PHONE);
  const whatsappHref = contactPhone
    ? `https://wa.me/${contactPhone}?text=${encodeURIComponent(
        t("whatsappIntro", { title: listing.listing.title }),
      )}`
    : null;

  return (
    <article className="section pt-8">
      <div className="wrap space-y-8">
        <nav className="text-sm text-ink/50">
          <Link href={isStay ? "/alojamientos" : "/autos"} className="hover:text-accent">
            ← {isStay ? t("backToStays") : t("backToCars")}
          </Link>
        </nav>

        <Gallery images={listing.images} title={listing.listing.title} />

        <div className="grid gap-10 lg:grid-cols-[7fr_5fr]">
          <div className="space-y-8">
            <header className="space-y-1">
              <h1>{listing.listing.title}</h1>
              <p className="text-ink/60">
                {listing.locationName ?? t("noLocation")} ·{" "}
                <span className="font-medium text-ink">
                  {formatMoney(listing.listing.price, listing.listing.currency)}
                </span>{" "}
                {t(`priceUnit.${listing.listing.priceUnit}`)}
              </p>
            </header>

            {listing.listing.description && (
              <section>
                <h2 className="!text-xl">{t("description")}</h2>
                <p className="whitespace-pre-line text-ink/70">{listing.listing.description}</p>
              </section>
            )}

            <section>
              <h2 className="!text-xl">{t("details")}</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                {facts
                  .filter(([, value]) => value !== null && value !== undefined && value !== "")
                  .map(([label, value]) => (
                    <div key={String(label)}>
                      <dt className="text-ink/50">{label}</dt>
                      <dd className="font-medium">{String(value)}</dd>
                    </div>
                  ))}
              </dl>
            </section>

            <section>
              <h2 className="!text-xl">{t("availability")}</h2>
              {occupied.length === 0 ? (
                <p className="text-sm text-green-700">{t("noOccupiedDates")}</p>
              ) : (
                <>
                  <p className="text-sm text-ink/60">{t("occupiedDates")}</p>
                  <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                    {occupied.map((entry) => (
                      <li key={`${entry.kind}-${entry.id}`} className="rounded-sm bg-ink/5 px-2 py-1">
                        {fmt(new Date(entry.startAt), locale)} → {fmt(new Date(entry.endAt), locale)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            {info.length > 0 && (
              <section>
                <h2 className="!text-xl">{t("faq")}</h2>
                <dl className="space-y-3 text-sm">
                  {info.map((item) => (
                    <div key={item.id}>
                      <dt className="font-medium">{item.question}</dt>
                      <dd className="mt-1 text-ink/70">{item.answer}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <section>
              <h2 className="!text-xl">{t("cancellation")}</h2>
              <p className="text-sm text-ink/70">
                {t(`cancellationPolicy.${listing.listing.cancellationPolicy}`)}
              </p>
            </section>

            {whatsappHref && (
              <WhatsAppCta href={whatsappHref} label={t("writeUs")} evLoc="listing-detail" />
            )}
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <BookingRequestForm
              listingId={listing.listing.id}
              vertical={listing.listing.vertical}
              extras={extras.map((extra) => ({
                id: extra.id,
                name: extra.name,
                price: formatMoney(extra.price, listing.listing.currency),
                description: extra.description,
              }))}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
