import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * plan §6.S5 point 5. Fully static (no DB read), so it is safe to prerender
 * at build time even with no `.env` at all (plan §4.5).
 *
 * `/api/` is disallowed broadly except `/api/ical/`, which calendar clients
 * (Google Calendar, Apple Calendar, …) fetch directly and which is meant to
 * be reachable by anything holding the token — the `Allow` rule is more
 * specific than the blanket `Disallow` so it wins under the standard
 * longest-match precedence. `/ingresar` (login) is added alongside
 * admin/panel/tarea: it is a utility page with nothing to rank, not public
 * content, even though the prompt's own list only named the other three.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/api/ical/"],
        disallow: [
          "/admin",
          "/en/admin",
          "/panel",
          "/en/panel",
          "/tarea",
          "/en/tarea",
          "/ingresar",
          "/en/ingresar",
          "/api/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
