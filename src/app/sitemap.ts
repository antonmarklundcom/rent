import type { MetadataRoute } from "next";
import { browseListings, browseLocations, getPublicLocation } from "@/db/queries/listings";
import { SITE_URL, absoluteLocaleUrl } from "@/lib/seo";

/**
 * plan §6.S5 point 4: every location page (both verticals) plus every
 * published listing, both locales where applicable.
 *
 * This file lives OUTSIDE `[locale]` (Next.js metadata-route convention), so
 * it does NOT inherit the `force-dynamic` the locale layout sets for the
 * session-cookie-reading tree — `next build` would otherwise try to run this
 * at build time and fail with no `DATABASE_URL` at all (plan §4.5). Forcing
 * it dynamic here defers every DB read to request time, and every DB call is
 * additionally wrapped so a DB outage degrades to the static entries rather
 * than a 500.
 */
export const dynamic = "force-dynamic";

function pairEntries(path: string): MetadataRoute.Sitemap {
  const es = absoluteLocaleUrl("es", path);
  const en = absoluteLocaleUrl("en", path);
  const languages = { "es-PY": es, en, "x-default": es };
  return [
    { url: es, alternates: { languages } },
    { url: en, alternates: { languages } },
  ];
}

const STATIC_PATHS = ["/", "/alojamientos", "/autos", "/nosotros", "/contacto"];

/**
 * All live location-page URLs for one vertical, city + barrio tiers.
 *
 * `browseLocations` only returns a location that itself has a DIRECT
 * published listing — a city whose only listings sit on its barrios (real in
 * the seed: Ciudad del Este has none directly, only via barrio "Área 1")
 * would be missing from that alone, even though `/autos/ciudad-del-este`
 * genuinely 200s (`LocationLanding` expands a city slug to its children).
 * `getPublicLocation` has no such "has its own listing" filter, so it is used
 * here to recover the parent for every barrio row and reconstruct the full
 * set of live city + barrio URLs without a new query (plan's hard limit on
 * `src/db/queries/` for this phase).
 */
async function locationPaths(vertical: "stay" | "car", basePath: string): Promise<string[]> {
  const rows = await browseLocations(vertical);
  const citySlugs = new Set<string>();
  const barrioPaths: string[] = [];

  for (const row of rows) {
    if (row.parentId === null) {
      citySlugs.add(row.slug);
      continue;
    }
    const full = await getPublicLocation(row.slug);
    if (full?.parent) {
      citySlugs.add(full.parent.slug);
      barrioPaths.push(`${basePath}/${full.parent.slug}/${row.slug}`);
    }
  }

  return [...[...citySlugs].map((slug) => `${basePath}/${slug}`), ...barrioPaths];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.flatMap(pairEntries);

  // English-only tourist landing page (plan §6.S2) — no `es` alternate, it 404s there.
  entries.push({ url: `${SITE_URL}/en/rent-car-paraguay` });

  try {
    const [stayLocationPaths, carLocationPaths, stays, cars] = await Promise.all([
      locationPaths("stay", "/alojamientos"),
      locationPaths("car", "/autos"),
      browseListings({ vertical: "stay", limit: 5000 }),
      browseListings({ vertical: "car", limit: 5000 }),
    ]);

    for (const path of [...stayLocationPaths, ...carLocationPaths]) {
      entries.push(...pairEntries(path));
    }
    for (const listing of [...stays, ...cars]) {
      entries.push(...pairEntries(`/publicacion/${listing.slug}`));
    }
  } catch {
    // Database unavailable: ship the static entries rather than a 500 (plan §4.5).
  }

  return entries;
}
