import type { Metadata } from "next";
import Script from "next/script";
import { Instrument_Serif, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { SiteHeader } from "@/components/site-header";
import { SITE_URL } from "@/lib/seo";
import "../globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * Every page under this layout reads the session cookie (header) and most read
 * the database, so nothing here may be prerendered: a build must succeed with
 * no DATABASE_URL at all (plan §4.5). Window 2 can opt individual public routes
 * back into caching once their data-fetching is settled.
 */
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t("brand"), template: `%s · ${t("brand")}` },
    description: t("tagline"),
    // Per-route pages set their own `alternates` (plan §6.S5) — this is only
    // a fallback for any segment that does not (there is none left under
    // `(marketing)`, but admin/panel/tarea inherit it harmlessly since they
    // are disallowed in robots.ts anyway).
    alternates: { languages: { "es-PY": `${SITE_URL}/`, en: `${SITE_URL}/en` } },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("common");

  return (
    <html lang={locale} className={`${instrumentSerif.variable} ${inter.variable}`}>
      <body className="min-h-screen bg-base font-text text-ink antialiased">
        <NextIntlClientProvider>
          <a
            href="#contenido"
            className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-sm focus:bg-ink focus:px-4 focus:py-2 focus:text-base"
          >
            {t("skipToContent")}
          </a>
          <SiteHeader />
          <main id="contenido">{children}</main>
        </NextIntlClientProvider>
        <Script src="/motion.js" strategy="afterInteractive" />
        <Script src="/analytics.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
