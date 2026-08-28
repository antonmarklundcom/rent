import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SafeImage } from "@/components/safe-image";
import type { BrowseResult } from "@/db/queries/listings";
import { formatMoney } from "@/lib/money";

/** One browse result. Typed facts differ per vertical (plan §6.S2). */
export async function ListingCard({
  listing,
  reveal,
}: {
  listing: BrowseResult;
  reveal?: number;
}) {
  const t = await getTranslations("listing");
  const facts =
    listing.propertyType !== null
      ? [
          listing.propertyType,
          listing.bedrooms ? t("bedrooms", { count: listing.bedrooms }) : null,
          listing.bathrooms ? t("bathrooms", { count: listing.bathrooms }) : null,
          listing.maxGuests ? t("guests", { count: listing.maxGuests }) : null,
        ]
      : [
          listing.vehicleType,
          [listing.make, listing.model].filter(Boolean).join(" ") || null,
          listing.year ? String(listing.year) : null,
          listing.seats ? t("seats", { count: listing.seats }) : null,
        ];

  return (
    <li
      {...(reveal !== undefined ? { "data-reveal": reveal } : {})}
      className="card--hair card--raised group overflow-hidden rounded-md"
    >
      <Link href={`/publicacion/${listing.slug}`} className="block">
        <div className="aspect-[4/3] overflow-hidden bg-ink/5">
          {listing.coverUrl ? (
            <SafeImage
              src={listing.coverUrl}
              alt={listing.title}
              loading="lazy"
              width={640}
              height={480}
              className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink/40">
              {t("noPhoto")}
            </div>
          )}
        </div>
        <div className="space-y-1.5 p-4">
          <p className="font-display text-lg leading-tight">{listing.title}</p>
          <p className="text-sm text-ink/60">{listing.locationName ?? t("noLocation")}</p>
          <p className="text-sm text-ink/50">{facts.filter(Boolean).join(" · ") || t("noDetails")}</p>
          <p className="pt-1 font-medium">
            {formatMoney(listing.price, listing.currency)}{" "}
            <span className="text-sm font-normal text-ink/50">{t(`priceUnit.${listing.priceUnit}`)}</span>
          </p>
        </div>
      </Link>
    </li>
  );
}
