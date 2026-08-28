import { Link } from "@/i18n/navigation";
import { analyticsOverview, idleVehicles, trailingWindow } from "@/db/queries/analytics";
import { formatMoney } from "@/lib/money";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Business analytics (plan §5.O10, feature #12) — data layer + minimal page.
 * Sonnet designs the charts in §6.S3 with the `dataviz` skill; this screen
 * exists so every number is proven reachable before any of it is styled.
 */
const RANGES = [30, 90, 180, 365];

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
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Analítica</h1>
        <p className="text-sm text-neutral-600">
          Últimos {days} días ({window.startAt.toISOString().slice(0, 10)} →{" "}
          {window.endAt.toISOString().slice(0, 10)})
        </p>
        <p className="text-sm">
          {RANGES.map((range) => (
            <a
              key={range}
              href={`?dias=${range}`}
              className={`mr-3 underline ${range === days ? "font-semibold" : "text-blue-700"}`}
            >
              {range} días
            </a>
          ))}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="font-medium">Cartera</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>Publicaciones: {overview.portfolio.listings}</li>
          <li>Reservas que ocupan calendario: {overview.portfolio.bookings}</li>
          <li>Facturación: {formatMoney(overview.portfolio.revenue)}</li>
          <li>Comisión: {formatMoney(overview.portfolio.commission)}</li>
          <li>Gastos: {formatMoney(overview.portfolio.expenses)}</li>
          <li>Ocupación promedio: {pct(overview.portfolio.occupancyPct)}</li>
          <li>Ratio de gastos: {pct(overview.portfolio.expenseRatioPct)}</li>
        </ul>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="font-medium">Alojamientos</h2>
          <ul className="list-disc pl-5 text-sm">
            <li>Publicaciones: {overview.stays.listings}</li>
            <li>Ocupación: {pct(overview.stays.occupancyPct)}</li>
            <li>Facturación: {formatMoney(overview.stays.revenue)}</li>
          </ul>
        </div>
        <div>
          <h2 className="font-medium">Flota (#12)</h2>
          <ul className="list-disc pl-5 text-sm">
            <li>Vehículos: {overview.fleet.vehicles}</li>
            <li>Utilización: {pct(overview.fleet.occupancyPct)}</li>
            <li>Facturación: {formatMoney(overview.fleet.revenue)}</li>
            <li>Sin reservas en el período: {idle.length}</li>
          </ul>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Por publicación</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1">Publicación</th>
              <th>Ubicación</th>
              <th>Ocup.</th>
              <th>Reservas</th>
              <th>Facturación</th>
              <th>Gastos</th>
              <th>Ratio</th>
            </tr>
          </thead>
          <tbody>
            {overview.perListing.map((row) => (
              <tr key={row.listingId} className="border-b">
                <td className="py-1">
                  <Link
                    href={`/admin/publicaciones?id=${row.listingId}`}
                    className="text-blue-700 underline"
                  >
                    {row.title}
                  </Link>
                </td>
                <td>{row.locationName ?? "—"}</td>
                <td>{pct(row.occupancyPct)}</td>
                <td>{row.bookingCount}</td>
                <td>{formatMoney(row.revenue)}</td>
                <td>{formatMoney(row.expenses)}</td>
                <td>{pct(row.expenseRatioPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <div>
          <h2 className="font-medium">Top ubicaciones</h2>
          <ul className="list-disc pl-5 text-sm">
            {overview.topLocations.map((row) => (
              <li key={`${row.locationId}-${row.locationName}`}>
                {row.locationName}: {formatMoney(row.revenue)} ({row.bookings} reservas)
              </li>
            ))}
            {overview.topLocations.length === 0 && <li className="text-neutral-600">—</li>}
          </ul>
        </div>
        <div>
          <h2 className="font-medium">Origen de las reservas</h2>
          <ul className="list-disc pl-5 text-sm">
            {overview.sources.map((row) => (
              <li key={row.source}>
                {row.source}: {row.bookings} ({row.sharePct.toFixed(0)}%) —{" "}
                {formatMoney(row.revenue)}
              </li>
            ))}
            {overview.sources.length === 0 && <li className="text-neutral-600">—</li>}
          </ul>
        </div>
        <div>
          <h2 className="font-medium">Gastos por categoría</h2>
          <ul className="list-disc pl-5 text-sm">
            {overview.expenses.map((row) => (
              <li key={row.category}>
                {row.category}: {formatMoney(row.total)} ({row.sharePct.toFixed(0)}%)
              </li>
            ))}
            {overview.expenses.length === 0 && <li className="text-neutral-600">—</li>}
          </ul>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Estados de reserva</h2>
        <ul className="list-disc pl-5 text-sm">
          {overview.statuses.map((row) => (
            <li key={row.status}>
              {row.status}: {row.count}
            </li>
          ))}
        </ul>
      </section>

      {idle.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Vehículos sin reservas</h2>
          <ul className="list-disc pl-5 text-sm">
            {idle.map((row) => (
              <li key={row.listingId}>
                {row.title}
                {row.car ? ` — ${row.car.make ?? ""} ${row.car.model ?? ""} ${row.car.year ?? ""}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
