/**
 * Phase O-2 logic verification — NO database required (plan §5.O4/O5/O7).
 *
 *   npm run verify:logic
 *
 * These are the pure calculators the whole product's money and calendar rest
 * on: the overlap predicate, unit counting, price + extras + promo, commission,
 * the booking state machine, and iCal date parsing. They run anywhere, in
 * milliseconds, so a regression here is caught before a build ever starts.
 */
import { CheckRunner } from "./lib/checks";
import {
  addDays,
  atClock,
  daysBetween,
  monthsBetween,
  nightsBetween,
  parseYmd,
  periodOf,
  periodRange,
  rangesOverlap,
} from "../src/lib/dates";
import {
  BOOKING_TRANSITIONS,
  assertTransition,
  canTransition,
  occupiesCalendar,
  transitionClaimsDates,
  transitionReleasesDates,
} from "../src/lib/booking-state";
import {
  COMMISSION_BASE,
  computeCommission,
  computeUnits,
  discountFor,
  quoteBooking,
  resolveCommissionPct,
  type PromoInput,
} from "../src/lib/pricing";
import {
  blockingEvents,
  buildIcs,
  escapeText,
  foldLine,
  parseIcal,
  parseIcalDate,
  unescapeText,
  unfoldLines,
} from "../src/lib/ical";
import { addMoney, toMoney } from "../src/lib/money";
import { occupiedMillis } from "../src/db/queries/availability";

const r = new CheckRunner();
const d = (iso: string) => new Date(iso);

/* -------------------------------------------------------------- date ranges */
r.section("Rangos y solapamiento (media apertura [inicio, fin))");

const march4to7 = { startAt: d("2026-03-04T14:00:00Z"), endAt: d("2026-03-07T11:00:00Z") };
r.check(
  "rango idéntico solapa",
  rangesOverlap(march4to7, { ...march4to7 }),
);
r.check(
  "rango contenido solapa",
  rangesOverlap(march4to7, {
    startAt: d("2026-03-05T00:00:00Z"),
    endAt: d("2026-03-06T00:00:00Z"),
  }),
);
r.check(
  "rango que envuelve solapa",
  rangesOverlap(march4to7, {
    startAt: d("2026-03-01T00:00:00Z"),
    endAt: d("2026-03-30T00:00:00Z"),
  }),
);
r.check(
  "solapamiento parcial al inicio",
  rangesOverlap(march4to7, {
    startAt: d("2026-03-02T00:00:00Z"),
    endAt: d("2026-03-05T00:00:00Z"),
  }),
);
r.check(
  "check-out y check-in el mismo día NO solapan",
  !rangesOverlap(march4to7, {
    startAt: d("2026-03-07T14:00:00Z"),
    endAt: d("2026-03-09T11:00:00Z"),
  }),
);
r.check(
  "rangos que se tocan exactamente NO solapan",
  !rangesOverlap(
    { startAt: d("2026-03-04T00:00:00Z"), endAt: d("2026-03-07T00:00:00Z") },
    { startAt: d("2026-03-07T00:00:00Z"), endAt: d("2026-03-09T00:00:00Z") },
  ),
);
r.check(
  "rango anterior no solapa",
  !rangesOverlap(march4to7, {
    startAt: d("2026-02-01T00:00:00Z"),
    endAt: d("2026-03-04T14:00:00Z"),
  }),
);
r.check("solapamiento es simétrico", rangesOverlap(
  { startAt: d("2026-03-05T00:00:00Z"), endAt: d("2026-03-06T00:00:00Z") },
  march4to7,
));

r.equal("noches 4→7 = 3", nightsBetween(d("2026-03-04T14:00:00Z"), d("2026-03-07T11:00:00Z")), 3);
r.equal("noches mínimo 1", nightsBetween(d("2026-03-04T14:00:00Z"), d("2026-03-04T18:00:00Z")), 1);
r.equal("noches cruzando fin de mes", nightsBetween(d("2026-01-30T14:00:00Z"), d("2026-02-02T11:00:00Z")), 3);
r.equal("días 72h = 3", daysBetween(d("2026-03-04T09:00:00Z"), d("2026-03-07T09:00:00Z")), 3);
r.equal("días 73h = 4 (se empieza el día)", daysBetween(d("2026-03-04T09:00:00Z"), d("2026-03-07T10:00:00Z")), 4);
r.equal("meses 1 mes exacto", monthsBetween(d("2026-03-04T00:00:00Z"), d("2026-04-04T00:00:00Z")), 1);
r.equal("meses 45 días = 2", monthsBetween(d("2026-03-04T00:00:00Z"), d("2026-04-18T00:00:00Z")), 2);

r.equal("atClock aplica el horario de check-in", atClock(parseYmd("2026-03-04"), "14:00").toISOString(), "2026-03-04T14:00:00.000Z");
r.equal("atClock aplica el horario de check-out", atClock(parseYmd("2026-03-07"), "11:00").toISOString(), "2026-03-07T11:00:00.000Z");
r.equal("addDays cruza el cambio de mes", addDays(parseYmd("2026-01-31"), 1).toISOString().slice(0, 10), "2026-02-01");
r.throws("parseYmd rechaza una fecha inexistente", () => parseYmd("2026-02-30"), "invalid_range");
r.throws("parseYmd rechaza basura", () => parseYmd("mañana"), "invalid_range");
r.equal("periodRange de diciembre cruza el año", periodRange("2026-12").endAt.toISOString().slice(0, 10), "2027-01-01");
r.equal("periodOf", periodOf(d("2026-03-31T23:00:00Z")), "2026-03");
r.throws("periodRange rechaza mes 13", () => periodRange("2026-13"), "invalid_range");

r.section("Ocupación acumulada (insumo de la métrica de ocupación)");
const window = { startAt: d("2026-03-01T00:00:00Z"), endAt: d("2026-04-01T00:00:00Z") };
r.equal(
  "rangos solapados se fusionan, no se suman dos veces",
  occupiedMillis(
    [
      { kind: "block", id: 1, reason: "owner_use", note: null, startAt: d("2026-03-01T00:00:00Z"), endAt: d("2026-03-05T00:00:00Z") },
      { kind: "block", id: 2, reason: "owner_use", note: null, startAt: d("2026-03-03T00:00:00Z"), endAt: d("2026-03-08T00:00:00Z") },
    ],
    window,
  ) / 86_400_000,
  7,
);
r.equal(
  "los rangos se recortan a la ventana",
  occupiedMillis(
    [
      { kind: "block", id: 1, reason: "owner_use", note: null, startAt: d("2026-02-20T00:00:00Z"), endAt: d("2026-03-03T00:00:00Z") },
    ],
    window,
  ) / 86_400_000,
  2,
);

/* ----------------------------------------------------------- state machine */
r.section("Máquina de estados de reservas");

r.check("inquiry → confirmed permitido", canTransition("inquiry", "confirmed"));
r.check("confirmed → active permitido", canTransition("confirmed", "active"));
r.check("active → completed permitido", canTransition("active", "completed"));
r.check("confirmed → completed permitido (sin pasar por active)", canTransition("confirmed", "completed"));
r.check("inquiry → active PROHIBIDO", !canTransition("inquiry", "active"));
r.check("inquiry → completed PROHIBIDO", !canTransition("inquiry", "completed"));
r.check("completed es terminal", BOOKING_TRANSITIONS.completed.length === 0);
r.check("cancelled es terminal", BOOKING_TRANSITIONS.cancelled.length === 0);
r.check("cancelled → confirmed PROHIBIDO", !canTransition("cancelled", "confirmed"));
r.throws("assertTransition rechaza completed → active", () => assertTransition("completed", "active"), "invalid_transition");
r.throws("assertTransition rechaza el no-cambio", () => assertTransition("confirmed", "confirmed"), "invalid_transition");

r.check("inquiry NO ocupa el calendario", !occupiesCalendar("inquiry"));
r.check("cancelled NO ocupa el calendario", !occupiesCalendar("cancelled"));
r.check("confirmed ocupa", occupiesCalendar("confirmed"));
r.check("active ocupa", occupiesCalendar("active"));
r.check("completed ocupa (ver §9)", occupiesCalendar("completed"));
r.check("inquiry → confirmed reclama fechas", transitionClaimsDates("inquiry", "confirmed"));
r.check("confirmed → cancelled libera fechas", transitionReleasesDates("confirmed", "cancelled"));
r.check("confirmed → completed no libera fechas", !transitionReleasesDates("confirmed", "completed"));

/* ------------------------------------------------------------------ precio */
r.section("Cálculo de precio, adicionales y promos");

r.equal("unidades per_night", computeUnits("per_night", d("2026-03-04T14:00:00Z"), d("2026-03-07T11:00:00Z")), 3);
r.equal("unidades per_day", computeUnits("per_day", d("2026-03-04T09:00:00Z"), d("2026-03-07T09:00:00Z")), 3);

const base = quoteBooking({
  vertical: "stay",
  priceUnit: "per_night",
  unitPrice: "350000.00",
  startAt: d("2026-03-04T14:00:00Z"),
  endAt: d("2026-03-07T11:00:00Z"),
});
r.equal("base = precio × noches", base.baseTotal, "1050000.00");
r.equal("sin adicionales, extras = 0", base.extrasTotal, "0.00");
r.equal("sin promo, descuento = 0", base.discountTotal, "0.00");
r.equal("total = base", base.total, "1050000.00");

const withExtras = quoteBooking({
  vertical: "car",
  priceUnit: "per_day",
  unitPrice: "250000.00",
  startAt: d("2026-03-04T09:00:00Z"),
  endAt: d("2026-03-07T09:00:00Z"),
  extras: [
    { extraId: 1, name: "GPS", unitPrice: "25000.00", qty: 1, perUnit: true },
    { extraId: 2, name: "Silla de bebé", unitPrice: "35000.00", qty: 2, perUnit: false },
  ],
});
r.equal("adicional per_unit se multiplica por las unidades", withExtras.extraLines[0]!.lineTotal, "75000.00");
r.equal("adicional plano se multiplica solo por la cantidad", withExtras.extraLines[1]!.lineTotal, "70000.00");
r.equal("extrasTotal suma las líneas", withExtras.extrasTotal, "145000.00");
r.equal("total = base + extras", withExtras.total, "895000.00");

const percentPromo: PromoInput = {
  id: 1, code: "BIENVENIDA10", discountType: "percent", discountValue: "10.00",
  validFrom: d("2026-01-01T00:00:00Z"), validUntil: d("2026-12-31T00:00:00Z"),
  maxUses: 100, usedCount: 0, vertical: null, isActive: true,
};
const discounted = quoteBooking({
  vertical: "stay",
  priceUnit: "per_night",
  unitPrice: "350000.00",
  startAt: d("2026-03-04T14:00:00Z"),
  endAt: d("2026-03-07T11:00:00Z"),
  extras: [{ extraId: 3, name: "Traslado", unitPrice: "180000.00", qty: 1, perUnit: false }],
  promo: percentPromo,
  now: d("2026-02-01T00:00:00Z"),
});
r.equal("descuento porcentual sobre la base", discounted.discountTotal, "105000.00");
r.equal("el descuento NO toca los adicionales", discounted.extrasTotal, "180000.00");
r.equal("total = base − descuento + extras", discounted.total, "1125000.00");
r.equal("ownerGross = base − descuento", discounted.ownerGross, "945000.00");

const fixedPromo: PromoInput = { ...percentPromo, id: 2, code: "VERANO50K", discountType: "fixed", discountValue: "50000.00" };
r.equal("descuento fijo", discountFor(fixedPromo, "1050000.00"), "50000.00");
r.equal(
  "un descuento fijo mayor que la base se limita a la base",
  discountFor({ ...fixedPromo, discountValue: "9999999.00" }, "1050000.00"),
  "1050000.00",
);
r.equal("sin promo el descuento es cero", discountFor(null, "1050000.00"), "0.00");

const quoteExpired = () =>
  quoteBooking({
    vertical: "stay", priceUnit: "per_night", unitPrice: "350000.00",
    startAt: d("2026-03-04T14:00:00Z"), endAt: d("2026-03-07T11:00:00Z"),
    promo: percentPromo, now: d("2027-06-01T00:00:00Z"),
  });
r.throws("promo vencida rechazada", quoteExpired, "promo_expired");
r.throws(
  "promo aún no vigente rechazada",
  () => quoteBooking({
    vertical: "stay", priceUnit: "per_night", unitPrice: "350000.00",
    startAt: d("2026-03-04T14:00:00Z"), endAt: d("2026-03-07T11:00:00Z"),
    promo: percentPromo, now: d("2025-06-01T00:00:00Z"),
  }),
  "promo_expired",
);
r.throws(
  "promo agotada rechazada",
  () => quoteBooking({
    vertical: "stay", priceUnit: "per_night", unitPrice: "350000.00",
    startAt: d("2026-03-04T14:00:00Z"), endAt: d("2026-03-07T11:00:00Z"),
    promo: { ...percentPromo, usedCount: 100 }, now: d("2026-02-01T00:00:00Z"),
  }),
  "promo_exhausted",
);
r.throws(
  "promo de otra vertical rechazada",
  () => quoteBooking({
    vertical: "car", priceUnit: "per_day", unitPrice: "250000.00",
    startAt: d("2026-03-04T09:00:00Z"), endAt: d("2026-03-07T09:00:00Z"),
    promo: { ...percentPromo, vertical: "stay" }, now: d("2026-02-01T00:00:00Z"),
  }),
  "promo_wrong_vertical",
);
r.throws(
  "promo inactiva rechazada",
  () => quoteBooking({
    vertical: "stay", priceUnit: "per_night", unitPrice: "350000.00",
    startAt: d("2026-03-04T14:00:00Z"), endAt: d("2026-03-07T11:00:00Z"),
    promo: { ...percentPromo, isActive: false }, now: d("2026-02-01T00:00:00Z"),
  }),
  "promo_invalid",
);
r.throws(
  "cantidad de adicional inválida rechazada",
  () => quoteBooking({
    vertical: "car", priceUnit: "per_day", unitPrice: "250000.00",
    startAt: d("2026-03-04T09:00:00Z"), endAt: d("2026-03-07T09:00:00Z"),
    extras: [{ extraId: 1, name: "GPS", unitPrice: "25000.00", qty: 0, perUnit: true }],
  }),
  "extra_invalid",
);
r.throws(
  "rango invertido rechazado",
  () => quoteBooking({
    vertical: "stay", priceUnit: "per_night", unitPrice: "350000.00",
    startAt: d("2026-03-07T14:00:00Z"), endAt: d("2026-03-04T11:00:00Z"),
  }),
  "invalid_range",
);

/* -------------------------------------------------------------- comisiones */
r.section("Comisión");

r.equal("override de la publicación gana", resolveCommissionPct("25.00", "20.00"), "25.00");
r.equal("sin override cae al default del propietario", resolveCommissionPct(null, "15.00"), "15.00");
r.equal("override vacío cae al default", resolveCommissionPct("", "15.00"), "15.00");
r.equal("un override de 0% es válido y NO cae al default", resolveCommissionPct("0.00", "20.00"), "0.00");
r.throws("sin comisión configurada falla ruidosamente", () => resolveCommissionPct(null, null), "invalid_amount");

const commissionSample = { baseTotal: "1050000.00", discountTotal: "105000.00", extrasTotal: "180000.00" };
r.equal("la base de comisión excluye adicionales y resta el descuento", COMMISSION_BASE(commissionSample), "945000.00");
const commission = computeCommission(commissionSample, "20.00");
r.equal("comisión 20%", commission.commissionAmount, "189000.00");
r.equal("neto del propietario = bruto − comisión", commission.ownerNet, "756000.00");
r.equal("comisión 0% no cobra nada", computeCommission(commissionSample, "0.00").commissionAmount, "0.00");
r.equal(
  "comisión con decimales redondea a 2",
  computeCommission({ baseTotal: "333333.33", discountTotal: "0.00" }, "17.50").commissionAmount,
  "58333.33",
);
r.throws("comisión > 100% rechazada", () => computeCommission(commissionSample, "120.00"), "invalid_amount");
r.throws("comisión negativa rechazada", () => computeCommission(commissionSample, "-5.00"), "invalid_amount");
r.equal(
  "bruto − comisión − gastos = neto (aritmética del estado de cuenta)",
  toMoney(
    Number(addMoney("945000.00", "600000.00")) - Number(addMoney("189000.00", "120000.00")) - Number("250000.00"),
  ),
  "986000.00",
);

/* ------------------------------------------------------------------- iCal */
r.section("iCal — parseo de fechas y zonas horarias");

r.equal("VALUE=DATE se lee como medianoche UTC", parseIcalDate("20260304", { VALUE: "DATE" }).date.toISOString(), "2026-03-04T00:00:00.000Z");
r.check("VALUE=DATE marca allDay", parseIcalDate("20260304", { VALUE: "DATE" }).allDay);
r.equal("fecha-hora con Z es UTC", parseIcalDate("20260304T140000Z").date.toISOString(), "2026-03-04T14:00:00.000Z");
r.check("fecha-hora NO marca allDay", !parseIcalDate("20260304T140000Z").allDay);
r.equal(
  "TZID America/Asuncion (UTC−3) se convierte a UTC",
  parseIcalDate("20260304T140000", { TZID: "America/Asuncion" }).date.toISOString(),
  "2026-03-04T17:00:00.000Z",
);
r.equal(
  "hora flotante usa la zona por defecto de Paraguay",
  parseIcalDate("20260304T140000").date.toISOString(),
  "2026-03-04T17:00:00.000Z",
);
r.equal(
  "TZID de otra zona (UTC+2 en verano) se convierte",
  parseIcalDate("20260704T140000", { TZID: "Europe/Madrid" }).date.toISOString(),
  "2026-07-04T12:00:00.000Z",
);
r.equal(
  "una zona desconocida degrada a UTC en vez de romper la sincronización",
  parseIcalDate("20260304T140000", { TZID: "Marte/Olympus" }).date.toISOString(),
  "2026-03-04T14:00:00.000Z",
);
r.throws("fecha iCal ilegible rechazada", () => parseIcalDate("no-es-una-fecha"));

r.section("iCal — parseo de calendarios");

const AIRBNB_FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Airbnb Inc//Hosting Calendar 1.0.0//EN",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260410",
  "DTEND;VALUE=DATE:20260415",
  "UID:abc123@airbnb.com",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260501",
  "DTEND;VALUE=DATE:20260503",
  "UID:def456@airbnb.com",
  "SUMMARY:Airbnb (Not availa",
  " ble)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20260601T120000Z",
  "DTEND:20260603T120000Z",
  "UID:ghi789@airbnb.com",
  "STATUS:CANCELLED",
  "SUMMARY:Cancelada",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const parsed = parseIcal(AIRBNB_FEED);
r.equal("se leen los 3 VEVENT", parsed.length, 3);
r.equal("UID leído", parsed[0]!.uid, "abc123@airbnb.com");
r.equal("DTSTART all-day", parsed[0]!.startAt.toISOString(), "2026-04-10T00:00:00.000Z");
r.equal("DTEND all-day es exclusivo (libera el día 15)", parsed[0]!.endAt.toISOString(), "2026-04-15T00:00:00.000Z");
r.equal("líneas plegadas se reconstruyen", parsed[1]!.summary, "Airbnb (Not available)");
r.equal("blockingEvents descarta CANCELLED", blockingEvents(parsed).length, 2);
r.equal("unfoldLines une la continuación", unfoldLines("SUMMARY:hola\r\n  mundo").length, 1);
r.throws("una página de error no es un calendario", () => parseIcal("<html>404</html>"));

const malformed = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:sin-fecha@example.com",
  "SUMMARY:Sin DTSTART",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:ok@example.com",
  "DTSTART;VALUE=DATE:20260410",
  "DTEND;VALUE=DATE:20260412",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");
r.equal("un VEVENT roto no tumba el resto del feed", parseIcal(malformed).length, 1);
r.equal(
  "sin DTEND el evento dura un día",
  parseIcal(
    ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x@e.com", "DTSTART;VALUE=DATE:20260410", "END:VEVENT", "END:VCALENDAR"].join("\r\n"),
  )[0]!.endAt.toISOString(),
  "2026-04-11T00:00:00.000Z",
);
r.equal(
  "un evento con DTEND ≤ DTSTART se descarta",
  parseIcal(
    ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x@e.com", "DTSTART:20260410T100000Z", "DTEND:20260410T100000Z", "END:VEVENT", "END:VCALENDAR"].join("\r\n"),
  ).length,
  0,
);
r.equal("texto escapado se desescapa", unescapeText("Casa\\, Villa Morra\\; centro\\nPB"), "Casa, Villa Morra; centro\nPB");

r.section("iCal — generación del feed de exportación");

const ics = buildIcs({
  name: "Casa en Villa Morra",
  events: [
    { uid: "booking-1@alquilar.com.py", startAt: d("2026-04-10T14:00:00Z"), endAt: d("2026-04-15T11:00:00Z"), summary: "Reservado" },
    { uid: "block-2@alquilar.com.py", startAt: d("2026-05-01T00:00:00Z"), endAt: d("2026-05-03T00:00:00Z"), summary: "No disponible", allDay: true },
  ],
  now: d("2026-03-01T00:00:00Z"),
});
r.check("el feed abre y cierra VCALENDAR", ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.trimEnd().endsWith("END:VCALENDAR"));
r.check("usa CRLF", ics.includes("\r\n") && !/[^\r]\n/.test(ics));
r.check("DTSTART con hora en UTC", ics.includes("DTSTART:20260410T140000Z"));
r.check("DTSTART all-day usa VALUE=DATE", ics.includes("DTSTART;VALUE=DATE:20260501"));
r.check("cada evento lleva su UID", ics.includes("UID:booking-1@alquilar.com.py"));
r.check("el feed no filtra datos del huésped", !/guest|huésped|\+595/i.test(ics));
r.equal("escapeText protege comas y punto y coma", escapeText("Casa, Villa Morra; centro"), "Casa\\, Villa Morra\\; centro");
r.check("las líneas largas se pliegan a 75 octetos", foldLine(`SUMMARY:${"a".repeat(200)}`).split("\r\n ").length > 2);
r.equal(
  "una ida y vuelta escape → unescape conserva el texto",
  unescapeText(escapeText("Casa, Villa Morra; centro\nPB")),
  "Casa, Villa Morra; centro\nPB",
);
r.check(
  "el feed generado se puede volver a parsear",
  parseIcal(ics).length === 2,
);

process.exitCode = r.summary("verificaciones de lógica pasaron") ? 1 : 0;
