import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { createManualBookingForm } from "@/app/actions/money-forms";
import { listBookingsForListings } from "@/db/queries/bookings";
import { listListingsForUser } from "@/db/queries/listings";
import { BOOKING_STATUSES, type BookingStatus } from "@/db/schema";
import { formatLocalDateTime } from "@/lib/messaging";
import { formatMoney } from "@/lib/money";
import { ownedListingIds } from "@/lib/scope";
import { requireAdminPage } from "@/lib/page-guards";

const inputClass = "w-full rounded border border-neutral-300 px-2 py-1";

/**
 * All bookings, plus the manual booking form (plan §5.O11).
 *
 * A manual booking runs through the SAME engine as a web request, so it cannot
 * double-book either (plan §5.O4). One booking has one detail route —
 * `/admin/reservas/[id]`, which phase O-3 opened and this phase extended.
 */
export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const user = await requireAdminPage();
  const { estado } = await searchParams;
  const status = BOOKING_STATUSES.includes(estado as BookingStatus)
    ? (estado as BookingStatus)
    : undefined;

  const listingIds = await ownedListingIds(user);
  const [rows, listings] = await Promise.all([
    listBookingsForListings(listingIds, { statuses: status ? [status] : undefined, limit: 100 }),
    listListingsForUser(user),
  ]);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reservas</h1>
        <form className="mt-2 flex items-end gap-2 text-sm">
          <label className="space-y-1">
            <span className="block">Estado</span>
            <select
              name="estado"
              defaultValue={status ?? ""}
              className="rounded border border-neutral-300 px-2 py-1"
            >
              <option value="">todos</option>
              {BOOKING_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded border border-neutral-400 px-3 py-1">
            Filtrar
          </button>
        </form>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-1">Código</th>
            <th>Publicación</th>
            <th>Huésped</th>
            <th>Desde</th>
            <th>Hasta</th>
            <th>Estado</th>
            <th>Origen</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ booking, listingTitle }) => (
            <tr key={booking.id} className="border-b">
              <td className="py-1">
                <Link href={`/admin/reservas/${booking.id}`} className="text-blue-700 underline">
                  {booking.reference}
                </Link>
              </td>
              <td>{listingTitle}</td>
              <td>{booking.guestName}</td>
              <td>{formatLocalDateTime(booking.startAt)}</td>
              <td>{formatLocalDateTime(booking.endAt)}</td>
              <td>{booking.status}</td>
              <td>{booking.source}</td>
              <td>{formatMoney(booking.total, booking.currency)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="py-1 text-neutral-500">
                No hay reservas con ese filtro.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="space-y-2">
        <h2 className="font-medium">Cargar una reserva a mano</h2>
        <ActionForm action={createManualBookingForm} submitLabel="Crear reserva">
          <label className="block space-y-1 text-sm">
            <span>Publicación</span>
            <select name="listingId" required className={inputClass}>
              {listings.map((listing) => (
                <option key={listing.id} value={listing.id}>
                  {listing.title} ({listing.vertical})
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span>Desde</span>
              <input type="date" name="startAt" required className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>Hasta</span>
              <input type="date" name="endAt" required className={inputClass} />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span>Huésped</span>
            <input name="guestName" required className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span>Teléfono</span>
              <input name="guestPhone" className={inputClass} />
            </label>
            <label className="space-y-1">
              <span>Correo</span>
              <input name="guestEmail" type="email" className={inputClass} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="space-y-1">
              <span>Estado inicial</span>
              <select name="status" defaultValue="confirmed" className={inputClass}>
                <option value="confirmed">confirmada</option>
                <option value="inquiry">consulta</option>
              </select>
            </label>
            <label className="space-y-1">
              <span>Origen</span>
              <select name="source" defaultValue="manual" className={inputClass}>
                <option value="manual">manual</option>
                <option value="whatsapp">whatsapp</option>
                <option value="web">web</option>
              </select>
            </label>
            <label className="space-y-1">
              <span>Código promo</span>
              <input name="promoCode" className={inputClass} />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span>Notas</span>
            <textarea name="notes" rows={2} className={inputClass} />
          </label>
          <p className="text-xs text-neutral-500">
            Confirmar una reserva de auto exige documentos verificados (#16), y confirmar
            cualquiera revisa la disponibilidad bajo llave.
          </p>
        </ActionForm>
      </section>
    </section>
  );
}
