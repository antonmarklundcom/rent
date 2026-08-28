import { Link } from "@/i18n/navigation";
import type { BrowseResult } from "@/db/queries/listings";
import { formatMoney } from "@/lib/money";

const PRICE_UNIT_LABEL: Record<string, string> = {
  per_night: "por noche",
  per_day: "por día",
  per_month: "por mes",
};

/** One browse result. Typed facts differ per vertical (plan §6.S2). */
export function ListingCard({ listing }: { listing: BrowseResult }) {
  const facts =
    listing.propertyType !== null
      ? [
          listing.propertyType,
          listing.bedrooms ? `${listing.bedrooms} dorm.` : null,
          listing.bathrooms ? `${listing.bathrooms} baños` : null,
          listing.maxGuests ? `${listing.maxGuests} huéspedes` : null,
          listing.areaM2 ? `${listing.areaM2} m²` : null,
        ]
      : [
          listing.vehicleType,
          [listing.make, listing.model].filter(Boolean).join(" ") || null,
          listing.year ? String(listing.year) : null,
          listing.transmission,
          listing.seats ? `${listing.seats} asientos` : null,
        ];

  return (
    <li className="border-b border-neutral-200 py-3">
      <Link href={`/publicacion/${listing.slug}`} className="font-medium text-blue-700 underline">
        {listing.title}
      </Link>
      <p className="text-sm text-neutral-600">
        {listing.locationName ?? "Sin ubicación"} ·{" "}
        {formatMoney(listing.price, listing.currency)}{" "}
        {PRICE_UNIT_LABEL[listing.priceUnit] ?? listing.priceUnit}
      </p>
      <p className="text-sm text-neutral-500">
        {facts.filter(Boolean).join(" · ") || "Sin detalles cargados"}
      </p>
    </li>
  );
}
