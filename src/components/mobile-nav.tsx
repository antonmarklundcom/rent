"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LogoutButton } from "@/components/logout-button";

type NavUser = {
  email: string;
  role: "super_admin" | "admin" | "owner" | "cleaner";
} | null;

/** Mobile menu (<768px). Same links as the desktop nav, one tap to open. */
export function MobileNav({ user }: { user: NavUser }) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("common");

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? t("closeMenu") : t("openMenu")}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-sm border border-ink/15"
      >
        <span className="sr-only">{t("openMenu")}</span>
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-40 border-t border-ink/10 bg-base px-4 py-4 shadow-raised">
          <nav className="flex flex-col gap-1 text-lg">
            <Link href="/alojamientos" onClick={() => setOpen(false)} className="py-2">
              {t("stays")}
            </Link>
            <Link href="/autos" onClick={() => setOpen(false)} className="py-2">
              {t("cars")}
            </Link>
            <Link href="/nosotros" onClick={() => setOpen(false)} className="py-2">
              {t("about")}
            </Link>
            <Link href="/contacto" onClick={() => setOpen(false)} className="py-2">
              {t("contact")}
            </Link>
            <div className="my-2 h-px bg-ink/10" />
            {user ? (
              <>
                {(user.role === "admin" || user.role === "super_admin") && (
                  <Link href="/admin" onClick={() => setOpen(false)} className="py-2">
                    {t("admin")}
                  </Link>
                )}
                {user.role === "owner" && (
                  <Link href="/panel" onClick={() => setOpen(false)} className="py-2">
                    {t("panel")}
                  </Link>
                )}
                <p className="py-2 text-sm text-ink/55">{user.email}</p>
                <LogoutButton label={t("logout")} />
              </>
            ) : (
              <Link href="/ingresar" onClick={() => setOpen(false)} className="py-2">
                {t("login")}
              </Link>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
