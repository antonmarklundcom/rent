/**
 * KPI tiles for the admin/panel dashboards (dataviz skill: "a handful of
 * headline numbers" → a KPI row of stat tiles, not a chart). Value stays in
 * the page's proportional sans; only table/axis figures get tabular-nums.
 */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-md border border-ink/10 bg-surface p-4">
      <p className="truncate text-xs font-medium uppercase tracking-wide text-ink/50">{label}</p>
      <p className="mt-1 break-words font-display text-xl italic leading-tight sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-ink/55">{hint}</p>}
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{children}</div>;
}

/** A ratio against a limit (e.g. occupancy %) — track is a lighter step of the same hue. */
export function Meter({
  label,
  pct,
  valueLabel,
  color = "#2a78d6",
  track = "#cde2fb",
}: {
  label: string;
  pct: number | null;
  valueLabel?: string;
  color?: string;
  track?: string;
}) {
  const clamped = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink/70">{label}</span>
        <span className="font-medium tabular-nums">{valueLabel ?? (pct === null ? "—" : `${pct.toFixed(1)}%`)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full" style={{ background: track }}>
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${clamped}%`, background: color }}
        />
      </div>
    </div>
  );
}
