/**
 * Public iCal export (#2, plan §5.O5): `/api/ical/<token>.ics`.
 *
 * The token IS the credential — same reasoning as the cleaner magic link — so
 * the feed carries no guest names, no prices and no contact data: only that a
 * range is busy. Airbnb, Booking and Google all subscribe to exactly this.
 *
 * `<token>.ics` and a bare `<token>` both resolve, because calendar clients
 * differ on whether they keep the extension.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { listOccupiedRanges } from "@/db/queries/availability";
import { addDays, startOfUtcDay } from "@/lib/dates";
import { buildIcs, type IcalExportEvent } from "@/lib/ical";

export const dynamic = "force-dynamic";

/** How far back and forward the feed reaches. */
const PAST_DAYS = 90;
const FUTURE_DAYS = 540;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw).replace(/\.ics$/i, "");
  if (!token || token.length < 16) {
    return new Response("Not found", { status: 404 });
  }

  const [listing] = await db
    .select({
      id: listings.id,
      title: listings.title,
      vertical: listings.vertical,
    })
    .from(listings)
    .where(eq(listings.icalExportToken, token))
    .limit(1);
  if (!listing) return new Response("Not found", { status: 404 });

  const today = startOfUtcDay(new Date());
  const window = { startAt: addDays(today, -PAST_DAYS), endAt: addDays(today, FUTURE_DAYS) };
  const occupied = await listOccupiedRanges(listing.id, window);

  const events: IcalExportEvent[] = occupied.map((entry) =>
    entry.kind === "booking"
      ? {
          uid: `booking-${entry.id}@alquilar.com.py`,
          startAt: entry.startAt,
          endAt: entry.endAt,
          summary: "Reservado",
        }
      : {
          uid: `block-${entry.id}@alquilar.com.py`,
          startAt: entry.startAt,
          endAt: entry.endAt,
          summary: entry.reason === "maintenance" ? "Mantenimiento" : "No disponible",
        },
  );

  const body = buildIcs({ name: listing.title, events });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="${listing.id}.ics"`,
      "cache-control": "public, max-age=300",
    },
  });
}
