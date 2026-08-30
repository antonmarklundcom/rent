import { notFound, redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, listingStatusTone } from "@/components/ui/badge";
import { fieldClass, labelClass } from "@/components/ui/field";
import { EmptyState, PageHeader, Section } from "@/components/ui/page-header";
import { deleteInfoItemAction, saveInfoItemAction } from "@/app/actions/comms";
import {
  createIcalSourceAction,
  deleteIcalSourceAction,
  updateListingAction,
} from "@/app/actions/panel";
import { listIcalSources } from "@/db/queries/blocks";
import { getPanelListing } from "@/db/queries/panel";
import { listInfoItems } from "@/db/queries/messages";
import { CANCELLATION_POLICIES, LISTING_STATUSES } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

const CANCELLATION_LABEL: Record<string, string> = {
  flexible: "Flexible",
  moderate: "Moderada",
  strict: "Estricta",
};

/**
 * Owner listing editor + info base (plan §5.O10).
 *
 * The info base is what the AI draft is grounded in (§5.O9), so it lives where
 * the person who knows the answers already is. Commission, slug and vertical
 * are not editable here — see `updatePanelListing` for why.
 */
export default async function PanelListingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/ingresar");
  if (user.role === "cleaner") redirect("/");

  const listingId = Number(id);
  if (!Number.isInteger(listingId) || listingId <= 0) notFound();

  const row = await getPanelListing(user, listingId);
  if (!row) notFound();
  const [info, icalSources] = await Promise.all([
    listInfoItems(listingId),
    listIcalSources({ listingId }),
  ]);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href="/panel" className="text-sm text-ink/55 hover:text-accent">
          ← Volver al panel
        </Link>
        <PageHeader
          title={row.listing.title}
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              {row.listing.vertical === "stay" ? "Alojamiento" : "Auto"} ·{" "}
              {row.locationName ?? "sin ubicación"}
              <Badge tone={listingStatusTone(row.listing.status)}>{row.listing.status}</Badge>
            </span>
          }
        />
      </div>

      <Section title="Datos de la publicación">
        <ActionForm action={updateListingAction} submitLabel="Guardar">
          <input type="hidden" name="listingId" value={listingId} />
          <label className={labelClass}>
            <span className="text-ink/70">Título</span>
            <input name="title" defaultValue={row.listing.title} className={fieldClass} />
          </label>
          <label className={labelClass}>
            <span className="text-ink/70">Descripción</span>
            <textarea
              name="description"
              rows={5}
              defaultValue={row.listing.description ?? ""}
              className={fieldClass}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              <span className="text-ink/70">
                Precio ({row.listing.currency} / {row.listing.priceUnit})
              </span>
              <input name="price" defaultValue={row.listing.price} className={fieldClass} />
            </label>
            <label className={labelClass}>
              <span className="text-ink/70">Estado</span>
              <select name="status" defaultValue={row.listing.status} className={fieldClass}>
                {LISTING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className="text-ink/70">Política de cancelación</span>
              <select
                name="cancellationPolicy"
                defaultValue={row.listing.cancellationPolicy}
                className={fieldClass}
              >
                {CANCELLATION_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>
                    {CANCELLATION_LABEL[policy] ?? policy}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-ink/50">
            La comisión, el slug y la vertical las cambia un administrador.
          </p>
        </ActionForm>
      </Section>

      <Section
        title="Base de información"
        description="Lo que cargues acá es lo único que el borrador automático puede responderle a un huésped. Si no está acá, no lo inventa: dice que lo consulta."
      >
        {info.length > 0 && (
          <ul className="divide-y divide-ink/8 text-sm">
            {info.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{item.question}</p>
                  <p className="text-ink/70">{item.answer}</p>
                </div>
                <ActionForm
                  action={deleteInfoItemAction}
                  submitLabel="Eliminar"
                  className="shrink-0"
                  submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                >
                  <input type="hidden" name="listingId" value={listingId} />
                  <input type="hidden" name="infoItemId" value={item.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={saveInfoItemAction} submitLabel="Guardar ítem">
          <input type="hidden" name="listingId" value={listingId} />
          <label className={labelClass}>
            <span className="text-ink/70">Pregunta</span>
            <input
              name="question"
              required
              placeholder="¿A qué hora es el check-in?"
              className={fieldClass}
            />
          </label>
          <label className={labelClass}>
            <span className="text-ink/70">Respuesta</span>
            <textarea name="answer" rows={3} required className={fieldClass} />
          </label>
          <p className="text-xs text-ink/50">Guardar la misma pregunta actualiza la respuesta.</p>
        </ActionForm>
      </Section>

      <Section title="Calendarios (#2)">
        {row.listing.icalExportToken && (
          <div className="space-y-1 rounded-md border border-ink/10 bg-ink/[0.02] p-3">
            <p className="text-sm font-medium">Para exportar</p>
            <code className="block break-all text-xs text-ink/70">
              /api/ical/{row.listing.icalExportToken}.ics
            </code>
            <p className="text-xs text-ink/50">
              Pegá esta URL en Airbnb o Booking para que vean tus fechas ocupadas.
            </p>
          </div>
        )}

        <p className="text-sm font-medium">Para importar</p>
        {icalSources.length === 0 ? (
          <EmptyState>No hay calendarios externos conectados.</EmptyState>
        ) : (
          <ul className="divide-y divide-ink/8 text-sm">
            {icalSources.map((source) => (
              <li key={source.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{source.label ?? "Sin nombre"}</span>
                  <span className="block break-all text-xs text-ink/50">{source.url}</span>
                  <span className="block text-xs text-ink/50">
                    {source.lastSyncedAt
                      ? `última sincronización ${source.lastSyncedAt.toISOString().slice(0, 16)} (${source.lastStatus ?? "?"})`
                      : "todavía sin sincronizar"}
                  </span>
                </span>
                <ActionForm
                  action={deleteIcalSourceAction}
                  submitLabel="Desconectar"
                  className="shrink-0"
                  submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                >
                  <input type="hidden" name="sourceId" value={source.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={createIcalSourceAction} submitLabel="Conectar calendario">
          <input type="hidden" name="listingId" value={listingId} />
          <label className={labelClass}>
            <span className="text-ink/70">URL del calendario (Airbnb, Booking, Google)</span>
            <input
              name="url"
              required
              placeholder="https://www.airbnb.com/calendar/ical/....ics"
              className={fieldClass}
            />
          </label>
          <label className={labelClass}>
            <span className="text-ink/70">Nombre (opcional)</span>
            <input name="label" placeholder="Airbnb" className={fieldClass} />
          </label>
          <p className="text-xs text-ink/50">
            Las fechas ocupadas se importan en la próxima sincronización horaria y bloquean el
            calendario acá.
          </p>
        </ActionForm>
      </Section>
    </div>
  );
}
