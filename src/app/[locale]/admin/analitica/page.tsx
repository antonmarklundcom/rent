import { Link } from "@/i18n/navigation";
import { CATEGORICAL, STATUS_COLOR, BarList, StackedBar } from "@/components/ui/charts";
import { Meter, StatRow, StatTile } from "@/components/ui/stat-tile";
import { PageHeader, Section, TableWrap, table, th, td } from "@/components/ui/page-header";
import { analyticsOverview, idleVehicles, trailingWindow } from "@/db/queries/analytics";
import { formatMoney } from "@/lib/money";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Business analytics (plan §5.O10, feature #12), styled per the `dataviz`
 * skill: stat tiles for the headline numbers, meters for occupancy (a ratio
 * against 100%), horizontal bar lists / a stacked bar for the breakdowns —
 * `analyticsOverview` already computes every number; this page only chooses
 * a form and a color for each one.
 */
const RANGES = [30, 90, 180, 365];

const STATUS_LABEL: Record<string, string> = {
  inquiry: "Consulta",
  confirmed: "Confirmada",
  active: "En curso",
  completed: "Completada",
  cancelled: "Cancelada",
};

const STATUS_TONE: Record<string, string> = {
  inquiry: STATUS_COLOR.neutral,
  confirmed: STATUS_COLOR.warning,
  active: "#2a78d6",
  completed: STATUS_COLOR.good,
  cancelled: STATUS_COLOR.critical,
};

const CATEGORY_LABEL: Record<string, string> = {
  cleaning: "Limpieza",
  supplies: "Insumos",
  repair: "Reparación",
  fuel: "Combustible",
  other: "Otro",
};

const SOURCE_LABEL: Record<string, string> = {
  web: "Web",
  whatsapp: "WhatsApp",
  manual: "Manual",
};

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();
  const query = await searchParams;
  const raw = Array.isArray(query.dias) ? query.dias[0] : query.dias;
  const days = RANGES.includes(Number(raw)) ? Number(raw) : 90;
  const window = trailingWindow(days);

  const [overview, idle] = await Promise.all([
    analyticsOverview(window),
    idleVehicles(window),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analítica"
        subtitle={`${window.startAt.toISOString().slice(0, 10)} → ${window.endAt.toISOString().slice(0, 10)}`}
        actions={
          <div className="flex gap-1 rounded-md border border-ink/10 p-1">
            {RANGES.map((range) => (
              <a
                key={range}
                href={`?dias=${range}`}
                className={`rounded-sm px-3 py-1.5 text-sm ${
                  range === days ? "bg-ink text-base font-medium" : "text-ink/60 hover:bg-ink/[0.06]"
                }`}
              >
                {range}d
              </a>
            ))}
          </div>
        }
      />

      <Section title="Cartera">
        <StatRow>
          <StatTile label="Publicaciones" value={overview.portfolio.listings} />
          <StatTile label="Reservas" value={overview.portfolio.bookings} />
          <StatTile label="Facturación" value={formatMoney(overview.portfolio.revenue)} />
          <StatTile label="Comisión" value={formatMoney(overview.portfolio.commission)} />
          <StatTile label="Gastos" value={formatMoney(overview.portfolio.expenses)} />
        </StatRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <Meter label="Ocupación promedio" pct={overview.portfolio.occupancyPct} />
          <Meter
            label="Ratio de gastos sobre facturación"
            pct={overview.portfolio.expenseRatioPct}
            color={STATUS_COLOR.serious}
            track="#fbe4da"
          />
        </div>
      </Section>

      <div className="grid gap-6 2xl:grid-cols-2">
        <Section eyebrow="Vertical" title="Alojamientos">
          <StatRow>
            <StatTile label="Publicaciones" value={overview.stays.listings} />
            <StatTile label="Facturación" value={formatMoney(overview.stays.revenue)} />
          </StatRow>
          <Meter label="Ocupación" pct={overview.stays.occupancyPct} />
        </Section>
        <Section eyebrow="Vertical · #12" title="Flota">
          <StatRow>
            <StatTile label="Vehículos" value={overview.fleet.vehicles} />
            <StatTile label="Facturación" value={formatMoney(overview.fleet.revenue)} />
            <StatTile label="Sin reservas" value={idle.length} hint="en el período" />
          </StatRow>
          <Meter
            label="Utilización"
            pct={overview.fleet.occupancyPct}
            color={CATEGORICAL[2]}
            track="#c7ecdd"
          />
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Top ubicaciones" description="Por facturación en el período.">
          <BarList
            items={overview.topLocations.map((row) => ({
              label: row.locationName,
              value: Number(row.revenue),
              valueLabel: formatMoney(row.revenue),
            }))}
          />
        </Section>
        <Section title="Origen de las reservas">
          <BarList
            items={overview.sources.map((row, i) => ({
              label: `${SOURCE_LABEL[row.source] ?? row.source} (${row.sharePct.toFixed(0)}%)`,
              value: row.bookings,
              valueLabel: `${row.bookings} · ${formatMoney(row.revenue)}`,
              color: CATEGORICAL[i % CATEGORICAL.length],
            }))}
          />
        </Section>
        <Section title="Gastos por categoría">
          <StackedBar
            segments={overview.expenses.map((row, i) => ({
              label: CATEGORY_LABEL[row.category] ?? row.category,
              value: Number(row.total),
              valueLabel: formatMoney(row.total),
              color: CATEGORICAL[i % CATEGORICAL.length],
            }))}
          />
        </Section>
      </div>

      <Section title="Estados de reserva" description="Incluye consultas que nunca se confirmaron.">
        <StackedBar
          segments={overview.statuses.map((row) => ({
            label: STATUS_LABEL[row.status] ?? row.status,
            value: row.count,
            valueLabel: String(row.count),
            color: STATUS_TONE[row.status] ?? STATUS_COLOR.neutral,
          }))}
        />
      </Section>

      <Section title="Por publicación" description="Ocupación, facturación y gastos en el período.">
        <TableWrap>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Publicación</th>
                <th className={th}>Ubicación</th>
                <th className={th}>Ocup.</th>
                <th className={th}>Reservas</th>
                <th className={th}>Facturación</th>
                <th className={th}>Gastos</th>
                <th className={th}>Ratio</th>
              </tr>
            </thead>
            <tbody>
              {overview.perListing.map((row) => (
                <tr key={row.listingId}>
                  <td className={`${td} font-medium`}>
                    <Link
                      href={`/admin/publicaciones?id=${row.listingId}`}
                      className="text-accent hover:underline"
                    >
                      {row.title}
                    </Link>
                  </td>
                  <td className={td}>{row.locationName ?? "—"}</td>
                  <td className={`${td} w-32`}>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-ink/[0.08]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(0, Math.min(100, row.occupancyPct))}%`,
                            background: "#2a78d6",
                          }}
                        />
                      </div>
                      <span className="tabular-nums">{pct(row.occupancyPct)}</span>
                    </div>
                  </td>
                  <td className={`${td} tabular-nums`}>{row.bookingCount}</td>
                  <td className={`${td} tabular-nums`}>{formatMoney(row.revenue)}</td>
                  <td className={`${td} tabular-nums`}>{formatMoney(row.expenses)}</td>
                  <td className={`${td} tabular-nums`}>{pct(row.expenseRatioPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      {idle.length > 0 && (
        <Section title="Vehículos sin reservas" description="En el período seleccionado.">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {idle.map((row) => (
              <li key={row.listingId} className="rounded-md border border-ink/10 px-3 py-2 text-sm">
                {row.title}
                {row.car && (
                  <span className="block text-xs text-ink/50">
                    {row.car.make ?? ""} {row.car.model ?? ""} {row.car.year ?? ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
