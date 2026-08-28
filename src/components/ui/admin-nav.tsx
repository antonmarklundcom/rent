"use client";

import { Link, usePathname } from "@/i18n/navigation";

type NavItem = { href: string; label: string; badge?: number };

/**
 * Entity nav shared by every `/admin/*` screen (plan §6.S3: "every entity
 * screen styled consistently"). A horizontal scroller on mobile, a sidebar
 * from `md` up — the same item list either way so nothing is admin-only on a
 * phone (Paraguay traffic is mobile-heavy, plan §6.S3).
 */
export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <nav
      aria-label="Secciones de administración"
      className="flex gap-1 overflow-x-auto pb-1 md:sticky md:top-24 md:flex-col md:overflow-visible md:pb-0"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-sm px-3 py-2 text-sm transition-colors md:whitespace-normal ${
            isActive(item.href)
              ? "bg-ink text-base font-medium"
              : "text-ink/70 hover:bg-ink/[0.06]"
          }`}
        >
          {item.label}
          {!!item.badge && (
            <span
              className={`ml-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                isActive(item.href) ? "bg-base/20 text-base" : "bg-accent/15 text-accent"
              }`}
            >
              {item.badge}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
