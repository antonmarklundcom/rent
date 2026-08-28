import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/session";
import { LogoutButton } from "@/components/logout-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileNav } from "@/components/mobile-nav";

/** Sticky chrome shared by every page — public and operational alike (plan §6). */
export async function SiteHeader() {
  const t = await getTranslations("common");
  const user = await getSessionUser();

  return (
    <header data-sticky-header className="sticky top-0 z-30 border-b border-ink/10 bg-base/95 backdrop-blur">
      <div className="wrap relative flex h-16 items-center gap-6 md:h-20">
        <Link href="/" className="font-display text-xl italic tracking-tight md:text-2xl">
          alquilar<span className="text-accent">.com.py</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
          <Link href="/alojamientos" className="hover:text-accent">
            {t("stays")}
          </Link>
          <Link href="/autos" className="hover:text-accent">
            {t("cars")}
          </Link>
          <Link href="/nosotros" className="hover:text-accent">
            {t("about")}
          </Link>
          <Link href="/contacto" className="hover:text-accent">
            {t("contact")}
          </Link>
        </nav>

        <div className="ml-auto hidden items-center gap-4 text-sm md:flex">
          <LanguageSwitcher />
          {user ? (
            <>
              {(user.role === "admin" || user.role === "super_admin") && (
                <Link href="/admin" className="hover:text-accent">
                  {t("admin")}
                </Link>
              )}
              {user.role === "owner" && (
                <Link href="/panel" className="hover:text-accent">
                  {t("panel")}
                </Link>
              )}
              <span className="text-ink/50">{user.email}</span>
              <LogoutButton label={t("logout")} />
            </>
          ) : (
            <Link
              href="/ingresar"
              className="rounded-sm border border-ink/20 px-4 py-2 hover:border-ink/40"
            >
              {t("login")}
            </Link>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3 md:hidden">
          <LanguageSwitcher />
          <MobileNav user={user ? { email: user.email, role: user.role } : null} />
        </div>
      </div>
    </header>
  );
}
