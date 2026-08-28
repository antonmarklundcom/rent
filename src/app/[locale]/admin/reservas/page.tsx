import { Link } from "@/i18n/navigation";
import { listBookingsForListings } from "@/db/queries/bookings";
import { listPanelListings } from "@/db/queries/panel";
import { BOOKING_STATUSES, type BookingStatus } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Booking list (plan §5.O11). The per-booking screen already exists at
 * `/admin/reservas/[id]` (phase O-3) — this is the index that reaches it, not
 * a second screen for the same entity (plan §9, O-3 handoff note).
 */
export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdminPage();
  const query = await searchParams;
  const raw = Array.isArray(query.estado) ? query.estado[0] : query.estado;
  const status = (BOOKING_STATUSES as readonly string[]).includes(raw ?? "")
    ? (raw as BookingStatus)
    : null;

  const listings = await listPanelListings(user);
  const rows = await listBookingsForListings(
    listings.map((listing) => listing.id),
    { statuses: status ? [status] : undefined, limit: 200 },
  );

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Reservas</h1>
        <p className="text-sm">
          <a href="/admin/reservas" className={`mr-3 underline ${status ? "text-blue-700" : "font-semibold"}`}>
            todas
          </a>
          {BOOKING_STATUSES.map((value) => (
            <a
              key={value}
              href={`?estado=${value}`}
              className={`mr-3 underline ${value === status ? "font-semibold" : "text-blue-700"}`}
            >
              {value}
            </a>
          ))}
        </p>
      </header>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-1">Referencia</th>
            <th>Publicación</th>
            <th>Huésped</th>
            <th>Fechas</th>
            <th>Estado</th>
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
              <td>
                {booking.startAt.toISOString().slice(0, 10)} →{" "}
                {booking.endAt.toISOString().slice(0, 10)}
              </td>
              <td>{booking.status}</td>
              <td>{formatMoney(booking.total, booking.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-sm text-neutral-600">Sin reservas.</p>}
    </section>
  );
}
