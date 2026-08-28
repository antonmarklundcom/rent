import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { WhatsAppCta } from "@/components/whatsapp-cta";
import { browseLocations } from "@/db/queries/listings";
import { normalisePhone } from "@/lib/messaging";

/** Shared footer for the public marketing surface (plan §6.S2). */
export async function SiteFooter() {
  const t = await getTranslations("footer");
  const tc = await getTranslations("common");

  const [stayLocations, carLocations] = await Promise.all([
    browseLocations("stay"),
    browseLocations("car"),
  ]);
  const cities = new Map<string, string>();
  for (const loc of [...stayLocations, ...carLocations]) {
    if (loc.parentId === null) cities.set(loc.slug, loc.name);
  }
  const topCities = [...cities.entries()].slice(0, 6);

  const contactPhone = normalisePhone(process.env.NEXT_PUBLIC_CONTACT_PHONE);
  const whatsappHref = contactPhone
    ? `https://wa.me/${contactPhone}?text=${encodeURIComponent(t("whatsappIntro"))}`
    : null;

  return (
    <footer className="grain bg-ink text-base">
      <div className="wrap section grid gap-10 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <div className="space-y-4">
          <p className="font-display text-2xl italic">
            alquilar<span className="text-accent">.com.py</span>
          </p>
          <p className="max-w-xs text-base/70 text-sm">{t("blurb")}</p>
          {whatsappHref && (
            <WhatsAppCta href={whatsappHref} label={t("writeUs")} evLoc="footer" />
          )}
        </div>

        <div className="space-y-3 text-sm">
          <p className="eyebrow !text-base/50">{tc("stays")}</p>
          <nav className="flex flex-col gap-2">
            <Link href="/alojamientos" className="hover:text-accent">
              {t("browseAll", { vertical: tc("stays") })}
            </Link>
            {stayLocations
              .filter((l) => l.parentId === null)
              .slice(0, 5)
              .map((l) => (
                <Link key={l.slug} href={`/alojamientos/${l.slug}`} className="hover:text-accent">
                  {l.name}
                </Link>
              ))}
          </nav>
        </div>

        <div className="space-y-3 text-sm">
          <p className="eyebrow !text-base/50">{tc("cars")}</p>
          <nav className="flex flex-col gap-2">
            <Link href="/autos" className="hover:text-accent">
              {t("browseAll", { vertical: tc("cars") })}
            </Link>
            {carLocations
              .filter((l) => l.parentId === null)
              .slice(0, 5)
              .map((l) => (
                <Link key={l.slug} href={`/autos/${l.slug}`} className="hover:text-accent">
                  {l.name}
                </Link>
              ))}
          </nav>
        </div>

        <div className="space-y-3 text-sm">
          <p className="eyebrow !text-base/50">{t("company")}</p>
          <nav className="flex flex-col gap-2">
            <Link href="/nosotros" className="hover:text-accent">
              {tc("about")}
            </Link>
            <Link href="/contacto" className="hover:text-accent">
              {tc("contact")}
            </Link>
            <Link href="/en/rent-car-paraguay" className="hover:text-accent">
              Rent a car in Paraguay
            </Link>
          </nav>
        </div>
      </div>

      {topCities.length > 0 && (
        <div className="border-t border-base/10">
          <div className="wrap flex flex-wrap gap-x-4 gap-y-2 py-4 text-xs text-base/50">
            <span className="eyebrow !text-base/40">{t("cities")}</span>
            {topCities.map(([slug, name]) => (
              <span key={slug}>{name}</span>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-base/10">
        <div className="wrap flex flex-col gap-2 py-6 text-xs text-base/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} alquilar.com.py — {t("rights")}</p>
          <p>{t("noEscrow")}</p>
        </div>
      </div>
    </footer>
  );
}
