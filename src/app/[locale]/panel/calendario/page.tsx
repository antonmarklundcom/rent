import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { blockDatesAction, unblockDatesAction } from "@/app/actions/panel";
import { listOccupiedRanges } from "@/db/queries/availability";
import { listBlocksForListing } from "@/db/queries/blocks";
import { listListingsForUser } from "@/db/queries/listings";
import { addDays, startOfUtcDay } from "@/lib/dates";
import { formatLocalDateTime } from "@/lib/messaging";
import { requirePanelPage, resolvePanelListingId } from "@/lib/page-guards";

/**
 * Owner calendar + blocked dates (#15, plan §5.O10).
 *
 * A block behaves exactly like a booking in availability because both go
 * through the same overlap function (`src/db/queries/availability.ts`) — so
 * blocking a date really does stop the public site from selling it.
 */
export default async function PanelCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ publicacion?: string }>;
}) {
  const user = await requirePanelPage();
  const { publicacion } = await searchParams;
  const listings = await listListingsForUser(user);
  // `?publicacion=` is user input: it is resolved against what this user owns,
  // never trusted as an id.
  const selectedId = await resolvePanelListingId(user, publicacion, listings);

  const window = {
    startAt: startOfUtcDay(new Date()),
    endAt: addDays(startOfUtcDay(new Date()), 90),
  };
  const [occupied, blocks] = selectedId
    ? await Promise.all([
        listOccupiedRanges(selectedId, window),
        listBlocksForListing(selectedId),
      ])
    : [[], []];

  return (
    <section className="space-y-6">
      <div>
        <Link href="/panel" className="text-sm text-blue-700 underline">
          ← Panel
        </Link>
        <h1 className="text-2xl font-semibold">Calendario</h1>
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
          <section className="space-y-2">
            <h2 className="font-medium">Próximos 90 días ({occupied.length} ocupaciones)</h2>
            {occupied.length === 0 ? (
              <p className="text-sm text-neutral-500">Todo libre en los próximos 90 días.</p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {occupied.map((entry) => (
                  <li key={`${entry.kind}-${entry.id}`}>
                    {formatLocalDateTime(entry.startAt)} → {formatLocalDateTime(entry.endAt)} ·{" "}
                    {entry.kind === "booking"
                      ? `reserva ${entry.reference} (${entry.status})`
                      : `bloqueo: ${entry.reason}${entry.note ? ` — ${entry.note}` : ""}`}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-medium">Bloquear fechas (#15)</h2>
            <ActionForm action={blockDatesAction} submitLabel="Bloquear">
              <input type="hidden" name="listingId" value={selectedId} />
              <div className="grid grid-cols-2 gap-2 text-sm">
                <label className="space-y-1">
                  <span>Desde</span>
                  <input
                    type="date"
                    name="startAt"
                    required
                    className="w-full rounded border border-neutral-300 px-2 py-1"
                  />
                </label>
                <label className="space-y-1">
                  <span>Hasta</span>
                  <input
                    type="date"
                    name="endAt"
                    required
                    className="w-full rounded border border-neutral-300 px-2 py-1"
                  />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span>Motivo</span>
                <select
                  name="reason"
                  className="w-full rounded border border-neutral-300 px-2 py-1"
                >
                  <option value="owner_use">uso propio</option>
                  <option value="maintenance">mantenimiento</option>
                </select>
              </label>
              <label className="block space-y-1 text-sm">
                <span>Nota</span>
                <input name="note" className="w-full rounded border border-neutral-300 px-2 py-1" />
              </label>
            </ActionForm>
          </section>

          <section className="space-y-2">
            <h2 className="font-medium">Bloqueos cargados ({blocks.length})</h2>
            {blocks.length === 0 ? (
              <p className="text-sm text-neutral-500">Sin bloqueos.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {blocks.map((block) => (
                  <li key={block.id} className="flex flex-wrap items-center gap-2">
                    <span className="grow">
                      {formatLocalDateTime(block.startAt)} → {formatLocalDateTime(block.endAt)} ·{" "}
                      {block.reason}
                      {block.note ? ` — ${block.note}` : ""}
                    </span>
                    {block.reason === "external_ical" ? (
                      <span className="text-xs text-neutral-500">
                        viene de un calendario externo
                      </span>
                    ) : (
                      <ActionForm
                        action={unblockDatesAction}
                        submitLabel="Quitar"
                        className="inline"
                        submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                      >
                        <input type="hidden" name="blockId" value={block.id} />
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
