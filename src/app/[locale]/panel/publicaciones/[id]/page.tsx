import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { ListingFields } from "@/components/listing-fields";
import { setListingStatusAction, updateListingAction } from "@/app/actions/owner";
import { saveInfoItemAction } from "@/app/actions/messages";
import {
  getListingDetail,
  listListingImages,
  listLocations,
  OWNER_SETTABLE_STATUSES,
} from "@/db/queries/listings";
import { listInfoItems } from "@/db/queries/info";
import { icalFeedUrl } from "@/lib/site-url";
import { assertCanAccessListing } from "@/lib/scope";
import { requirePanelPage } from "@/lib/page-guards";

/** Edit one listing (plan §5.O10). The scope check is the security boundary. */
export default async function PanelListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePanelPage();
  const { id } = await params;
  const listingId = Number(id);
  if (!Number.isSafeInteger(listingId) || listingId <= 0) notFound();
  // Somebody else's listing does not exist as far as this panel is concerned.
  // The mutating actions gate independently — this is navigation.
  const allowed = await assertCanAccessListing(user, listingId).then(
    () => true,
    () => false,
  );
  if (!allowed) notFound();

  const detail = await getListingDetail(listingId);
  if (!detail) notFound();

  const [locationRows, images, info] = await Promise.all([
    listLocations(),
    listListingImages(listingId),
    listInfoItems(listingId),
  ]);
  const statuses = user.role === "owner" ? OWNER_SETTABLE_STATUSES : (["draft", "published", "paused"] as const);

  return (
    <section className="space-y-8">
      <div>
        <Link href="/panel/publicaciones" className="text-sm text-blue-700 underline">
          ← Publicaciones
        </Link>
        <h1 className="text-2xl font-semibold">{detail.listing.title}</h1>
        <p className="text-sm text-neutral-600">
          {detail.listing.vertical} · {detail.listing.status} · /{detail.listing.slug}
        </p>
      </div>

      <ActionForm action={updateListingAction} submitLabel="Guardar cambios">
        <input type="hidden" name="listingId" value={listingId} />
        <ListingFields
          vertical={detail.listing.vertical}
          listing={detail.listing}
          stay={detail.stay}
          car={detail.car}
          locationRows={locationRows}
        />
      </ActionForm>

      <section className="space-y-2">
        <h2 className="font-medium">Estado</h2>
        <ActionForm
          action={setListingStatusAction}
          submitLabel="Cambiar estado"
          className="flex items-end gap-2"
          submitClassName="rounded border border-neutral-400 px-3 py-1 text-sm disabled:opacity-50"
        >
          <input type="hidden" name="listingId" value={listingId} />
          <select
            name="status"
            defaultValue={detail.listing.status}
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </ActionForm>
        {user.role === "owner" && (
          <p className="text-xs text-neutral-500">
            Publicar lo hace un administrador después de revisar la publicación.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Base de información ({info.length})</h2>
        <p className="text-xs text-neutral-500">
          Es lo que responde el borrador con IA en el panel de mensajes. Cuanto más completo,
          mejor responde — y nunca inventa nada que no esté acá.
        </p>
        <ul className="space-y-1 text-sm">
          {info.map((item) => (
            <li key={item.id}>
              <strong>{item.question}</strong> — {item.answer}
            </li>
          ))}
        </ul>
        <ActionForm action={saveInfoItemAction} submitLabel="Guardar respuesta">
          <input type="hidden" name="listingId" value={listingId} />
          <label className="block space-y-1 text-sm">
            <span>Pregunta</span>
            <input
              name="question"
              required
              placeholder="¿Hay estacionamiento?"
              className="w-full rounded border border-neutral-300 px-2 py-1"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Respuesta</span>
            <textarea
              name="answer"
              rows={2}
              required
              className="w-full rounded border border-neutral-300 px-2 py-1"
            />
          </label>
        </ActionForm>
      </section>

      <section className="space-y-1 text-sm">
        <h2 className="font-medium">Fotos ({images.length})</h2>
        {images.length === 0 ? (
          <p className="text-neutral-500">Sin fotos cargadas todavía.</p>
        ) : (
          <ul className="space-y-0.5 text-neutral-700">
            {images.map((image) => (
              <li key={image.id}>
                {image.isCover ? "portada · " : ""}
                {image.url}
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.listing.icalExportToken && (
        <section className="space-y-1 text-sm">
          <h2 className="font-medium">Calendario para exportar (#2)</h2>
          <code className="block break-all text-xs text-neutral-600">
            {icalFeedUrl(detail.listing.icalExportToken)}
          </code>
          <p className="text-xs text-neutral-500">
            Pegá este enlace en Airbnb o Booking para que bloqueen tus fechas ocupadas.
          </p>
        </section>
      )}
    </section>
  );
}
