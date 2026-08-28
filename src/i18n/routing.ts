import { defineRouting } from "next-intl/routing";

/**
 * i18n from day one (plan §1.3b): Spanish (es-PY, voseo) is the default locale
 * and gets NO URL prefix — `/alojamientos`, `/autos`, `/panel`. English lives
 * under `/en/...`. Route folder names are Spanish because es is the default;
 * code identifiers stay English.
 */
export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "as-needed",
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
