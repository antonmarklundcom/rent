import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { requestBookingForm, submitLeadForm } from "@/app/actions/public";
import { listOccupiedRanges } from "@/db/queries/availability";
import { listExtrasForListing } from "@/db/queries/extras";
import { getListingDetailBySlug, listListingImages } from "@/db/queries/listings";
import { listInfoItems } from "@/db/queries/info";
import type { Vertical } from "@/db/schema";
import { addDays, startOfUtcDay } from "@/lib/dates";
import { formatLocalDate } from "@/lib/messaging";
import { formatMoney } from "@/lib/money";

const inputClass = "w-full rounded border border-neutral-300 px-2 py-1";

/**
 * The public listing page (plan §5.O11): typed facts, what is already booked,
 * a booking-request form and a plain enquiry form.
 *
 * Deliberately ugly — this phase's job is that every one of those works.
 * Sonnet designs it in phase S-2 (plan §6.S2).
 */
export async function ListingDetail({
  slug,
  vertical,
}: {
  slug: string;
  vertical: Vertical;
}) {
  const detail = await getListingDetailBySlug(slug);
  // A draft or paused listing is not public, and neither is a car under
  // `/alojamiento/...` — one URL, one listing, or a 404.
  if (!detail || detail.listing.status !== "published" || detail.listing.vertical !== vertical) {
    notFound();
  }

  const window = {
    startAt: startOfUtcDay(new Date()),
    endAt: addDays(startOfUtcDay(new Date()), 120),
  };
  const [occupied, extras, images, info] = await Promise.all([
    listOccupiedRanges(detail.listing.id, window),
    listExtrasForListing({ id: detail.listing.id, vertical }),
    listListingImages(detail.listing.id),
    listInfoItems(detail.listing.id),
  ]);

  const facts =
    vertical === "stay"
      ? [
          ["Tipo", detail.stay?.propertyType],
          ["Dormitorios", detail.stay?.bedrooms],
          ["Baños", detail.stay?.bathrooms],
          ["Huéspedes", detail.stay?.maxGuests],
          ["Superficie", detail.stay?.areaM2 ? `${detail.stay.areaM2} m²` : null],
        ]
      : [
          ["Tipo", detail.car?.vehicleType],
          ["Marca", detail.car?.make],
          ["Modelo", detail.car?.model],
          ["Año", detail.car?.year],
          ["Caja", detail.car?.transmission],
          ["Combustible", detail.car?.fuel],
          ["Asientos", detail.car?.seats],
          ["Km por día", detail.car?.dailyKmLimit],
        ];

  return (
    <article className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{detail.listing.title}</h1>
        <p className="text-neutral-600">
          {detail.locationName ?? "Paraguay"} ·{" "}
          {formatMoney(detail.listing.price, detail.listing.currency)} /{" "}
          {detail.listing.priceUnit}
        </p>
        <p className="text-sm text-neutral-500">
          Política de cancelación: {detail.listing.cancellationPolicy}
        </p>
      </header>

      {detail.listing.description && (
        <p className="whitespace-pre-wrap">{detail.listing.description}</p>
      )}

      <section className="space-y-1">
        <h2 className="font-medium">Datos</h2>
        <ul className="list-disc pl-5 text-sm">
          {facts
            .filter(([, value]) => value !== null && value !== undefined && value !== "")
            .map(([label, value]) => (
              <li key={String(label)}>
                {label}: {String(value)}
              </li>
            ))}
        </ul>
        {vertical === "car" && detail.car?.insuranceTerms && (
          <p className="text-sm text-neutral-600">{detail.car.insuranceTerms}</p>
        )}
      </section>

      {images.length > 0 && (
        <section className="space-y-1 text-sm">
          <h2 className="font-medium">Fotos ({images.length})</h2>
          <ul className="text-neutral-600">
            {images.map((image) => (
              <li key={image.id}>{image.alt ?? image.url}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-1">
        <h2 className="font-medium">Fechas ocupadas (próximos 120 días)</h2>
        {occupied.length === 0 ? (
          <p className="text-sm text-neutral-600">Está libre en los próximos 120 días.</p>
        ) : (
          <ul className="space-y-0.5 text-sm text-neutral-700">
            {occupied.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`}>
                {formatLocalDate(entry.startAt)} → {formatLocalDate(entry.endAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {info.length > 0 && (
        <section className="space-y-1">
          <h2 className="font-medium">Preguntas frecuentes</h2>
          <ul className="space-y-1 text-sm">
            {info.map((item) => (
              <li key={item.id}>
                <strong>{item.question}</strong>
                <span className="block text-neutral-700">{item.answer}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">Pedir esta reserva</h2>
        <p className="text-sm text-neutral-600">
          Es una solicitud, no una reserva confirmada: revisamos la disponibilidad y te
          escribimos para cerrarla.
        </p>
        <ActionForm action={requestBookingForm} submitLabel="Enviar solicitud">
          <input type="hidden" name="listingId" value={detail.listing.id} />
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span>{vertical === "stay" ? "Llegada" : "Retiro"}</span>
              <input type="date" name="startAt" required className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>{vertical === "stay" ? "Salida" : "Devolución"}</span>
              <input type="date" name="endAt" required className={inputClass} />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span>Nombre</span>
            <input name="guestName" required className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span>WhatsApp</span>
              <input
                name="guestPhone"
                type="tel"
                placeholder="0981 123 456"
                className={inputClass}
              />
            </label>
            <label className="space-y-1">
              <span>Correo</span>
              <input name="guestEmail" type="email" className={inputClass} />
            </label>
          </div>
          {vertical === "stay" && (
            <label className="block space-y-1 text-sm">
              <span>Huéspedes</span>
              <input
                type="number"
                name="guestCount"
                min={1}
                max={50}
                className="w-24 rounded border border-neutral-300 px-2 py-1"
              />
            </label>
          )}

          {extras.length > 0 && (
            <fieldset className="space-y-1 text-sm">
              <legend>Adicionales</legend>
              {extras.map((extra) => (
                <label key={extra.id} className="flex items-center gap-2">
                  <input
                    type="number"
                    name={`extra:${extra.id}`}
                    min={0}
                    max={50}
                    defaultValue={0}
                    className="w-16 rounded border border-neutral-300 px-1 py-1"
                  />
                  <span>
                    {extra.name} — {formatMoney(extra.price, detail.listing.currency)}
                    {extra.perUnit ? " por día" : ""}
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          <label className="block space-y-1 text-sm">
            <span>Código promocional</span>
            <input name="promoCode" className="w-48 rounded border border-neutral-300 px-2 py-1" />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Comentarios</span>
            <textarea name="notes" rows={3} className={inputClass} />
          </label>
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[9999px]"
          />
        </ActionForm>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">O hacenos una consulta</h2>
        <ActionForm action={submitLeadForm} submitLabel="Enviar consulta">
          <input type="hidden" name="listingId" value={detail.listing.id} />
          <input type="hidden" name="vertical" value={vertical} />
          <input
            type="hidden"
            name="sourceUrl"
            value={`/${vertical === "stay" ? "alojamiento" : "auto"}/${detail.listing.slug}`}
          />
          <label className="block space-y-1 text-sm">
            <span>Nombre</span>
            <input name="name" required className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span>WhatsApp</span>
              <input name="phone" type="tel" className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>Correo</span>
              <input name="email" type="email" className={inputClass} />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span>Tu consulta</span>
            <textarea name="message" rows={3} className={inputClass} />
          </label>
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[9999px]"
          />
        </ActionForm>
      </section>
    </article>
  );
}
