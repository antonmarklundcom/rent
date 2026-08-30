/**
 * Shared form-control classes so every admin/panel/cleaner input matches the
 * public site's field style (`card--raised card--hair` forms, `rounded-sm
 * border-ink/15`) instead of the O-3/O-4 bare `border p-1` placeholders.
 */
export const fieldClass =
  "w-full rounded-sm border border-ink/15 bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none";

export const labelClass = "block space-y-1 text-sm";

export const legendClass = "text-xs font-medium uppercase tracking-wide text-ink/50";

export function Field({
  label,
  children,
  className = "",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`${labelClass} ${className}`}>
      <span className="text-ink/70">{label}</span>
      {children}
    </label>
  );
}
