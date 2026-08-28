import type { CalendarEntry } from "@/db/queries/panel";

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
const DAY_MS = 86_400_000;

type DayInfo = {
  date: Date;
  inRange: boolean;
  isToday: boolean;
  entries: CalendarEntry[];
};

function cellTone(entries: CalendarEntry[]): string {
  if (entries.length === 0) return "";
  const booking = entries.find((e) => e.kind === "booking");
  if (booking) {
    return booking.status === "completed"
      ? "bg-ink/15 text-ink"
      : "bg-accent text-accent-ink";
  }
  const block = entries[0];
  if (block.status === "external_ical") return "bg-ink/10 text-ink/70 border border-dashed border-ink/25";
  if (block.status === "maintenance") return "bg-amber-100 text-amber-900";
  return "bg-ink/[0.08] text-ink/70"; // owner_use
}

/**
 * Real month-grid rendering of the owner's calendar (plan §6.S3), built from
 * `panelCalendar`'s flat booking+block feed — no new query, just a grid over
 * the same rows the panel already fetches.
 */
export function PanelCalendar({
  entries,
  window,
}: {
  entries: CalendarEntry[];
  window: { startAt: Date; endAt: Date };
}) {
  const today = startOfUtcDay(new Date());
  const startMonth = new Date(Date.UTC(window.startAt.getUTCFullYear(), window.startAt.getUTCMonth(), 1));
  const endMonth = new Date(Date.UTC(window.endAt.getUTCFullYear(), window.endAt.getUTCMonth(), 1));

  const months: Date[] = [];
  for (let cursor = startMonth; cursor.getTime() <= endMonth.getTime(); ) {
    months.push(cursor);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {months.map((month) => (
          <MonthGrid key={month.toISOString()} month={month} entries={entries} today={today} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink/60">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Reserva
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ink/15" /> Reserva completada
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ink/[0.08]" /> Bloqueo (uso propio)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-100" /> Bloqueo (mantenimiento)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-ink/25 bg-ink/10" /> iCal externo
        </li>
      </ul>
    </div>
  );
}

function MonthGrid({ month, entries, today }: { month: Date; entries: CalendarEntry[]; today: number }) {
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstOfMonth = Date.UTC(year, monthIndex, 1);
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  // Monday-first offset: JS getUTCDay() is 0=Sun..6=Sat.
  const firstWeekday = (new Date(firstOfMonth).getUTCDay() + 6) % 7;

  const days: DayInfo[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    days.push({ date: new Date(0), inRange: false, isToday: false, entries: [] });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStart = Date.UTC(year, monthIndex, d);
    const dayEnd = dayStart + DAY_MS;
    const dayEntries = entries.filter(
      (entry) => entry.startAt.getTime() < dayEnd && entry.endAt.getTime() > dayStart,
    );
    days.push({
      date: new Date(dayStart),
      inRange: true,
      isToday: dayStart === today,
      entries: dayEntries,
    });
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium capitalize">
        {MONTHS_ES[monthIndex]} {year}
      </p>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink/40">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((day, i) =>
          day.inRange ? (
            <div
              key={i}
              title={day.entries.map((e) => `${e.listingTitle}: ${e.label}`).join("\n") || undefined}
              className={`flex aspect-square items-center justify-center rounded-sm text-[11px] tabular-nums ${cellTone(
                day.entries,
              )} ${day.isToday ? "ring-2 ring-accent ring-offset-1" : ""} ${
                day.entries.length === 0 ? "text-ink/35" : "font-medium"
              }`}
            >
              {day.date.getUTCDate()}
            </div>
          ) : (
            <div key={i} />
          ),
        )}
      </div>
    </div>
  );
}
