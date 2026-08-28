/**
 * Chart primitives for `/admin/analitica` (plan §6.S3 + the `dataviz` skill).
 * Plain HTML/CSS marks — no charting library needed for horizontal
 * bars/stacked bars at this data size. Colors are the skill's validated
 * default categorical/sequential/status hexes, used unchanged (no palette
 * substitution needed to stay brand-appropriate: they sit as data marks,
 * never as page chrome, so they don't compete with the warm ink/accent UI).
 */

/** Fixed categorical order — never cycled, never reassigned by a filter. */
export const CATEGORICAL = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#4a3aa7", // 6 violet
] as const;

export const SEQUENTIAL_FILL = "#2a78d6";
export const SEQUENTIAL_TRACK = "#cde2fb";

export const STATUS_COLOR = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
  neutral: "#898781",
} as const;

type BarItem = { label: string; value: number; valueLabel: string; color?: string };

/**
 * Horizontal bar list — magnitude compare, ranked. One hue (sequential) when
 * bars are the same series ranked by size; per-item `color` for identity
 * (categorical/status) comparisons. Value is a direct end-label (dataviz:
 * "bars → value at the tip"); no per-point clutter beyond that.
 */
export function BarList({
  items,
  emptyLabel = "—",
}: {
  items: BarItem[];
  emptyLabel?: string;
}) {
  if (items.length === 0) return <p className="text-sm text-ink/50">{emptyLabel}</p>;
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink/80">{item.label}</span>
            <span className="shrink-0 font-medium tabular-nums">{item.valueLabel}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink/[0.06]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, (item.value / max) * 100)}%`,
                background: item.color ?? SEQUENTIAL_FILL,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

type Segment = { label: string; value: number; valueLabel: string; color: string };

/**
 * Single horizontal stacked bar — part-to-whole. A 2px surface gap separates
 * every segment (dataviz: "the gap is the mechanism, never a stroke"), with a
 * legend underneath since every part-to-whole view here has ≥2 series.
 */
export function StackedBar({ segments, emptyLabel = "Sin datos" }: { segments: Segment[]; emptyLabel?: string }) {
  const total = segments.reduce((sum, seg) => sum + seg.value, 0);
  if (total <= 0) return <p className="text-sm text-ink/50">{emptyLabel}</p>;
  return (
    <div className="space-y-3">
      <div className="flex h-4 overflow-hidden rounded-full bg-ink/[0.06]" role="img" aria-label={segments.map((s) => `${s.label} ${s.valueLabel}`).join(", ")}>
        {segments.map((seg, i) => (
          <div
            key={seg.label}
            className="h-full"
            style={{
              width: `${(seg.value / total) * 100}%`,
              background: seg.color,
              marginLeft: i === 0 ? 0 : 2,
            }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: seg.color }} />
            <span className="text-ink/70">{seg.label}</span>
            <span className="font-medium tabular-nums">{seg.valueLabel}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
