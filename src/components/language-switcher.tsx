"use client";

import { usePathname } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";

/** Dictionary-only per plan §1.3b — no logic, just the two locales we ship. */
export function LanguageSwitcher() {
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations("common");

  return (
    <span className="flex items-center gap-1 text-sm" aria-label={t("language")}>
      <Link
        href={pathname}
        locale="es"
        className={locale === "es" ? "font-semibold text-ink" : "text-ink/50 hover:text-ink"}
      >
        ES
      </Link>
      <span className="text-ink/30">/</span>
      <Link
        href={pathname}
        locale="en"
        className={locale === "en" ? "font-semibold text-ink" : "text-ink/50 hover:text-ink"}
      >
        EN
      </Link>
    </span>
  );
}
