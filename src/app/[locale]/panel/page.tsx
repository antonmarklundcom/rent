import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createBlockAction, deleteBlockAction } from "@/app/actions/bookings";
import { Badge, listingStatusTone, onboardingStepTone } from "@/components/ui/badge";
import { PageHeader, Section, TableWrap, EmptyState, table, th, td } from "@/components/ui/page-header";
import { PanelCalendar } from "@/components/ui/panel-calendar";
import { StatRow, StatTile } from "@/components/ui/stat-tile";
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
    <div className="space-y-8">
      <PageHeader title={t("title")} subtitle={t("welcome", { name: user.name })} />

      {onboarding && onboarding.doneCount < onboarding.totalCount && (
        <Section
          eyebrow="Onboarding"
          title={`${onboarding.doneCount} de ${onboarding.totalCount} pasos completos`}
        >
          <div className="h-2 w-full overflow-hidden rounded-full bg-ink/[0.08]">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${(onboarding.doneCount / Math.max(1, onboarding.totalCount)) * 100}%` }}
            />
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {onboarding.steps.map((step) => (
              <li key={step.id} className="flex items-center gap-2 text-sm">
                <Badge tone={onboardingStepTone(step.status)}>
                  {step.status === "done" ? "✔" : step.status === "skipped" ? "—" : "○"}
                </Badge>
                <span className={step.status === "done" ? "text-ink/60 line-through" : ""}>
                  {step.label}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section eyebrow="Este año" title="Ganancias">
        <StatRow>
          <StatTile label="Bruto" value={formatMoney(earnings.gross)} hint="Reservas completadas" />
          <StatTile label="Comisión" value={`− ${formatMoney(earnings.commission)}`} />
          <StatTile label="Gastos" value={`− ${formatMoney(earnings.expenses)}`} />
          <StatTile label="Neto estimado" value={formatMoney(earnings.net)} />
          <StatTile label="Por cobrar" value={formatMoney(earnings.pipeline)} hint="Reservas en curso" />
        </StatRow>
        <p className="text-xs text-ink/50">
          El estado mensual es el documento oficial; esto es la vista en curso.
        </p>
      </Section>

      <Section title={t("listings")}>
        {listings.length === 0 ? (
          <EmptyState>{t("noListings")}</EmptyState>
        ) : (
          <TableWrap>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Título</th>
                  <th className={th}>Vertical</th>
                  <th className={th}>{t("status")}</th>
                  <th className={th}>Precio</th>
                  <th className={th}>Fotos</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {listings.map((row) => (
                  <tr key={row.id}>
                    <td className={`${td} font-medium`}>{row.title}</td>
                    <td className={td}>{row.vertical === "stay" ? "Alojamiento" : "Auto"}</td>
                    <td className={td}>
                      <Badge tone={listingStatusTone(row.status)}>{tStatus(row.status)}</Badge>
                    </td>
                    <td className={`${td} tabular-nums`}>{formatMoney(row.price, row.currency)}</td>
                    <td className={td}>{row.imageCount}</td>
                    <td className={td}>
                      <Link href={`/panel/publicaciones/${row.id}`} className="font-medium text-accent hover:underline">
                        Editar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Próximas reservas">
        {upcoming.length === 0 ? (
          <EmptyState>No hay reservas próximas.</EmptyState>
        ) : (
          <ul className="divide-y divide-ink/8 text-sm">
            {upcoming.map(({ booking, listingTitle }) => (
              <li key={booking.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{booking.reference}</span> · {listingTitle} ·{" "}
                  {booking.guestName}
                  <span className="block text-xs text-ink/50 sm:inline sm:before:content-['_·_']">
                    {booking.startAt.toISOString().slice(0, 10)} →{" "}
                    {booking.endAt.toISOString().slice(0, 10)}
                  </span>
                </span>
                <span className="flex items-center gap-2 tabular-nums">
                  {formatMoney(booking.total, booking.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Calendario" description="Próximos 120 días — reservas y bloqueos por publicación.">
        {calendar.length === 0 ? (
          <EmptyState>Sin ocupación cargada.</EmptyState>
        ) : (
          <PanelCalendar entries={calendar} window={window} />
        )}
      </Section>

      <Section title="Bloquear fechas (#15)" description="Reservá tus propias fechas o bloqueá por mantenimiento.">
        <BlockDatesForm
          listings={listings.map((row) => ({ id: row.id, title: row.title }))}
          action={createBlockAction}
        />
        {blocks.length > 0 && (
          <ul className="divide-y divide-ink/8 text-sm">
            {blocks.map(({ block, listingTitle }) => (
              <li key={block.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{listingTitle}</span>:{" "}
                  {block.startAt.toISOString().slice(0, 10)} → {block.endAt.toISOString().slice(0, 10)}{" "}
                  <span className="text-ink/50">
                    ({block.reason === "owner_use" ? "uso propio" : block.reason === "maintenance" ? "mantenimiento" : "iCal"})
                  </span>
                </span>
                {block.reason !== "external_ical" && (
                  <DeleteBlockButton blockId={block.id} action={deleteBlockAction} />
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink/50">
          Los bloqueos importados por iCal se administran desde el calendario externo.
        </p>
      </Section>

      <Section title="Estados de cuenta">
        {statements.length === 0 ? (
          <EmptyState>Todavía no hay estados generados.</EmptyState>
        ) : (
          <ul className="divide-y divide-ink/8 text-sm">
            {statements.map((statement) => (
              <li key={statement.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{statement.period}</span> — neto{" "}
                  {formatMoney(statement.netTotal, statement.currency)}
                </span>
                <a
                  className="font-medium text-accent hover:underline"
                  href={`/api/estados/${statement.id}.html`}
                  target="_blank"
                  rel="noopener"
                >
                  Ver estado →
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
