import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/session";
import { LogoutButton } from "@/components/logout-button";

/** Ugly-but-working chrome. Sonnet designs this in Window 2 (plan §6). */
export async function SiteHeader() {
  const t = await getTranslations("common");
  const user = await getSessionUser();

  return (
    <header className="border-b border-neutral-200">
      <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
        <Link href="/" className="font-semibold">
          {t("brand")}
        </Link>
        <Link href="/alojamientos">{t("stays")}</Link>
        <Link href="/autos">{t("cars")}</Link>
        <Link href="/contacto">{t("contact")}</Link>
        <span className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              {(user.role === "admin" || user.role === "super_admin") && (
                <Link href="/admin">{t("admin")}</Link>
              )}
              {user.role === "owner" && <Link href="/panel">{t("panel")}</Link>}
              <span className="text-neutral-500">{user.email}</span>
              <LogoutButton label={t("logout")} />
            </>
          ) : (
            <Link href="/ingresar">{t("login")}</Link>
          )}
        </span>
      </nav>
    </header>
  );
}
