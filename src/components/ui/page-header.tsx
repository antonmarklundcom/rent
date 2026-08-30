export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="font-display text-3xl italic tracking-tight md:text-4xl">{title}</h1>
        {subtitle && <div className="text-sm text-ink/60">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  eyebrow,
  description,
  actions,
  children,
  className = "",
}: {
  title?: string;
  eyebrow?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card--raised card--hair space-y-4 rounded-lg p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            {title && <h2 className="text-lg font-medium">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-ink/60">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {!title && description && <p className="text-sm text-ink/60">{description}</p>}
      {children}
    </section>
  );
}

/** Wide tables scroll inside their own container, never the page (mobile). */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="-mx-1 overflow-x-auto px-1">{children}</div>;
}

export const th = "border-b border-ink/10 py-2 pr-3 text-left font-medium text-ink/60";
export const td = "border-b border-ink/8 py-2.5 pr-3 align-top";
export const table = "w-full min-w-[36rem] text-left text-sm";

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-ink/15 bg-ink/[0.02] p-4 text-sm text-ink/55">
      {children}
    </p>
  );
}
