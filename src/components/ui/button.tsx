import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { Link } from "@/i18n/navigation";

const VARIANT = {
  primary: "bg-accent text-accent-ink hover:-translate-y-0.5 hover:shadow-raised",
  ghost: "bg-transparent text-ink border border-ink/20 hover:-translate-y-0.5 hover:shadow-card",
  wa: "bg-ink text-base hover:-translate-y-0.5 hover:shadow-raised",
} as const;

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-sm px-6 font-medium no-underline transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(.4,0,.2,1)]";

type Variant = keyof typeof VARIANT;

/** Internal navigation button. */
export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
  ...rest
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <Link href={href} className={`${base} ${VARIANT[variant]} ${className}`} {...rest}>
      {children}
    </Link>
  );
}

/** External / non-locale-aware link (wa.me, tel:, mailto:). */
export function ExternalButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
  ...rest
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
} & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} className={`${base} ${VARIANT[variant]} ${className}`} {...rest}>
      {children}
    </a>
  );
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: {
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`${base} ${VARIANT[variant]} ${className} disabled:opacity-50`} {...rest}>
      {children}
    </button>
  );
}
