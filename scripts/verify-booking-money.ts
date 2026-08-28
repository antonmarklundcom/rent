/**
 * Phase O-2 verification against a real database (plan §5.O4, O5, O7).
 *
 * Called by `scripts/verify-core.ts` so `npm run verify` stays one command.
 * The pure arithmetic is pinned separately and without a database in
 * `scripts/verify-logic.ts`; what is proven HERE is the behaviour that only
 * exists once rows are involved: overlap rejection through the real SQL guard,
 * iCal import idempotency, price/commission snapshots, statement idempotency
 * and the deposit + payment-link lifecycles.
 *
 * Fixtures live under their own owner (`verify-o2@alquilar.local`) in a period
 * (2020-01) no seed row touches, and are torn down and rebuilt on every run —
 * so the script is re-runnable and can never contaminate the demo data.
 */
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  availabilityBlocks,
  bookingExtras,
  bookings,
  deposits,
  expenses,
  extras,
  icalSources,
  listings,
  owners,
  ownerStatements,
  messages,
  paymentLinks,
  scheduledMessages,
  promoCodes,
  stayDetails,
  users,
} from "../src/db/schema";
import type { CheckRunner } from "./lib/checks";
import { assertCanAccessBooking } from "../src/lib/scope";
import { buildSessionUser, type SessionUser } from "../src/lib/auth-core";
import {
  createBooking,
  quoteForListing,
  transitionBooking,
} from "../src/db/queries/bookings";
import { createBlock, syncIcalBlocks } from "../src/db/queries/blocks";
import { findConflicts, listOccupiedRanges } from "../src/db/queries/availability";
import {
  createDeposit,
  deductDeposit,
  getDepositForBooking,
  refundedAmount,
  returnDeposit,
} from "../src/db/queries/deposits";
import {
  createPaymentLink,
  expireOverduePaymentLinks,
  markPaymentLinkPaid,
  paidTotal,
} from "../src/db/queries/payments";
import { generateStatement, getStatementDetail } from "../src/db/queries/statements";
import { renderStatementHtml } from "../src/lib/statement-html";
import { buildIcs } from "../src/lib/ical";

const VERIFY_EMAIL = "verify-o2@alquilar.local";
const VERIFY_SLUG = "verify-o2-casa";
const VERIFY_PROMO = "VERIFYO2";
const VERIFY_EXTRA = "Verify O2 — traslado";
const PERIOD = "2020-01";

const d = (iso: string) => new Date(iso);

/** Remove every row a previous run created, in dependency order. */
async function teardown(): Promise<void> {
  const [listing] = await db
    .select({ id: listings.id })
    .from(listings)
    .where(eq(listings.slug, VERIFY_SLUG))
    .limit(1);
  if (listing) {
    const bookingIds = (
      await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.listingId, listing.id))
    ).map((row) => row.id);
    if (bookingIds.length > 0) {
      await db.delete(bookingExtras).where(inArray(bookingExtras.bookingId, bookingIds));
      // Confirming a booking enqueues its message sequence (phase O-4), so
      // these fixtures leave queue rows behind too.
      await db.delete(scheduledMessages).where(inArray(scheduledMessages.bookingId, bookingIds));
      await db.delete(messages).where(inArray(messages.bookingId, bookingIds));
      await db.delete(deposits).where(inArray(deposits.bookingId, bookingIds));
      await db.delete(paymentLinks).where(inArray(paymentLinks.bookingId, bookingIds));
    }
    await db.delete(bookings).where(eq(bookings.listingId, listing.id));
    await db.delete(availabilityBlocks).where(eq(availabilityBlocks.listingId, listing.id));
    await db.delete(expenses).where(eq(expenses.listingId, listing.id));
    await db.delete(icalSources).where(eq(icalSources.listingId, listing.id));
    await db.delete(stayDetails).where(eq(stayDetails.listingId, listing.id));
    await db.delete(listings).where(eq(listings.id, listing.id));
  }
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, VERIFY_EMAIL))
    .limit(1);
  if (user) {
    const ownerIds = (
      await db.select({ id: owners.id }).from(owners).where(eq(owners.userId, user.id))
    ).map((row) => row.id);
    if (ownerIds.length > 0) {
      await db.delete(ownerStatements).where(inArray(ownerStatements.ownerId, ownerIds));
      await db.delete(owners).where(inArray(owners.id, ownerIds));
    }
    await db.delete(users).where(eq(users.id, user.id));
  }
  await db.delete(promoCodes).where(eq(promoCodes.code, VERIFY_PROMO));
  await db.delete(extras).where(like(extras.name, "Verify O2 —%"));
}

type Fixture = {
  ownerId: number;
  ownerUser: SessionUser;
  listingId: number;
  extraId: number;
  promoId: number;
};

async function setup(): Promise<Fixture> {
  await teardown();

  const [userRow] = await db
    .insert(users)
    .values({
      name: "Verificación O-2",
      email: VERIFY_EMAIL,
      role: "owner",
      passwordHash: null,
      isActive: true,
    })
    .$returningId();
  const [ownerRow] = await db
    .insert(owners)
    .values({
      userId: userRow!.id,
      displayName: "Verificación O-2",
      defaultCommissionPct: "20.00",
    })
    .$returningId();
  const [listingRow] = await db
    .insert(listings)
    .values({
      slug: VERIFY_SLUG,
      vertical: "stay",
      title: "Casa de verificación O-2",
      price: "350000.00",
      priceUnit: "per_night",
      currency: "PYG",
      status: "published",
      publishedAt: new Date(),
      ownerId: ownerRow!.id,
      cancellationPolicy: "moderate",
      icalExportToken: "verify-o2-ical-export-token-0001",
    })
    .$returningId();
  await db.insert(stayDetails).values({
    listingId: listingRow!.id,
    propertyType: "casa",
    maxGuests: 6,
    checkInTime: "14:00",
    checkOutTime: "11:00",
  });
  const [extraRow] = await db
    .insert(extras)
    .values({
      name: VERIFY_EXTRA,
      price: "180000.00",
      scope: "listing",
      listingId: listingRow!.id,
      perUnit: false,
      isActive: true,
    })
    .$returningId();
  const [promoRow] = await db
    .insert(promoCodes)
    .values({
      code: VERIFY_PROMO,
      discountType: "percent",
      discountValue: "10.00",
      validFrom: d("2019-01-01T00:00:00Z"),
      validUntil: d("2099-01-01T00:00:00Z"),
      maxUses: 2,
      usedCount: 0,
      isActive: true,
    })
    .$returningId();

  const ownerUser = await buildSessionUser(userRow!.id);
  return {
    ownerId: ownerRow!.id,
    ownerUser: ownerUser!,
    listingId: listingRow!.id,
    extraId: extraRow!.id,
    promoId: promoRow!.id,
  };
}

export async function runBookingMoneyChecks(r: CheckRunner): Promise<void> {
  const fx = await setup();

  /* ------------------------------------------------ availability / overlap */
  r.section("Motor de disponibilidad (una sola función de solapamiento)");

  const first = await createBooking({
    listingId: fx.listingId,
    guestName: "Huésped A",
    startAt: "2026-03-04",
    endAt: "2026-03-07",
    status: "confirmed",
    source: "manual",
  });
  r.check("se crea una reserva confirmada", first.booking.status === "confirmed");
  r.equal(
    "una estadía en fechas se normaliza al horario de check-in",
    first.booking.startAt.toISOString(),
    "2026-03-04T14:00:00.000Z",
  );
  r.equal(
    "y al de check-out",
    first.booking.endAt.toISOString(),
    "2026-03-07T11:00:00.000Z",
  );

  await r.throwsAsync(
    "una reserva solapada es RECHAZADA",
    () =>
      createBooking({
        listingId: fx.listingId,
        guestName: "Huésped B",
        startAt: "2026-03-05",
        endAt: "2026-03-09",
        status: "confirmed",
      }),
    "unavailable",
  );
  await r.throwsAsync(
    "una reserva que envuelve a otra es RECHAZADA",
    () =>
      createBooking({
        listingId: fx.listingId,
        guestName: "Huésped C",
        startAt: "2026-03-01",
        endAt: "2026-03-20",
        status: "confirmed",
      }),
    "unavailable",
  );

  const backToBack = await createBooking({
    listingId: fx.listingId,
    guestName: "Huésped D",
    startAt: "2026-03-07",
    endAt: "2026-03-09",
    status: "confirmed",
  });
  r.check(
    "check-in el mismo día del check-out anterior SÍ se acepta",
    backToBack.booking.status === "confirmed",
  );

  const inquiry = await createBooking({
    listingId: fx.listingId,
    guestName: "Huésped E",
    startAt: "2026-03-05",
    endAt: "2026-03-06",
    status: "inquiry",
  });
  r.check("una consulta sobre fechas ocupadas SÍ se registra (es un lead)", inquiry.booking.status === "inquiry");
  await r.throwsAsync(
    "pero confirmar esa consulta es RECHAZADO",
    () => transitionBooking(inquiry.booking.id, "confirmed"),
    "unavailable",
  );

  await r.throwsAsync(
    "bloquear fechas ya reservadas es RECHAZADO",
    () =>
      createBlock({
        listingId: fx.listingId,
        startAt: d("2026-03-05T00:00:00Z"),
        endAt: d("2026-03-06T00:00:00Z"),
        reason: "owner_use",
      }),
    "unavailable",
  );

  const ownerBlock = await createBlock({
    listingId: fx.listingId,
    startAt: d("2026-04-01T00:00:00Z"),
    endAt: d("2026-04-05T00:00:00Z"),
    reason: "owner_use",
    note: "Uso del propietario",
  });
  r.check("un bloqueo del propietario en fechas libres se crea", ownerBlock.id > 0);
  await r.throwsAsync(
    "reservar sobre un bloqueo del propietario es RECHAZADO",
    () =>
      createBooking({
        listingId: fx.listingId,
        guestName: "Huésped F",
        startAt: "2026-04-02",
        endAt: "2026-04-04",
        status: "confirmed",
      }),
    "unavailable",
  );

  await transitionBooking(backToBack.booking.id, "cancelled");
  const afterCancel = await createBooking({
    listingId: fx.listingId,
    guestName: "Huésped G",
    startAt: "2026-03-07",
    endAt: "2026-03-09",
    status: "confirmed",
  });
  r.check("cancelar libera las fechas para otra reserva", afterCancel.booking.status === "confirmed");
  await transitionBooking(afterCancel.booking.id, "cancelled");

  /* ------------------------------------------------------ iCal import (#2) */
  r.section("Sincronización iCal (importación idempotente + bloqueo real)");

  const [sourceRow] = await db
    .insert(icalSources)
    .values({
      listingId: fx.listingId,
      url: "https://example.invalid/verify.ics",
      label: "Verify Airbnb",
      isActive: true,
    })
    .$returningId();
  const source = { id: sourceRow!.id, listingId: fx.listingId, label: "Verify Airbnb" };

  const feedA = [
    { sourceRef: "uid-1@airbnb", startAt: d("2026-05-10T00:00:00Z"), endAt: d("2026-05-15T00:00:00Z"), note: "Reserved" },
    { sourceRef: "uid-2@airbnb", startAt: d("2026-06-01T00:00:00Z"), endAt: d("2026-06-03T00:00:00Z"), note: "Reserved" },
  ];
  const sync1 = await syncIcalBlocks(source, feedA);
  r.equal("primera sincronización crea 2 bloqueos", sync1.created, 2);

  const sync2 = await syncIcalBlocks(source, feedA);
  r.check(
    "re-sincronizar el mismo feed no cambia nada (idempotente)",
    sync2.created === 0 && sync2.updated === 0 && sync2.removed === 0,
    JSON.stringify(sync2),
  );
  const afterTwoSyncs = await db
    .select({ value: sql<number>`count(*)` })
    .from(availabilityBlocks)
    .where(
      and(
        eq(availabilityBlocks.listingId, fx.listingId),
        eq(availabilityBlocks.reason, "external_ical"),
      ),
    );
  r.equal("siguen existiendo exactamente 2 bloqueos importados", Number(afterTwoSyncs[0]!.value), 2);

  await r.throwsAsync(
    "reservar sobre un bloqueo IMPORTADO de iCal es RECHAZADO",
    () =>
      createBooking({
        listingId: fx.listingId,
        guestName: "Huésped H",
        startAt: "2026-05-12",
        endAt: "2026-05-14",
        status: "confirmed",
      }),
    "unavailable",
  );

  const sync3 = await syncIcalBlocks(source, [
    { ...feedA[0]!, endAt: d("2026-05-16T00:00:00Z") },
  ]);
  r.equal("un evento con fechas nuevas se actualiza en su lugar", sync3.updated, 1);
  r.equal("un evento que desapareció del feed se borra", sync3.removed, 1);

  const juneBooking = await createBooking({
    listingId: fx.listingId,
    guestName: "Huésped I",
    startAt: "2026-06-20",
    endAt: "2026-06-23",
    status: "confirmed",
  });
  const sync4 = await syncIcalBlocks(source, [
    { ...feedA[0]!, endAt: d("2026-05-16T00:00:00Z") },
    { sourceRef: "uid-3@airbnb", startAt: d("2026-06-21T00:00:00Z"), endAt: d("2026-06-22T00:00:00Z"), note: "Reserved" },
  ]);
  r.equal("un evento importado que choca con NUESTRA reserva se omite", sync4.skipped.length, 1);
  r.check(
    "y el motivo nombra la reserva que gana",
    sync4.skipped[0]!.reason.includes(juneBooking.booking.reference),
    sync4.skipped[0]!.reason,
  );
  r.equal("nada se creó para el evento omitido", sync4.created, 0);

  r.section("Exportación iCal");
  const occupied = await listOccupiedRanges(fx.listingId, {
    startAt: d("2026-01-01T00:00:00Z"),
    endAt: d("2027-01-01T00:00:00Z"),
  });
  r.check("la ventana de exportación ve reservas y bloqueos", occupied.length >= 3);
  const feed = buildIcs({
    name: "Casa de verificación O-2",
    events: occupied.map((entry) => ({
      uid: `${entry.kind}-${entry.id}@alquilar.com.py`,
      startAt: entry.startAt,
      endAt: entry.endAt,
      summary: entry.kind === "booking" ? "Reservado" : "No disponible",
    })),
  });
  r.check("el feed exportado incluye la reserva de junio", feed.includes("20260620T140000Z"));
  r.check("el feed exportado no filtra el nombre del huésped", !feed.includes("Huésped I"));

  /* ---------------------------------------------- precio / comisión reales */
  r.section("Precio y comisión sobre filas reales");

  const quote = await quoteForListing({
    listingId: fx.listingId,
    startAt: "2026-08-01",
    endAt: "2026-08-04",
    extras: [{ extraId: fx.extraId, qty: 1 }],
    promoCode: VERIFY_PROMO,
  });
  r.equal("base = 350.000 × 3 noches", quote.baseTotal, "1050000.00");
  r.equal("adicional listado", quote.extrasTotal, "180000.00");
  r.equal("descuento 10% sobre la base", quote.discountTotal, "105000.00");
  r.equal("total cotizado", quote.total, "1125000.00");
  r.equal("comisión toma el default del propietario (20%)", quote.commissionPct, "20.00");
  r.equal("comisión sobre bruto del propietario", quote.commissionAmount, "189000.00");
  r.equal("neto del propietario", quote.ownerNet, "756000.00");

  await r.throwsAsync(
    "un adicional de otra publicación es RECHAZADO",
    () =>
      quoteForListing({
        listingId: fx.listingId,
        startAt: "2026-08-01",
        endAt: "2026-08-04",
        extras: [{ extraId: fx.extraId + 100000, qty: 1 }],
      }),
    "extra_invalid",
  );

  const priced = await createBooking({
    listingId: fx.listingId,
    guestName: "Huésped J",
    startAt: "2026-08-01",
    endAt: "2026-08-04",
    status: "confirmed",
    extras: [{ extraId: fx.extraId, qty: 1 }],
    promoCode: VERIFY_PROMO,
  });
  r.equal("el precio queda snapshotado en la reserva", priced.booking.total, "1125000.00");
  r.equal("la comisión queda snapshotada", priced.booking.commissionAmount, "189000.00");
  r.equal("el % de comisión queda snapshotado", priced.booking.commissionPct, "20.00");
  const lines = await db
    .select()
    .from(bookingExtras)
    .where(eq(bookingExtras.bookingId, priced.booking.id));
  r.equal("el adicional guarda su propio snapshot", lines[0]!.nameSnapshot, VERIFY_EXTRA);

  const [promoAfter] = await db
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.id, fx.promoId))
    .limit(1);
  r.equal("usar el código consume un uso", promoAfter!.usedCount, 1);

  // The listing price is raised AFTER the booking: the snapshot must not move.
  await db.update(listings).set({ price: "999999.00" }).where(eq(listings.id, fx.listingId));
  const [reread] = await db.select().from(bookings).where(eq(bookings.id, priced.booking.id));
  r.equal(
    "cambiar el precio de la publicación NO reescribe la reserva",
    reread!.total,
    "1125000.00",
  );
  await db.update(listings).set({ price: "350000.00" }).where(eq(listings.id, fx.listingId));

  // A listing-level commission override wins over the owner default.
  await db.update(listings).set({ commissionPct: "30.00" }).where(eq(listings.id, fx.listingId));
  const overridden = await quoteForListing({
    listingId: fx.listingId,
    startAt: "2026-09-01",
    endAt: "2026-09-03",
  });
  r.equal("el override de la publicación gana sobre el default", overridden.commissionPct, "30.00");
  r.equal("comisión con override", overridden.commissionAmount, "210000.00");
  await db.update(listings).set({ commissionPct: null }).where(eq(listings.id, fx.listingId));

  r.section("Superficie pública vs. operador");
  await db.update(listings).set({ status: "draft" }).where(eq(listings.id, fx.listingId));
  await r.throwsAsync(
    "el público no puede cotizar una publicación en borrador",
    () =>
      quoteForListing({
        listingId: fx.listingId,
        startAt: "2026-10-01",
        endAt: "2026-10-03",
        requirePublished: true,
      }),
    "listing_unbookable",
  );
  const operatorBooking = await createBooking({
    listingId: fx.listingId,
    guestName: "Reserva histórica",
    startAt: "2026-10-01",
    endAt: "2026-10-03",
    status: "confirmed",
    source: "manual",
  });
  r.check(
    "pero el operador sí puede cargarla (alta de un propietario nuevo)",
    operatorBooking.booking.status === "confirmed",
  );
  await transitionBooking(operatorBooking.booking.id, "cancelled");
  await db.update(listings).set({ status: "published" }).where(eq(listings.id, fx.listingId));

  r.section("Máquina de estados sobre la base de datos");
  await r.throwsAsync(
    "inquiry → active es RECHAZADO",
    () => transitionBooking(inquiry.booking.id, "active"),
    "invalid_transition",
  );
  const activated = await transitionBooking(priced.booking.id, "active");
  r.equal("confirmed → active", activated.booking.status, "active");
  const completed = await transitionBooking(priced.booking.id, "completed");
  r.equal("active → completed", completed.booking.status, "completed");
  await r.throwsAsync(
    "completed es terminal",
    () => transitionBooking(priced.booking.id, "cancelled"),
    "invalid_transition",
  );

  await transitionBooking(inquiry.booking.id, "cancelled");
  const [promoReleased] = await db
    .select()
    .from(promoCodes)
    .where(eq(promoCodes.id, fx.promoId))
    .limit(1);
  r.equal("cancelar no devuelve un uso que la consulta nunca reclamó", promoReleased!.usedCount, 1);

  r.section("Alcance por propietario en las consultas nuevas");
  await r.throwsAsync(
    "un propietario no puede tocar la reserva de otro",
    () => assertCanAccessBooking(fx.ownerUser, 1),
    undefined,
  );
  await assertCanAccessBooking(fx.ownerUser, priced.booking.id);
  r.check("pero sí la propia", true);

  /* ------------------------------------------------------- estados de cuenta */
  r.section("Estados de cuenta (idempotencia)");

  // Two completed bookings and two expenses inside 2020-01, plus one expense in
  // 2020-02 that must NOT be billed on the January statement.
  const janA = await createBooking({
    listingId: fx.listingId,
    guestName: "Enero A",
    startAt: "2020-01-05",
    endAt: "2020-01-08",
    status: "confirmed",
    source: "manual",
  });
  await transitionBooking(janA.booking.id, "completed");
  const janB = await createBooking({
    listingId: fx.listingId,
    guestName: "Enero B",
    startAt: "2020-01-20",
    endAt: "2020-01-22",
    status: "confirmed",
    source: "manual",
  });
  await transitionBooking(janB.booking.id, "completed");

  await db.insert(expenses).values([
    {
      listingId: fx.listingId,
      category: "cleaning",
      amount: "120000.00",
      incurredOn: "2020-01-09",
      description: "Limpieza enero",
    },
    {
      listingId: fx.listingId,
      category: "repair",
      amount: "80000.00",
      incurredOn: "2020-01-25",
      description: "Reparación enero",
    },
    {
      listingId: fx.listingId,
      category: "supplies",
      amount: "50000.00",
      incurredOn: "2020-02-03",
      description: "Insumos febrero",
    },
  ]);

  const statement1 = await generateStatement(fx.ownerId, PERIOD);
  // 3 noches + 2 noches × 350.000 = 1.750.000 bruto; 20% = 350.000 comisión.
  r.equal("bruto del período", statement1.statement.grossTotal, "1750000.00");
  r.equal("comisión del período", statement1.statement.commissionTotal, "350000.00");
  r.equal("gastos del período (sin tocar febrero)", statement1.statement.expensesTotal, "200000.00");
  r.equal("neto = bruto − comisión − gastos", statement1.statement.netTotal, "1200000.00");
  r.equal("cantidad de reservas", statement1.statement.bookingCount, 2);
  r.equal("líneas de gasto", statement1.expenseLines.length, 2);

  const statement2 = await generateStatement(fx.ownerId, PERIOD);
  r.equal("regenerar reutiliza la MISMA fila", statement2.statement.id, statement1.statement.id);
  r.equal("bruto idéntico al regenerar", statement2.statement.grossTotal, statement1.statement.grossTotal);
  r.equal("comisión idéntica al regenerar", statement2.statement.commissionTotal, statement1.statement.commissionTotal);
  r.equal("gastos idénticos al regenerar (no se duplican)", statement2.statement.expensesTotal, statement1.statement.expensesTotal);
  r.equal("neto idéntico al regenerar", statement2.statement.netTotal, statement1.statement.netTotal);

  const statement3 = await generateStatement(fx.ownerId, PERIOD);
  r.equal("una tercera corrida sigue igual", statement3.statement.netTotal, statement1.statement.netTotal);
  const billed = await db
    .select({ value: sql<number>`count(*)` })
    .from(expenses)
    .where(
      and(eq(expenses.listingId, fx.listingId), eq(expenses.statementId, statement1.statement.id)),
    );
  r.equal("exactamente 2 gastos quedan marcados por este estado", Number(billed[0]!.value), 2);

  const february = await generateStatement(fx.ownerId, "2020-02");
  r.equal("febrero factura su propio gasto", february.statement.expensesTotal, "50000.00");
  r.equal("febrero no hereda reservas de enero", february.statement.bookingCount, 0);
  r.equal("neto de febrero es negativo (solo gastos)", february.statement.netTotal, "-50000.00");

  // A legacy/imported booking with no commission snapshot must still resolve a
  // rate — and the re-read must agree with the generated total, not show zero.
  await db
    .update(bookings)
    .set({ commissionPct: null, commissionAmount: null })
    .where(eq(bookings.id, janB.booking.id));
  const regenerated = await generateStatement(fx.ownerId, PERIOD);
  r.equal(
    "una reserva sin snapshot de comisión resuelve la tasa configurada",
    regenerated.statement.commissionTotal,
    "350000.00",
  );
  const legacyDetail = await getStatementDetail(statement1.statement.id);
  r.equal(
    "y la relectura muestra la MISMA comisión que el total generado",
    legacyDetail!.bookingLines.reduce(
      (sum, line) => sum + Number(line.commission),
      0,
    ),
    350000,
  );
  await db
    .update(bookings)
    .set({ commissionPct: "20.00", commissionAmount: "140000.00" })
    .where(eq(bookings.id, janB.booking.id));

  const detail = await getStatementDetail(statement1.statement.id);
  r.check("el estado se puede releer con sus líneas", detail?.bookingLines.length === 2);
  const html = renderStatementHtml(detail!);
  r.check("el HTML del estado se renderiza", html.startsWith("<!DOCTYPE html>"));
  r.check("y muestra el neto", html.includes("Neto a liquidar"));
  r.check("y nombra al propietario", html.includes("Verificación O-2"));

  /* ---------------------------------------------------------- depósitos (#9) */
  r.section("Ciclo de vida del depósito");

  const deposit = await createDeposit({ bookingId: priced.booking.id, amount: "1000000.00" });
  r.equal("el depósito nace retenido", deposit.status, "held");
  await r.throwsAsync(
    "una deducción mayor al depósito es RECHAZADA",
    () =>
      deductDeposit({
        depositId: deposit.id,
        deductionAmount: "1500000.00",
        reason: "Daño mayor",
      }),
    "deduction_too_large",
  );
  await r.throwsAsync(
    "una deducción sin motivo es RECHAZADA",
    () => deductDeposit({ depositId: deposit.id, deductionAmount: "100000.00", reason: "  " }),
    "invalid_amount",
  );
  await r.throwsAsync(
    "una deducción de cero es RECHAZADA",
    () => deductDeposit({ depositId: deposit.id, deductionAmount: "0", reason: "Nada" }),
    "invalid_amount",
  );
  const deducted = await deductDeposit({
    depositId: deposit.id,
    deductionAmount: "250000.00",
    reason: "Rayón en la puerta trasera",
  });
  r.equal("una deducción válida liquida el depósito", deducted.status, "deducted");
  r.equal("se guarda el monto deducido", deducted.deductionAmount, "250000.00");
  r.equal("y lo devuelto son 750.000", refundedAmount(deducted), "750000.00");
  await r.throwsAsync(
    "un depósito ya liquidado no se vuelve a liquidar",
    () => returnDeposit(deposit.id),
    "already_settled",
  );

  const janDeposit = await createDeposit({ bookingId: janA.booking.id, amount: "500000.00" });
  const returned = await returnDeposit(janDeposit.id);
  r.equal("un depósito devuelto queda en returned", returned.status, "returned");
  r.equal("y se devuelve entero", refundedAmount(returned), "500000.00");
  r.check(
    "el depósito se encuentra por reserva",
    (await getDepositForBooking(janA.booking.id))?.id === janDeposit.id,
  );

  /* ------------------------------------------------------ links de pago (#8) */
  r.section("Links de pago");

  const link = await createPaymentLink({
    bookingId: priced.booking.id,
    provider: "Bancard",
    amount: "500000.00",
    url: "https://pagos.example.com/verify",
  });
  r.equal("el link nace pendiente", link.status, "pending");
  const paid = await markPaymentLinkPaid(link.id);
  r.equal("marcar pagado funciona", paid.status, "paid");
  r.check("queda registrado quién y cuándo", paid.markedPaidAt !== null);
  await r.throwsAsync(
    "marcar pagado dos veces es RECHAZADO",
    () => markPaymentLinkPaid(link.id),
    "already_settled",
  );
  await r.throwsAsync(
    "un monto de cero es RECHAZADO",
    () => createPaymentLink({ bookingId: priced.booking.id, provider: "Bancard", amount: "0" }),
    "invalid_amount",
  );
  const expiring = await createPaymentLink({
    bookingId: priced.booking.id,
    provider: "QR Tigo",
    amount: "100000.00",
    expiresAt: d("2020-01-01T00:00:00Z"),
  });
  const expired = await expireOverduePaymentLinks();
  r.check("los links vencidos se marcan como expirados", expired >= 1);
  const [expiredRow] = await db
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.id, expiring.id))
    .limit(1);
  r.equal("y su estado es expired", expiredRow!.status, "expired");
  r.equal(
    "sólo lo pagado cuenta como cobrado",
    paidTotal([
      { amount: "500000.00", status: "paid" },
      { amount: "100000.00", status: "expired" },
      { amount: "300000.00", status: "pending" },
    ]),
    "500000.00",
  );

  r.section("Concurrencia — el candado, no la suerte, evita la sobreventa");
  // Four simultaneous requests for the same dates. The availability check runs
  // under FOR UPDATE inside the same transaction as its insert, so exactly one
  // may win; if this ever reports two, the lock has been lost and the engine is
  // silently double-booking under load.
  const raceStart = "2029-02-10";
  const raceResults = await Promise.all(
    [1, 2, 3, 4].map((n) =>
      createBooking({
        listingId: fx.listingId,
        guestName: `Carrera ${n}`,
        startAt: raceStart,
        endAt: "2029-02-14",
        status: "confirmed",
        source: "manual",
      }).then(
        () => "ok" as const,
        (error) => ((error as { code?: string }).code === "unavailable" ? ("busy" as const) : "err"),
      ),
    ),
  );
  r.equal(
    "de 4 reservas simultáneas exactamente 1 es aceptada",
    raceResults.filter((x) => x === "ok").length,
    1,
  );
  r.equal(
    "las otras 3 son rechazadas por disponibilidad (sin errores inesperados)",
    raceResults.filter((x) => x === "busy").length,
    3,
  );
  const survivors = await findConflicts({
    listingId: fx.listingId,
    startAt: d("2029-02-10T00:00:00Z"),
    endAt: d("2029-02-14T23:59:00Z"),
  });
  r.equal("y sólo una reserva quedó en la base", survivors.length, 1);

  r.section("Conflictos residuales");
  const remaining = await findConflicts({
    listingId: fx.listingId,
    startAt: d("2026-03-04T00:00:00Z"),
    endAt: d("2026-03-08T00:00:00Z"),
  });
  r.equal("la reserva original sigue ocupando sus fechas", remaining.length, 1);
  r.equal("y es la de Huésped A", (remaining[0] as { reference: string }).reference, first.booking.reference);

  await teardown();
  r.check("las filas de verificación se limpian al terminar", true);
}
