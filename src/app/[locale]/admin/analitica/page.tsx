import { analyticsDashboard, defaultWindow, fleetSize } from "@/db/queries/analytics";
import { formatMoney } from "@/lib/money";
import { formatLocalDate } from "@/lib/messaging";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Business analytics (#12 — plan §5.O10): occupancy, revenue per listing,
 * fleet utilisation, top locations, booking sources, expense ratio.
 *
 * Numbers only — Sonnet turns these into charts in phase S-2 with the `dataviz`
 * skill (plan §6.S3). The point of this page is that the queries behind it are
 * right, and that they are the same ones the owner panel uses scoped down.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  await requireAdminPage();
  const { dias } = await searchParams;
  const days = Math.min(365, Math.max(7, Number(dias) || 30));
  const window = defaultWindow(new Date(), days);

  const [data, fleet] = await Promise.all([
    analyticsDashboard(window),
    fleetSize(),
  ]);

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Analítica</h1>
        <p className="text-sm text-neutral-600">
          {formatLocalDate(window.startAt)} → {formatLocalDate(window.endAt)} ({days} días)
        </p>
        <form className="mt-2 flex items-end gap-2 text-sm">
          <label className="space-y-1">
            <span className="block">Ventana (días)</span>
            <input
              type="number"
              name="dias"
              min={7}
              max={365}
              defaultValue={days}
              className="w-24 rounded border border-neutral-300 px-2 py-1"
            />
          </label>
          <button type="submit" className="rounded border border-neutral-400 px-3 py-1">
            Aplicar
          </button>
        </form>
      </div>

      <section className="space-y-1">
        <h2 className="font-medium">Resumen</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>Ocupación media: {data.occupancy.averagePct}%</li>
          <li>
            Flota: {data.fleet.utilisationPct}% de utilización ({data.fleet.rentedDays} de{" "}
            {data.fleet.availableDays} días · {fleet} vehículo(s) cargado(s))
          </li>
          <li>Bruto: {formatMoney(data.totals.gross, data.totals.currency)}</li>
          <li>Comisión: {formatMoney(data.totals.commission, data.totals.currency)}</li>
          <li>
            Gastos: {formatMoney(data.totals.expenses, data.totals.currency)} —{" "}
            {data.totals.expenseRatioPct}% del bruto
          </li>
          <li>Neto para propietarios: {formatMoney(data.totals.ownerNet, data.totals.currency)}</li>
          <li>{data.totals.bookingCount} reserva(s) terminada(s) en la ventana</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Ocupación por publicación</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Publicación</th>
              <th>Vertical</th>
              <th>Días ocupados</th>
              <th>Ocupación</th>
            </tr>
          </thead>
          <tbody>
            {data.occupancy.rows.map((row) => (
              <tr key={row.listingId} className="border-b">
                <td className="py-1">{row.title}</td>
                <td>{row.vertical}</td>
                <td>
                  {row.occupiedDays} / {row.windowDays}
                </td>
                <td>{row.occupancyPct}%</td>
              </tr>
            ))}
            {data.occupancy.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-1 text-neutral-500">
                  No hay publicaciones publicadas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Ingresos por publicación</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Publicación</th>
              <th>Reservas</th>
              <th>Bruto</th>
              <th>Comisión</th>
              <th>Gastos</th>
              <th>% gastos</th>
              <th>Neto propietario</th>
            </tr>
          </thead>
          <tbody>
            {data.revenue.map((row) => (
              <tr key={row.listingId} className="border-b">
                <td className="py-1">{row.title}</td>
                <td>{row.bookingCount}</td>
                <td>{formatMoney(row.gross, row.currency)}</td>
                <td>{formatMoney(row.commission, row.currency)}</td>
                <td>{formatMoney(row.expenses, row.currency)}</td>
                <td>{row.expenseRatioPct}%</td>
                <td>{formatMoney(row.ownerNet, row.currency)}</td>
              </tr>
            ))}
            {data.revenue.length === 0 && (
              <tr>
                <td colSpan={7} className="py-1 text-neutral-500">
                  Sin reservas terminadas ni gastos en la ventana.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Zonas con más reservas</h2>
        <ul className="space-y-0.5 text-sm">
          {data.locations.map((location) => (
            <li key={location.locationId ?? location.name}>
              {location.parentName ? `${location.parentName} · ` : ""}
              {location.name} — {location.bookingCount} reserva(s) ·{" "}
              {location.listingCount} publicación(es)
            </li>
          ))}
          {data.locations.length === 0 && (
            <li className="text-neutral-500">Sin datos de ubicación.</li>
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Origen de las reservas</h2>
        <ul className="space-y-0.5 text-sm">
          {data.sources.map((source) => (
            <li key={source.source}>
              {source.source}: {source.bookingCount} reserva(s) ·{" "}
              {formatMoney(source.gross, data.totals.currency)}
            </li>
          ))}
          {data.sources.length === 0 && (
            <li className="text-neutral-500">Sin reservas creadas en la ventana.</li>
          )}
        </ul>
      </section>
    </section>
  );
}
