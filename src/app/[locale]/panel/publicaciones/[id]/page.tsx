import { notFound, redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
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
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{row.listing.title}</h1>
        <p className="text-sm text-neutral-600">
          {row.listing.vertical} · {row.locationName ?? "sin ubicación"} · estado{" "}
          {row.listing.status}
        </p>
        <Link href="/panel" className="text-sm text-blue-700 underline">
          ← Volver al panel
        </Link>
      </header>

      <section className="space-y-2">
        <h2 className="font-medium">Datos de la publicación</h2>
        <ActionForm action={updateListingAction} submitLabel="Guardar">
          <input type="hidden" name="listingId" value={listingId} />
          <label className="flex flex-col text-sm">
            Título
            <input name="title" defaultValue={row.listing.title} className="border p-1" />
          </label>
          <label className="flex flex-col text-sm">
            Descripción
            <textarea
              name="description"
              rows={5}
              defaultValue={row.listing.description ?? ""}
              className="border p-1"
            />
          </label>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex flex-col">
              Precio ({row.listing.currency} / {row.listing.priceUnit})
              <input name="price" defaultValue={row.listing.price} className="border p-1" />
            </label>
            <label className="flex flex-col">
              Estado
              <select name="status" defaultValue={row.listing.status} className="border p-1">
                {LISTING_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              Política de cancelación
              <select
                name="cancellationPolicy"
                defaultValue={row.listing.cancellationPolicy}
                className="border p-1"
              >
                {CANCELLATION_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>
                    {policy}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            La comisión, el slug y la vertical las cambia un administrador.
          </p>
        </ActionForm>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Base de información</h2>
        <p className="text-sm text-neutral-600">
          Lo que cargues acá es lo único que el borrador automático puede responderle a un
          huésped. Si no está acá, no lo inventa: dice que lo consulta.
        </p>
        {info.length > 0 && (
          <ul className="space-y-2 text-sm">
            {info.map((item) => (
              <li key={item.id} className="border-b pb-2">
                <p className="font-medium">{item.question}</p>
                <p className="text-neutral-700">{item.answer}</p>
                <ActionForm
                  action={deleteInfoItemAction}
                  submitLabel="Eliminar"
                  className="inline"
                  submitClassName="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
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
          <label className="flex flex-col text-sm">
            Pregunta
            <input
              name="question"
              required
              placeholder="¿A qué hora es el check-in?"
              className="border p-1"
            />
          </label>
          <label className="flex flex-col text-sm">
            Respuesta
            <textarea name="answer" rows={3} required className="border p-1" />
          </label>
          <p className="text-xs text-neutral-500">
            Guardar la misma pregunta actualiza la respuesta.
          </p>
        </ActionForm>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Calendarios (#2)</h2>
        {row.listing.icalExportToken && (
          <div className="space-y-1">
            <p className="text-sm font-medium">Para exportar</p>
            <code className="block break-all text-xs">
              /api/ical/{row.listing.icalExportToken}.ics
            </code>
            <p className="text-xs text-neutral-500">
              Pegá esta URL en Airbnb o Booking para que vean tus fechas ocupadas.
            </p>
          </div>
        )}

        <p className="text-sm font-medium">Para importar</p>
        {icalSources.length === 0 ? (
          <p className="text-sm text-neutral-600">
            No hay calendarios externos conectados.
          </p>
        ) : (
          <ul className="text-sm">
            {icalSources.map((source) => (
              <li key={source.id} className="flex flex-wrap items-center gap-2 border-b py-1">
                <span className="break-all">
                  {source.label ?? "Sin nombre"} — {source.url}
                </span>
                <span className="text-xs text-neutral-500">
                  {source.lastSyncedAt
                    ? `última sincronización ${source.lastSyncedAt.toISOString().slice(0, 16)} (${source.lastStatus ?? "?"})`
                    : "todavía sin sincronizar"}
                </span>
                <ActionForm
                  action={deleteIcalSourceAction}
                  submitLabel="Desconectar"
                  className="inline"
                  submitClassName="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                >
                  <input type="hidden" name="sourceId" value={source.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={createIcalSourceAction} submitLabel="Conectar calendario">
          <input type="hidden" name="listingId" value={listingId} />
          <label className="flex flex-col text-sm">
            URL del calendario (Airbnb, Booking, Google)
            <input
              name="url"
              required
              placeholder="https://www.airbnb.com/calendar/ical/....ics"
              className="border p-1"
            />
          </label>
          <label className="flex flex-col text-sm">
            Nombre (opcional)
            <input name="label" placeholder="Airbnb" className="border p-1" />
          </label>
          <p className="text-xs text-neutral-500">
            Las fechas ocupadas se importan en la próxima sincronización horaria y
            bloquean el calendario acá.
          </p>
        </ActionForm>
      </section>
    </section>
  );
}
