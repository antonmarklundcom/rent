import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { BookingRequestForm } from "@/components/booking-request-form";
import { listOccupiedRanges } from "@/db/queries/availability";
import { listExtrasForListing } from "@/db/queries/extras";
import { getPublicListing } from "@/db/queries/listings";
import { listInfoItems } from "@/db/queries/messages";
import { MS_PER_DAY } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { normalisePhone } from "@/lib/messaging";

/**
 * Public listing detail (plan §5.O11): typed key facts, the occupied dates,
 * the extras picker, the cancellation policy, the WhatsApp CTA and the
 * booking-request form.
 *
 * Only `published` listings resolve — `getPublicListing` enforces that in the
 * query, so a paused listing 404s here rather than quietly rendering.
 */
const POLICY_LABEL: Record<string, string> = {
  flexible: "Flexible — cancelás hasta 24 h antes sin costo",
  moderate: "Moderada — cancelás hasta 5 días antes sin costo",
  strict: "Estricta — cancelación sin reintegro",
};

const PRICE_UNIT_LABEL: Record<string, string> = {
  per_night: "por noche",
  per_day: "por día",
  per_month: "por mes",
};

function fmt(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

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
        ["Tipo", listing.stay?.propertyType],
        ["Dormitorios", listing.stay?.bedrooms],
        ["Baños", listing.stay?.bathrooms],
        ["Huéspedes", listing.stay?.maxGuests],
        ["m²", listing.stay?.areaM2],
        ["Check-in", listing.stay?.checkInTime],
        ["Check-out", listing.stay?.checkOutTime],
      ]
    : [
        ["Tipo", listing.carVehicleType],
        ["Marca", listing.carMake],
        ["Modelo", listing.carModel],
        ["Año", listing.carYear],
        ["Caja", listing.carTransmission],
        ["Combustible", listing.carFuel],
        ["Asientos", listing.carSeats],
        ["Km/día incluidos", listing.carDailyKmLimit],
      ];

  const contactPhone = normalisePhone(process.env.NEXT_PUBLIC_CONTACT_PHONE);
  const whatsappHref = contactPhone
    ? `https://wa.me/${contactPhone}?text=${encodeURIComponent(
        `Hola, me interesa "${listing.listing.title}" (${listing.listing.slug})`,
      )}`
    : null;

  return (
    <article className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{listing.listing.title}</h1>
        <p className="text-neutral-600">
          {listing.locationName ?? "Paraguay"} ·{" "}
          {formatMoney(listing.listing.price, listing.listing.currency)}{" "}
          {PRICE_UNIT_LABEL[listing.listing.priceUnit] ?? listing.listing.priceUnit}
        </p>
        <Link
          href={isStay ? "/alojamientos" : "/autos"}
          className="text-sm text-blue-700 underline"
        >
          ← Ver todos los {isStay ? "alojamientos" : "autos"}
        </Link>
      </header>

      {listing.images.length > 0 && (
        <section>
          <h2 className="font-medium">Fotos</h2>
          <ul className="list-disc pl-5 text-sm text-neutral-600">
            {listing.images.map((image) => (
              <li key={image.id}>{image.alt ?? image.url}</li>
            ))}
          </ul>
        </section>
      )}

      {listing.listing.description && (
        <section>
          <h2 className="font-medium">Descripción</h2>
          <p className="whitespace-pre-line text-sm">{listing.listing.description}</p>
        </section>
      )}

      <section>
        <h2 className="font-medium">Datos</h2>
        <dl className="grid grid-cols-2 gap-x-4 text-sm sm:grid-cols-4">
          {facts
            .filter(([, value]) => value !== null && value !== undefined && value !== "")
            .map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-neutral-500">{label}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
        </dl>
      </section>

      <section>
        <h2 className="font-medium">Disponibilidad</h2>
        {occupied.length === 0 ? (
          <p className="text-sm text-green-700">Sin fechas ocupadas en los próximos 6 meses.</p>
        ) : (
          <>
            <p className="text-sm text-neutral-600">Fechas NO disponibles:</p>
            <ul className="list-disc pl-5 text-sm">
              {occupied.map((entry) => (
                <li key={`${entry.kind}-${entry.id}`}>
                  {fmt(new Date(entry.startAt))} → {fmt(new Date(entry.endAt))}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {info.length > 0 && (
        <section>
          <h2 className="font-medium">Preguntas frecuentes</h2>
          <dl className="space-y-2 text-sm">
            {info.map((item) => (
              <div key={item.id}>
                <dt className="font-medium">{item.question}</dt>
                <dd className="text-neutral-700">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section>
        <h2 className="font-medium">Cancelación</h2>
        <p className="text-sm">
          {POLICY_LABEL[listing.listing.cancellationPolicy] ??
            listing.listing.cancellationPolicy}
        </p>
      </section>

      {whatsappHref && (
        <p>
          <a
            href={whatsappHref}
            className="inline-block rounded bg-green-700 px-3 py-2 text-white"
            rel="noopener"
          >
            Escribinos por WhatsApp
          </a>
        </p>
      )}

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
    </article>
  );
}
