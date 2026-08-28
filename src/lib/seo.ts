/**
 * SEO primitives (plan §6.S5): URL/hreflang math and JSON-LD builders.
 *
 * Pure — no database, no session, no Next.js import (matches the rest of
 * `src/lib/`) — so every function here takes plain data and returns plain
 * objects/strings. Callers (page `generateMetadata` functions, the JSON-LD
 * component) own the framework glue.
 *
 * Routing shape this assumes (plan §1.3b, `src/i18n/routing.ts`): `es` is the
 * default locale with NO url prefix, `en` lives under `/en/...`, no
 * translated pathnames — a locale-neutral path is valid for both locales
 * except where a page explicitly says otherwise (`rent-car-paraguay`).
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://alquilar.com.py").replace(
  /\/+$/,
  "",
);

/**
 * Locale-neutral path ("/", "/alojamientos/asuncion", …) → that locale's URL
 * path. `locale` is typed loosely (`string`) to match the `params.locale`
 * shape every page/layout already receives from Next.js — routing.ts is the
 * source of truth for which locales actually exist, so anything other than
 * `"en"` falls back to the `es` (unprefixed) shape rather than throwing.
 */
export function localePath(locale: string, path: string): string {
  const clean = path === "/" ? "" : path;
  return locale === "en" ? `/en${clean}` : clean || "/";
}

/** Locale-neutral path → absolute URL for that locale. */
export function absoluteLocaleUrl(locale: string, path: string): string {
  return `${SITE_URL}${localePath(locale, path)}`;
}

/** A site-relative or already-absolute path/URL → an absolute URL. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/**
 * `alternates` metadata for a locale-neutral path that resolves under BOTH
 * locales — the common case for every public route except
 * `rent-car-paraguay`. `currentLocale` decides the canonical URL; the
 * `languages` map carries the hreflang pair plus `x-default` pointing at the
 * default locale (`es`), per standard hreflang practice.
 */
export function bilingualAlternates(currentLocale: string, path: string) {
  const es = absoluteLocaleUrl("es", path);
  const en = absoluteLocaleUrl("en", path);
  return {
    canonical: currentLocale === "es" ? es : en,
    languages: { "es-PY": es, en, "x-default": es },
  };
}

/**
 * `alternates` for a page that resolves under `en` ONLY (`rent-car-paraguay`
 * 404s under `es` — plan §6.S2 decision). No `es-PY` entry: emitting one
 * would tell search engines a page exists where it 404s.
 */
export function englishOnlyAlternates(path: string) {
  const en = absoluteLocaleUrl("en", path);
  return { canonical: en, languages: { en, "x-default": en } };
}

/* -------------------------------------------------------------------------- */
/* JSON-LD (plan §6.S5 point 6)                                               */
/* -------------------------------------------------------------------------- */

export type JsonLdValue = Record<string, unknown>;

const PROPERTY_TYPE_SCHEMA: Record<string, string> = {
  casa: "House",
  departamento: "Apartment",
  habitacion: "Room",
  otro: "Accommodation",
};

/** Drop keys whose value is null/undefined/empty so JSON-LD stays honest. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== "")) as T;
}

export function buildStayJsonLd(input: {
  url: string;
  name: string;
  description?: string | null;
  images: string[];
  locationName?: string | null;
  propertyType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  maxGuests?: number | null;
  areaM2?: string | number | null;
  price: string | number;
  currency: string;
}): JsonLdValue {
  return compact({
    "@context": "https://schema.org",
    "@type": (input.propertyType && PROPERTY_TYPE_SCHEMA[input.propertyType]) || "Accommodation",
    name: input.name,
    description: input.description ?? undefined,
    url: input.url,
    image: input.images.length > 0 ? input.images : undefined,
    address: input.locationName
      ? compact({ "@type": "PostalAddress", addressLocality: input.locationName, addressCountry: "PY" })
      : undefined,
    numberOfRooms: input.bedrooms ?? undefined,
    numberOfBathroomsTotal: input.bathrooms ?? undefined,
    occupancy:
      input.maxGuests != null ? { "@type": "QuantitativeValue", maxValue: input.maxGuests } : undefined,
    floorSize:
      input.areaM2 != null ? { "@type": "QuantitativeValue", value: input.areaM2, unitCode: "MTK" } : undefined,
    offers: compact({
      "@type": "Offer",
      price: String(input.price),
      priceCurrency: input.currency,
      availability: "https://schema.org/InStock",
      url: input.url,
    }),
  });
}

export function buildCarJsonLd(input: {
  url: string;
  name: string;
  description?: string | null;
  images: string[];
  make?: string | null;
  model?: string | null;
  year?: number | null;
  transmission?: string | null;
  fuel?: string | null;
  seats?: number | null;
  price: string | number;
  currency: string;
}): JsonLdValue {
  return compact({
    "@context": "https://schema.org",
    "@type": "Car",
    name: input.name,
    description: input.description ?? undefined,
    url: input.url,
    image: input.images.length > 0 ? input.images : undefined,
    brand: input.make ? { "@type": "Brand", name: input.make } : undefined,
    model: input.model ?? undefined,
    vehicleModelDate: input.year != null ? String(input.year) : undefined,
    vehicleTransmission: input.transmission ?? undefined,
    fuelType: input.fuel ?? undefined,
    seatingCapacity: input.seats ?? undefined,
    offers: compact({
      "@type": "Offer",
      price: String(input.price),
      priceCurrency: input.currency,
      availability: "https://schema.org/InStock",
      url: input.url,
    }),
  });
}

/** Cheap ItemList JSON-LD for a browse/location grid (plan §6.S5 point 6). */
export function buildItemListJsonLd(items: { url: string; name: string }[]): JsonLdValue {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: item.url,
      name: item.name,
    })),
  };
}

/** Breadcrumb JSON-LD matching the visible breadcrumb on location/detail pages. */
export function buildBreadcrumbJsonLd(items: { name: string; url: string }[]): JsonLdValue {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
