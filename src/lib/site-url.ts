/**
 * The public base URL, in one place.
 *
 * Used by anything that has to hand somebody a link that works OUTSIDE the
 * app: a cleaner's magic link, a listing's iCal feed for Airbnb, a statement
 * URL in a WhatsApp message. Relative paths are useless in all three.
 */
export function siteUrl(path = ""): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Public iCal feed for a listing's export token (#2). */
export function icalFeedUrl(token: string): string {
  return siteUrl(`/api/ical/${token}.ics`);
}
