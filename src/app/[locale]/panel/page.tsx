import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createBlockAction, deleteBlockAction } from "@/app/actions/bookings";
import { getOnboardingProgress } from "@/db/queries/onboarding";
import {
  listPanelListings,
  panelBlocks,
  panelCalendar,
  panelEarnings,
  panelStatements,
  upcomingBookings,
} from "@/db/queries/panel";
import { MS_PER_DAY } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getSessionUser } from "@/lib/session";
import { BlockDatesForm, DeleteBlockButton } from "./block-forms";

/**
 * Owner panel (plan §5.O10): calendar, upcoming bookings, earnings, own
 * listings, blocked dates (#15), statements and the onboarding checklist (#19).
 *
 * Every query is owner-scoped in `src/db/queries/panel.ts` — this page never
 * filters by owner itself, because a page-level filter is a bug waiting to be
 * forgotten on the next screen.
 */
export default async function PanelPage() {
  const user = await getSessionUser();
  if (!user) redirect("/ingresar");
  if (user.role === "cleaner") redirect("/");

  const t = await getTranslations("panel");
  const tStatus = await getTranslations("listingStatus");

  const now = new Date();
  const window = { startAt: now, endAt: new Date(now.getTime() + 120 * MS_PER_DAY) };
  const yearWindow = {
    startAt: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
    endAt: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)),
  };

  const [listings, calendar, upcoming, earnings, blocks, statements] = await Promise.all([
    listPanelListings(user),
    panelCalendar(user, window),
    upcomingBookings(user),
    panelEarnings(user, yearWindow),
    panelBlocks(user),
    panelStatements(user),
  ]);
  const onboarding = user.ownerId ? await getOnboardingProgress(user.ownerId) : null;

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p>{t("welcome", { name: user.name })}</p>
      </header>

      {onboarding && (
        <section className="space-y-1">
          <h2 className="font-medium">
            Onboarding — {onboarding.doneCount}/{onboarding.totalCount}
          </h2>
          <ul className="list-disc pl-5 text-sm">
            {onboarding.steps.map((step) => (
              <li key={step.id}>
                {step.status === "done" ? "✔" : step.status === "skipped" ? "—" : "○"}{" "}
                {step.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">Ganancias del año</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>Bruto (reservas completadas): {formatMoney(earnings.gross)}</li>
          <li>Comisión: {formatMoney(earnings.commission)}</li>
          <li>Gastos: {formatMoney(earnings.expenses)}</li>
          <li>
            <strong>Neto estimado: {formatMoney(earnings.net)}</strong>
          </li>
          <li>Por cobrar (reservas en curso): {formatMoney(earnings.pipeline)}</li>
        </ul>
        <p className="text-xs text-neutral-500">
          El estado mensual es el documento oficial; esto es la vista en curso.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">{t("listings")}</h2>
        {listings.length === 0 ? (
          <p className="text-neutral-600">{t("noListings")}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-1">Título</th>
                <th>Vertical</th>
                <th>{t("status")}</th>
                <th>Precio</th>
                <th>Fotos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listings.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="py-1">{row.title}</td>
                  <td>{row.vertical}</td>
                  <td>{tStatus(row.status)}</td>
                  <td>{formatMoney(row.price, row.currency)}</td>
                  <td>{row.imageCount}</td>
                  <td>
                    <Link
                      href={`/panel/publicaciones/${row.id}`}
                      className="text-blue-700 underline"
                    >
                      Editar
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Próximas reservas</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-neutral-600">No hay reservas próximas.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {upcoming.map(({ booking, listingTitle }) => (
              <li key={booking.id}>
                {booking.reference} · {listingTitle} · {booking.guestName} ·{" "}
                {booking.startAt.toISOString().slice(0, 10)} →{" "}
                {booking.endAt.toISOString().slice(0, 10)} · {booking.status} ·{" "}
                {formatMoney(booking.total, booking.currency)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Calendario (120 días)</h2>
        {calendar.length === 0 ? (
          <p className="text-sm text-neutral-600">Sin ocupación cargada.</p>
        ) : (
          <ul className="text-sm">
            {calendar.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className="border-b py-1">
                {entry.startAt.toISOString().slice(0, 10)} →{" "}
                {entry.endAt.toISOString().slice(0, 10)} · {entry.listingTitle} ·{" "}
                {entry.kind === "booking" ? "Reserva" : "Bloqueo"} — {entry.label} (
                {entry.status})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Bloquear fechas (#15)</h2>
        <BlockDatesForm
          listings={listings.map((row) => ({ id: row.id, title: row.title }))}
          action={createBlockAction}
        />
        {blocks.length > 0 && (
          <ul className="text-sm">
            {blocks.map(({ block, listingTitle }) => (
              <li key={block.id} className="flex items-center gap-2 border-b py-1">
                <span>
                  {listingTitle}: {block.startAt.toISOString().slice(0, 10)} →{" "}
                  {block.endAt.toISOString().slice(0, 10)} ({block.reason})
                </span>
                {block.reason !== "external_ical" && (
                  <DeleteBlockButton blockId={block.id} action={deleteBlockAction} />
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-neutral-500">
          Los bloqueos importados por iCal se administran desde el calendario externo.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Estados de cuenta</h2>
        {statements.length === 0 ? (
          <p className="text-sm text-neutral-600">Todavía no hay estados generados.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {statements.map((statement) => (
              <li key={statement.id}>
                {statement.period} — neto {formatMoney(statement.netTotal, statement.currency)}{" "}
                <a
                  className="text-blue-700 underline"
                  href={`/api/estados/${statement.id}.html`}
                >
                  ver
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
