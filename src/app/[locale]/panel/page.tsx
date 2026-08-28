import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { setListingStatusAction } from "@/app/actions/owner";
import { listBookingsForListings } from "@/db/queries/bookings";
import { defaultWindow, revenueByListing, totalsFrom } from "@/db/queries/analytics";
import { listListingsForUser, OWNER_SETTABLE_STATUSES } from "@/db/queries/listings";
import { getOnboarding } from "@/db/queries/onboarding";
import { listStatementsForOwner } from "@/db/queries/statements";
import { formatMoney } from "@/lib/money";
import { formatLocalDateTime } from "@/lib/messaging";
import { ownedListingIds } from "@/lib/scope";
import { requirePanelPage } from "@/lib/page-guards";

/**
 * Owner panel (plan §5.O10): earnings, upcoming bookings, own listings and the
 * onboarding checklist. Every query is scoped by `ownedListingIds` — an owner
 * physically cannot read another owner's rows, whatever the UI shows.
 */
export default async function PanelPage() {
  const user = await requirePanelPage();
  const t = await getTranslations("panel");
  const tStatus = await getTranslations("listingStatus");

  const listingIds = await ownedListingIds(user);
  const window = defaultWindow();
  const [rows, upcoming, revenue, onboarding, statements] = await Promise.all([
    listListingsForUser(user),
    listBookingsForListings(listingIds, {
      statuses: ["inquiry", "confirmed", "active"],
      from: new Date(),
      limit: 20,
    }),
    revenueByListing(window, { listingIds }),
    user.ownerId ? getOnboarding(user.ownerId) : Promise.resolve(null),
    user.ownerId ? listStatementsForOwner(user.ownerId) : Promise.resolve([]),
  ]);
  const totals = totalsFrom(revenue);

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p>{t("welcome", { name: user.name })}</p>
        <nav className="flex flex-wrap gap-3 text-sm">
          <Link href="/panel/publicaciones" className="text-blue-700 underline">
            publicaciones
          </Link>
          <Link href="/panel/calendario" className="text-blue-700 underline">
            calendario y bloqueos
          </Link>
          <Link href="/panel/informacion" className="text-blue-700 underline">
            base de información
          </Link>
          <Link href="/panel/estados" className="text-blue-700 underline">
            liquidaciones
          </Link>
        </nav>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">Ganancias — últimos 30 días</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>Bruto: {formatMoney(totals.gross, totals.currency)}</li>
          <li>Comisión: {formatMoney(totals.commission, totals.currency)}</li>
          <li>Gastos: {formatMoney(totals.expenses, totals.currency)}</li>
          <li>
            <strong>Neto: {formatMoney(totals.ownerNet, totals.currency)}</strong> ·{" "}
            {totals.bookingCount} reserva(s) terminada(s)
          </li>
        </ul>
        {revenue.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Publicación</th>
                <th>Reservas</th>
                <th>Bruto</th>
                <th>Comisión</th>
                <th>Gastos</th>
                <th>Neto</th>
              </tr>
            </thead>
            <tbody>
              {revenue.map((row) => (
                <tr key={row.listingId} className="border-b">
                  <td className="py-1">{row.title}</td>
                  <td>{row.bookingCount}</td>
                  <td>{formatMoney(row.gross, row.currency)}</td>
                  <td>{formatMoney(row.commission, row.currency)}</td>
                  <td>{formatMoney(row.expenses, row.currency)}</td>
                  <td>{formatMoney(row.ownerNet, row.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Próximas reservas ({upcoming.length})</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-neutral-500">No hay reservas próximas.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Código</th>
                <th>Publicación</th>
                <th>Huésped</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Estado</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map(({ booking, listingTitle }) => (
                <tr key={booking.id} className="border-b">
                  <td className="py-1">{booking.reference}</td>
                  <td>{listingTitle}</td>
                  <td>{booking.guestName}</td>
                  <td>{formatLocalDateTime(booking.startAt)}</td>
                  <td>{formatLocalDateTime(booking.endAt)}</td>
                  <td>{booking.status}</td>
                  <td>{formatMoney(booking.total, booking.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">{t("listings")}</h2>
        {rows.length === 0 ? (
          <p className="text-neutral-600">{t("noListings")}</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-neutral-200 align-top">
                  <td className="py-1">
                    <Link
                      href={`/panel/publicaciones/${row.id}`}
                      className="text-blue-700 underline"
                    >
                      {row.title}
                    </Link>
                  </td>
                  <td className="py-1">{row.vertical}</td>
                  <td className="py-1">{tStatus(row.status)}</td>
                  <td className="py-1">{formatMoney(row.price, row.currency)}</td>
                  <td className="py-1">
                    <ActionForm
                      action={setListingStatusAction}
                      submitLabel="Cambiar estado"
                      className="flex items-center gap-1"
                      submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <input type="hidden" name="listingId" value={row.id} />
                      <select
                        name="status"
                        defaultValue={row.status}
                        className="rounded border border-neutral-300 px-1 py-1 text-xs"
                      >
                        {OWNER_SETTABLE_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {tStatus(status)}
                          </option>
                        ))}
                      </select>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-neutral-500">
          Publicar una publicación lo hace un administrador después de revisarla.
        </p>
      </section>

      {onboarding && (
        <section className="space-y-1">
          <h2 className="font-medium">
            Puesta en marcha ({onboarding.doneCount}/{onboarding.totalCount})
          </h2>
          <ul className="space-y-0.5 text-sm">
            {onboarding.steps.map((step) => (
              <li key={step.id}>
                {step.status === "done" ? "✓" : step.status === "skipped" ? "–" : "○"}{" "}
                {step.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      {statements.length > 0 && (
        <section className="space-y-1">
          <h2 className="font-medium">Últimas liquidaciones</h2>
          <ul className="space-y-0.5 text-sm">
            {statements.slice(0, 3).map((statement) => (
              <li key={statement.id}>
                {statement.period} — neto {formatMoney(statement.netTotal, statement.currency)}{" "}
                <a href={`/api/estados/${statement.id}.html`} className="text-blue-700 underline">
                  ver
                </a>
              </li>
            ))}
          </ul>
          <Link href="/panel/estados" className="text-sm text-blue-700 underline">
            todas las liquidaciones
          </Link>
        </section>
      )}
    </section>
  );
}
