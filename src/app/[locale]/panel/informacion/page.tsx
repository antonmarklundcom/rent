import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { deleteInfoItemAction, saveInfoItemAction } from "@/app/actions/messages";
import { listInfoItems } from "@/db/queries/info";
import { listListingsForUser } from "@/db/queries/listings";
import { requirePanelPage, resolvePanelListingId } from "@/lib/page-guards";

/**
 * Info-base editor (plan §5.O10).
 *
 * These answers are the ONLY thing the AI draft is allowed to say (§5.O9), so
 * this page is where an owner decides what the assistant knows.
 */
export default async function PanelInfoPage({
  searchParams,
}: {
  searchParams: Promise<{ publicacion?: string }>;
}) {
  const user = await requirePanelPage();
  const { publicacion } = await searchParams;
  const listings = await listListingsForUser(user);
  // Same as the calendar: the query parameter is resolved against ownership.
  const selectedId = await resolvePanelListingId(user, publicacion, listings);
  const items = selectedId ? await listInfoItems(selectedId) : [];

  return (
    <section className="space-y-6">
      <div>
        <Link href="/panel" className="text-sm text-blue-700 underline">
          ← Panel
        </Link>
        <h1 className="text-2xl font-semibold">Base de información</h1>
        <p className="text-sm text-neutral-600">
          Preguntas frecuentes con su respuesta. El equipo las usa para contestar y el
          borrador con IA no puede decir nada que no esté acá.
        </p>
      </div>

      <form className="flex items-end gap-2 text-sm">
        <label className="space-y-1">
          <span className="block">Publicación</span>
          <select
            name="publicacion"
            defaultValue={selectedId ?? ""}
            className="rounded border border-neutral-300 px-2 py-1"
          >
            {listings.map((listing) => (
              <option key={listing.id} value={listing.id}>
                {listing.title}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded border border-neutral-400 px-3 py-1">
          Ver
        </button>
      </form>

      {!selectedId ? (
        <p className="text-sm text-neutral-500">Todavía no tenés publicaciones.</p>
      ) : (
        <>
          <ul className="space-y-2 text-sm">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-2 border-b border-neutral-200 pb-2">
                <span className="grow">
                  <strong>{item.question}</strong>
                  <span className="block text-neutral-700">{item.answer}</span>
                </span>
                <ActionForm
                  action={deleteInfoItemAction}
                  submitLabel="Borrar"
                  className="inline"
                  submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                >
                  <input type="hidden" name="infoItemId" value={item.id} />
                </ActionForm>
              </li>
            ))}
            {items.length === 0 && (
              <li className="text-neutral-500">
                Sin respuestas cargadas. Con menos de dos, el borrador con IA no se genera.
              </li>
            )}
          </ul>

          <ActionForm action={saveInfoItemAction} submitLabel="Guardar respuesta">
            <input type="hidden" name="listingId" value={selectedId} />
            <label className="block space-y-1 text-sm">
              <span>Pregunta</span>
              <input
                name="question"
                required
                placeholder="¿Se permiten mascotas?"
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Respuesta</span>
              <textarea
                name="answer"
                rows={3}
                required
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Orden</span>
              <input
                type="number"
                name="sortOrder"
                defaultValue={items.length}
                min={0}
                className="w-24 rounded border border-neutral-300 px-2 py-1"
              />
            </label>
          </ActionForm>
        </>
      )}
    </section>
  );
}
