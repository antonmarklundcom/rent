import { Link } from "@/i18n/navigation";
import { Badge, bookingStatusTone } from "@/components/ui/badge";
import { EmptyState, PageHeader, Section, TableWrap, table, th, td } from "@/components/ui/page-header";
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
    <div className="space-y-4">
      <PageHeader
        title="Reservas"
        subtitle={
          <div className="flex flex-wrap gap-1">
            <a
              href="/admin/reservas"
              className={`rounded-full px-3 py-1 text-xs ${!status ? "bg-ink text-base font-medium" : "border border-ink/15 hover:border-ink/30"}`}
            >
              todas
            </a>
            {BOOKING_STATUSES.map((value) => (
              <a
                key={value}
                href={`?estado=${value}`}
                className={`rounded-full px-3 py-1 text-xs ${value === status ? "bg-ink text-base font-medium" : "border border-ink/15 hover:border-ink/30"}`}
              >
                {value}
              </a>
            ))}
          </div>
        }
      />

      <Section>
        {rows.length === 0 ? (
          <EmptyState>Sin reservas.</EmptyState>
        ) : (
          <TableWrap>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Referencia</th>
                  <th className={th}>Publicación</th>
                  <th className={th}>Huésped</th>
                  <th className={th}>Fechas</th>
                  <th className={th}>Estado</th>
                  <th className={th}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ booking, listingTitle }) => (
                  <tr key={booking.id}>
                    <td className={`${td} font-medium`}>
                      <Link href={`/admin/reservas/${booking.id}`} className="text-accent hover:underline">
                        {booking.reference}
                      </Link>
                    </td>
                    <td className={td}>{listingTitle}</td>
                    <td className={td}>{booking.guestName}</td>
                    <td className={td}>
                      {booking.startAt.toISOString().slice(0, 10)} → {booking.endAt.toISOString().slice(0, 10)}
                    </td>
                    <td className={td}>
                      <Badge tone={bookingStatusTone(booking.status)}>{booking.status}</Badge>
                    </td>
                    <td className={`${td} tabular-nums`}>{formatMoney(booking.total, booking.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
