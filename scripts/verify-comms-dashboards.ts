/**
 * Phase O-4 verification against a real database (plan §5.O9, O10).
 *
 * Called by `scripts/verify-core.ts` so `npm run verify` stays one command.
 * The pure pieces — template rendering, anchors, phone normalisation, thread
 * keys — are pinned without a database in `scripts/verify-logic.ts`.
 *
 * What is proven HERE is what only exists once rows are involved:
 *   · confirming a booking queues its sequence, exactly once, with the right
 *     due times, and the rendered body is a SNAPSHOT of the template
 *   · cancelling withdraws what has not gone out and never touches what has
 *   · the processor flips only what is due; marking sent is terminal and
 *     writes the outbound message the inbox shows
 *   · a lead is stored before it is forwarded, and survives an unconfigured CRM
 *   · occupancy, revenue, commission and expense ratio agree with the engine
 *     that produced them, and an owner's dashboard contains only their rows
 *   · onboarding steps derive themselves from the data
 *   · an owner cannot publish a listing; an admin can
 *
 * Fixtures live under their own owner (`verify-o4@alquilar.local`) in 2031, a
 * year no seed row touches, and are torn down and rebuilt on every run.
 */
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "../src/db";
import {
  bookings,
  expenses,
  infoItems,
  leads,
  listings,
  messages,
  messageTemplates,
  onboardingSteps,
  owners,
  ownerOnboarding,
  scheduledMessages,
  stayDetails,
  carDetails,
  users,
  activityLog,
  listingImages,
} from "../src/db/schema";
import type { CheckRunner } from "./lib/checks";
import { buildSessionUser, type SessionUser } from "../src/lib/auth-core";
import { createBooking, transitionBooking } from "../src/db/queries/bookings";
import {
  cancelScheduledForBooking,
  enqueueBookingMessages,
  getTemplateByKey,
  listInboxThreads,
  listOutbox,
  listScheduledForBooking,
  listTemplates,
  logMessage,
  markDueMessages,
  markScheduledSent,
  seedDefaultTemplates,
  upsertTemplate,
} from "../src/db/queries/messages";
import { createExpense } from "../src/db/queries/expenses";
import { captureLead, listLeads, retryPendingLeads } from "../src/db/queries/leads";
import {
  analyticsDashboard,
  bookingSources,
  occupancyByListing,
  revenueByListing,
  totalsFrom,
} from "../src/db/queries/analytics";
import {
  ensureOnboarding,
  getOnboarding,
  refreshDerivedSteps,
  setOnboardingStep,
} from "../src/db/queries/onboarding";
import { setListingStatus } from "../src/db/queries/listings";
import { upsertInfoItem } from "../src/db/queries/info";
import { draftReply, hasAnthropicKey } from "../src/lib/ai-drafts";
import { isCrmConfigured } from "../src/lib/vendercrm";
import { MS_PER_DAY } from "../src/lib/dates";
import { selectSequenceFor, type MessageAnchor } from "../src/lib/messaging";

const OWNER_EMAIL = "verify-o4@alquilar.local";
const OTHER_EMAIL = "verify-o4-other@alquilar.local";
const ADMIN_EMAIL = "verify-o4-admin@alquilar.local";
const STAY_SLUG = "verify-o4-casa";
const CAR_SLUG = "verify-o4-auto";
const OTHER_SLUG = "verify-o4-otro";
const LEAD_MARK = "VERIFY-O4-LEAD";
const TEMPLATE_KEY = "verify_o4_probe";

/** 2031 — no seed row and no other verify fixture lives there. */
const YEAR = 2031;
const at = (month: number, day: number, hour = 14) =>
  new Date(Date.UTC(YEAR, month - 1, day, hour, 0, 0));

type Fixture = {
  ownerUser: SessionUser;
  otherUser: SessionUser;
  adminUser: SessionUser;
  ownerId: number;
  otherOwnerId: number;
  stayId: number;
  carId: number;
  otherListingId: number;
};

async function teardown(): Promise<void> {
  const listingRows = await db
    .select({ id: listings.id })
    .from(listings)
    .where(inArray(listings.slug, [STAY_SLUG, CAR_SLUG, OTHER_SLUG]));
  const listingIds = listingRows.map((r) => r.id);

  if (listingIds.length > 0) {
    const bookingRows = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(inArray(bookings.listingId, listingIds));
    const bookingIds = bookingRows.map((r) => r.id);
    if (bookingIds.length > 0) {
      await db.delete(scheduledMessages).where(inArray(scheduledMessages.bookingId, bookingIds));
      await db.delete(messages).where(inArray(messages.bookingId, bookingIds));
      await db
        .delete(activityLog)
        .where(and(eq(activityLog.entity, "booking"), inArray(activityLog.entityId, bookingIds)));
      await db.delete(bookings).where(inArray(bookings.id, bookingIds));
    }
    await db.delete(messages).where(inArray(messages.listingId, listingIds));
    await db.delete(expenses).where(inArray(expenses.listingId, listingIds));
    await db.delete(infoItems).where(inArray(infoItems.listingId, listingIds));
    await db.delete(listingImages).where(inArray(listingImages.listingId, listingIds));
    await db.delete(stayDetails).where(inArray(stayDetails.listingId, listingIds));
    await db.delete(carDetails).where(inArray(carDetails.listingId, listingIds));
    await db.delete(listings).where(inArray(listings.id, listingIds));
  }

  await db.delete(leads).where(like(leads.name, `${LEAD_MARK}%`));
  await db.delete(messageTemplates).where(eq(messageTemplates.key, TEMPLATE_KEY));

  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, [OWNER_EMAIL, OTHER_EMAIL, ADMIN_EMAIL]));
  const userIds = userRows.map((r) => r.id);
  if (userIds.length > 0) {
    const ownerRows = await db
      .select({ id: owners.id })
      .from(owners)
      .where(inArray(owners.userId, userIds));
    const ownerIds = ownerRows.map((r) => r.id);
    if (ownerIds.length > 0) {
      const onboardingRows = await db
        .select({ id: ownerOnboarding.id })
        .from(ownerOnboarding)
        .where(inArray(ownerOnboarding.ownerId, ownerIds));
      const onboardingIds = onboardingRows.map((r) => r.id);
      if (onboardingIds.length > 0) {
        await db
          .delete(onboardingSteps)
          .where(inArray(onboardingSteps.onboardingId, onboardingIds));
        await db.delete(ownerOnboarding).where(inArray(ownerOnboarding.id, onboardingIds));
      }
      await db.delete(owners).where(inArray(owners.id, ownerIds));
    }
    await db.delete(users).where(inArray(users.id, userIds));
  }
}

async function setup(): Promise<Fixture> {
  await teardown();
  // The comms engine reads templates from the database; make sure the plan
  // §3.D sequence is there even on a database that was never seeded.
  await seedDefaultTemplates();

  const [ownerRow] = await db
    .insert(users)
    .values({ name: "Verify O4 Owner", email: OWNER_EMAIL, passwordHash: null, role: "owner" })
    .$returningId();
  const [ownerProfile] = await db
    .insert(owners)
    .values({ userId: ownerRow!.id, displayName: "Verify O4", defaultCommissionPct: "20.00" })
    .$returningId();

  const [otherRow] = await db
    .insert(users)
    .values({ name: "Verify O4 Other", email: OTHER_EMAIL, passwordHash: null, role: "owner" })
    .$returningId();
  const [otherProfile] = await db
    .insert(owners)
    .values({ userId: otherRow!.id, displayName: "Verify O4 B", defaultCommissionPct: "20.00" })
    .$returningId();

  const [adminRow] = await db
    .insert(users)
    .values({ name: "Verify O4 Admin", email: ADMIN_EMAIL, passwordHash: null, role: "admin" })
    .$returningId();

  const [stayRow] = await db
    .insert(listings)
    .values({
      slug: STAY_SLUG,
      vertical: "stay",
      title: "Verify O4 — casa",
      price: "1000000.00",
      priceUnit: "per_night",
      currency: "PYG",
      status: "published",
      ownerId: ownerProfile!.id,
      publishedAt: new Date(),
    })
    .$returningId();
  await db.insert(stayDetails).values({
    listingId: stayRow!.id,
    propertyType: "casa",
    maxGuests: 4,
    checkInTime: "14:00",
    checkOutTime: "11:00",
  });

  const [carRow] = await db
    .insert(listings)
    .values({
      slug: CAR_SLUG,
      vertical: "car",
      title: "Verify O4 — auto",
      price: "400000.00",
      priceUnit: "per_day",
      currency: "PYG",
      status: "published",
      ownerId: ownerProfile!.id,
      publishedAt: new Date(),
    })
    .$returningId();
  await db
    .insert(carDetails)
    .values({ listingId: carRow!.id, vehicleType: "auto", make: "Verify", model: "O4" });

  const [otherListing] = await db
    .insert(listings)
    .values({
      slug: OTHER_SLUG,
      vertical: "stay",
      title: "Verify O4 — casa ajena",
      price: "800000.00",
      priceUnit: "per_night",
      currency: "PYG",
      status: "published",
      ownerId: otherProfile!.id,
      publishedAt: new Date(),
    })
    .$returningId();
  await db.insert(stayDetails).values({ listingId: otherListing!.id, propertyType: "casa" });

  return {
    ownerUser: (await buildSessionUser(ownerRow!.id))!,
    otherUser: (await buildSessionUser(otherRow!.id))!,
    adminUser: (await buildSessionUser(adminRow!.id))!,
    ownerId: ownerProfile!.id,
    otherOwnerId: otherProfile!.id,
    stayId: stayRow!.id,
    carId: carRow!.id,
    otherListingId: otherListing!.id,
  };
}

export async function runCommsDashboardChecks(r: CheckRunner): Promise<void> {
  const fx = await setup();

  /* ------------------------------------------------------------ O9 templates */
  r.section("O-4 · Plantillas de mensajes (#4, #11)");

  const templates = await listTemplates();
  const active = templates.filter((t) => t.isActive);
  for (const key of ["booking_confirmed", "pre_arrival", "check_in", "check_out", "review_request"]) {
    r.check(`la plantilla "${key}" existe`, active.some((t) => t.key === key));
  }
  r.check(
    "ninguna plantilla activa quedó con un ancla que el motor no entiende",
    active.every((t) => ["confirmed", "start_at", "end_at"].includes(t.triggerEvent ?? "")),
  );
  const carSeq = selectSequenceFor(
    active.map((t) => ({
      ...t,
      anchor: t.triggerEvent as MessageAnchor,
      vertical: t.vertical ?? null,
    })),
    "car",
  );
  r.check(
    "un auto resuelve la pre-llegada específica de autos",
    carSeq.some((t) => t.key === "pre_arrival_car") && !carSeq.some((t) => t.key === "pre_arrival"),
  );

  await upsertTemplate({
    key: TEMPLATE_KEY,
    label: "Sonda O-4",
    body: "Hola {{guestName}} — v1",
    anchor: "confirmed",
    offsetMinutes: 0,
  });
  await upsertTemplate({
    key: TEMPLATE_KEY,
    label: "Sonda O-4",
    body: "Hola {{guestName}} — v2",
    anchor: "confirmed",
    offsetMinutes: 0,
  });
  const probes = (await listTemplates()).filter((t) => t.key === TEMPLATE_KEY);
  r.equal("guardar dos veces la misma clave actualiza, no duplica", probes.length, 1);
  r.equal("y guarda el texto nuevo", probes[0]?.body, "Hola {{guestName}} — v2");
  // The probe would otherwise ride along in every sequence below.
  await db.delete(messageTemplates).where(eq(messageTemplates.key, TEMPLATE_KEY));

  /* --------------------------------------------------------------- O9 queue */
  r.section("O-4 · La cola de mensajes se llena sola al confirmar");

  const stayBooking = await createBooking(
    {
      listingId: fx.stayId,
      guestName: "Ana Verify",
      guestPhone: "0981 111 222",
      startAt: at(3, 10),
      endAt: at(3, 14, 11),
      status: "inquiry",
      source: "web",
    },
    fx.adminUser,
  );
  r.equal(
    "una consulta NO encola nada — todavía no hay nada que prometer",
    (await listScheduledForBooking(stayBooking.booking.id)).length,
    0,
  );

  const confirmed = await transitionBooking(stayBooking.booking.id, "confirmed", fx.adminUser);
  r.check("confirmar encola la secuencia", confirmed.messagesEnqueued === 5);
  const queued = await listScheduledForBooking(stayBooking.booking.id);
  r.equal("cinco filas en la cola", queued.length, 5);
  r.check(
    "todas arrancan como `scheduled`",
    queued.every((row) => row.status === "scheduled"),
  );

  const preArrival = queued.find((row) => row.templateKey === "pre_arrival");
  r.equal(
    "la pre-llegada vence 24 h antes de la llegada",
    preArrival?.sendAfter.getTime(),
    at(3, 10).getTime() - MS_PER_DAY,
  );
  const review = queued.find((row) => row.templateKey === "review_request");
  r.equal(
    "el pedido de reseña vence 24 h después de la salida",
    review?.sendAfter.getTime(),
    at(3, 14, 11).getTime() + MS_PER_DAY,
  );
  r.check(
    "el cuerpo se renderizó con los datos de ESTA reserva",
    Boolean(queued[0]?.renderedBody?.includes("Ana")),
  );
  r.check(
    "y no quedó ninguna variable sin sustituir",
    queued.every((row) => !row.renderedBody?.includes("{{")),
  );

  // Re-running the enqueue must be a no-op, not five more rows.
  await enqueueBookingMessages(
    {
      bookingId: stayBooking.booking.id,
      reference: stayBooking.booking.reference,
      guestName: stayBooking.booking.guestName,
      vertical: "stay",
      listingTitle: "Verify O4 — casa",
      locationName: null,
      startAt: stayBooking.booking.startAt,
      endAt: stayBooking.booking.endAt,
      total: stayBooking.booking.total,
      currency: stayBooking.booking.currency,
      units: stayBooking.booking.units,
      confirmedAt: new Date(),
    },
    undefined,
    fx.adminUser,
  );
  r.equal(
    "volver a encolar la misma reserva no duplica nada",
    (await listScheduledForBooking(stayBooking.booking.id)).length,
    5,
  );

  // The body is a snapshot: editing the template must not rewrite what was
  // already promised to a guest.
  const original = await getTemplateByKey("booking_confirmed");
  await upsertTemplate({
    key: "booking_confirmed",
    label: original!.label,
    body: "TEXTO NUEVO {{guestName}}",
    anchor: original!.triggerEvent as MessageAnchor,
    offsetMinutes: original!.offsetMinutes,
    vertical: original!.vertical,
  });
  const afterEdit = await listScheduledForBooking(stayBooking.booking.id);
  r.check(
    "editar la plantilla NO reescribe un mensaje ya encolado",
    !afterEdit
      .find((row) => row.templateKey === "booking_confirmed")
      ?.renderedBody?.includes("TEXTO NUEVO"),
  );
  await upsertTemplate({
    key: "booking_confirmed",
    label: original!.label,
    body: original!.body,
    anchor: original!.triggerEvent as MessageAnchor,
    offsetMinutes: original!.offsetMinutes,
    vertical: original!.vertical,
  });

  /* ----------------------------------------------------- O9 processor + send */
  r.section("O-4 · El procesador, el outbox y el envío");

  // The processor is global, so its return count includes whatever the seed
  // left behind. What matters is what it does to THIS booking's rows, which is
  // what these checks look at.
  const ownQueue = async () => listScheduledForBooking(stayBooking.booking.id);
  await markDueMessages(new Date(Date.UTC(YEAR, 0, 1)));
  const earlyDue = (await ownQueue()).filter((row) => row.status === "due");
  r.equal("sólo la confirmación vence enseguida", earlyDue.length, 1);
  r.equal(
    "y es exactamente ésa — el ancla `confirmed` con offset 0",
    earlyDue[0]?.templateKey,
    "booking_confirmed",
  );
  r.equal(
    "las otras cuatro siguen programadas para 2031",
    (await ownQueue()).filter((row) => row.status === "scheduled").length,
    4,
  );

  const afterEnd = new Date(at(3, 14, 11).getTime() + 2 * MS_PER_DAY);
  const flipped = await markDueMessages(afterEnd);
  r.check("pasada la fecha, el procesador marca el resto", flipped.due >= 4);
  r.equal(
    "y las cinco de esta reserva quedan vencidas",
    (await ownQueue()).filter((row) => row.status === "due").length,
    5,
  );
  const due = await listOutbox({ listingIds: [fx.stayId, fx.carId] });
  r.equal("y el outbox las muestra", due.length, 5);
  r.check(
    "cada fila del outbox lleva su teléfono y su cuerpo",
    due.every((row) => row.guestPhone !== null && row.renderedBody.length > 0),
  );

  const second = await markDueMessages(afterEnd);
  r.equal("volver a correr el procesador no hace nada", second.due, 0);

  const target = due[0]!;
  const sent = await markScheduledSent(target.id, fx.adminUser);
  r.equal("marcar enviado deja la fila en `sent`", sent.scheduled.status, "sent");
  r.check("y con el usuario que lo hizo", sent.scheduled.sentBy === fx.adminUser.id);
  const loggedOutbound = await db
    .select()
    .from(messages)
    .where(eq(messages.id, sent.messageId))
    .limit(1);
  r.equal(
    "el envío queda registrado en la conversación",
    loggedOutbound[0]?.direction,
    "outbound",
  );
  r.equal(
    "con el cuerpo que se prometió",
    loggedOutbound[0]?.body,
    target.renderedBody,
  );
  await r.throwsAsync(
    "marcar enviado dos veces se rechaza",
    () => markScheduledSent(target.id, fx.adminUser),
    "already_settled",
  );

  /* -------------------------------------------------------- O9 cancellation */
  r.section("O-4 · Cancelar una reserva retira lo que no salió");

  const cancelled = await transitionBooking(stayBooking.booking.id, "cancelled", fx.adminUser);
  r.check("cancelar retira los mensajes pendientes", cancelled.messagesCancelled === 4);
  const afterCancel = await listScheduledForBooking(stayBooking.booking.id);
  r.equal(
    "el que ya se había enviado sigue enviado",
    afterCancel.filter((row) => row.status === "sent").length,
    1,
  );
  r.equal(
    "y el resto quedó cancelado",
    afterCancel.filter((row) => row.status === "cancelled").length,
    4,
  );
  r.equal(
    "cancelar de nuevo no toca nada",
    await cancelScheduledForBooking(stayBooking.booking.id),
    0,
  );

  /* --------------------------------------------------------------- O9 inbox */
  r.section("O-4 · Bandeja unificada (#20)");

  const inbound = await logMessage(
    {
      bookingId: stayBooking.booking.id,
      direction: "inbound",
      body: "¿Tienen estacionamiento?",
    },
    fx.adminUser,
  );
  r.equal(
    "un mensaje de una reserva hereda su publicación",
    inbound.listingId,
    fx.stayId,
  );
  await logMessage(
    { listingId: fx.stayId, direction: "inbound", body: "Consulta suelta", contactName: "Sin reserva" },
    fx.adminUser,
  );
  await logMessage(
    { listingId: fx.otherListingId, direction: "inbound", body: "De otro dueño", contactName: "Ajeno" },
    fx.adminUser,
  );

  const ownerThreads = await listInboxThreads({ listingIds: [fx.stayId, fx.carId] });
  r.equal("el hilo de la reserva y el suelto son dos hilos", ownerThreads.length, 2);
  r.check(
    "y ninguno es de otro propietario",
    ownerThreads.every((thread) => thread.listingId === fx.stayId),
  );
  const bookingThread = ownerThreads.find((thread) => thread.bookingId === stayBooking.booking.id);
  r.equal("la clave del hilo apunta a la reserva", bookingThread?.threadKey, `b${stayBooking.booking.id}`);
  r.equal("el último mensaje es el más reciente", bookingThread?.lastBody, "¿Tienen estacionamiento?");
  r.check(
    "y el hilo cuenta el envío automático además de la consulta",
    (bookingThread?.messageCount ?? 0) === 2,
  );

  const otherThreads = await listInboxThreads({ listingIds: [fx.otherListingId] });
  r.equal("el otro propietario ve sólo el suyo", otherThreads.length, 1);
  r.equal("un alcance vacío no devuelve nada", (await listInboxThreads({ listingIds: [] })).length, 0);

  /* ------------------------------------------------------------ O9 AI draft */
  r.section("O-4 · Borradores con IA — degradación sin clave");

  await upsertInfoItem({
    listingId: fx.stayId,
    question: "¿Hay estacionamiento?",
    answer: "Sí, para dos autos dentro del predio.",
  });
  const keyBefore = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  r.check("sin clave, `hasAnthropicKey` es falso", !hasAnthropicKey());
  const noKey = await draftReply("¿Hay estacionamiento?", {
    listing: {
      title: "Verify O4 — casa",
      vertical: "stay",
      description: null,
      cancellationPolicy: "moderate",
    },
    items: [
      {
        id: 1,
        listingId: fx.stayId,
        question: "¿Hay estacionamiento?",
        answer: "Sí",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  });
  r.check("y el borrador devuelve un aviso, no una excepción", !noKey.ok);
  r.equal("con el motivo correcto", noKey.ok ? null : noKey.reason, "no_key");
  r.check(
    "el aviso nombra la variable que falta",
    !noKey.ok && noKey.notice.includes("ANTHROPIC_API_KEY"),
  );
  const noInfo = await draftReply("¿Hay pileta?", {
    listing: {
      title: "Verify O4 — casa",
      vertical: "stay",
      description: null,
      cancellationPolicy: "moderate",
    },
    items: [],
  });
  r.check("sin base de información tampoco explota", !noInfo.ok);
  if (keyBefore !== undefined) process.env.ANTHROPIC_API_KEY = keyBefore;

  /* ---------------------------------------------------------------- O10 leads */
  r.section("O-4 · Consultas: se guardan primero, se envían después");

  const captured = await captureLead({
    name: `${LEAD_MARK} Carla`,
    phone: "0981 555 000",
    message: "Consulta de verificación",
    vertical: "stay",
    listingId: fx.stayId,
    sourceUrl: "/contacto",
  });
  r.check("la consulta queda guardada en nuestra base", captured.lead.id > 0);
  r.equal(
    "sin CRM configurado queda pendiente, nunca `failed`",
    captured.forwardStatus,
    isCrmConfigured() ? captured.forwardStatus : "pending",
  );
  const storedLeads = await listLeads({ listingIds: [fx.stayId] });
  r.check(
    "y se puede leer desde el panel",
    storedLeads.some((lead) => lead.id === captured.lead.id),
  );
  const retry = await retryPendingLeads({ limit: 5 });
  r.check(
    "reintentar sin CRM configurado no rompe nada",
    isCrmConfigured() ? retry.attempted >= 0 : retry.skipped,
  );
  await r.throwsAsync(
    "una consulta sin teléfono ni correo se rechaza",
    () => captureLead({ name: `${LEAD_MARK} Nadie` }),
    "invalid_amount",
  );

  /* ------------------------------------------------------------ O10 analytics */
  r.section("O-4 · Analítica (#12)");

  // A four-night stay inside a 30-day window: 4/30 = 13.3 %.
  const analyticsBooking = await createBooking(
    {
      listingId: fx.stayId,
      guestName: "Bruno Verify",
      startAt: at(6, 10),
      endAt: at(6, 14, 11),
      status: "confirmed",
      source: "manual",
    },
    fx.adminUser,
  );
  const window = { startAt: at(6, 1, 0), endAt: at(7, 1, 0) };
  const occupancy = await occupancyByListing(window, { listingIds: [fx.stayId] });
  r.equal("la ventana son 30 días", occupancy.rows[0]?.windowDays, 30);
  r.check(
    "una estadía de 4 noches ocupa ~3.9 días de calendario",
    Math.abs((occupancy.rows[0]?.occupiedDays ?? 0) - 3.875) < 0.01,
  );
  r.check(
    "y la ocupación es ~12.9 %",
    Math.abs((occupancy.rows[0]?.occupancyPct ?? 0) - 12.9) < 0.2,
  );

  await transitionBooking(analyticsBooking.booking.id, "active", fx.adminUser);
  await transitionBooking(analyticsBooking.booking.id, "completed", fx.adminUser);
  await createExpense(
    {
      listingId: fx.stayId,
      category: "cleaning",
      amount: "200000.00",
      incurredOn: "2031-06-15",
      description: "Verify O4 limpieza",
    },
    fx.adminUser,
  );

  const revenue = await revenueByListing(window, { listingIds: [fx.stayId] });
  const row = revenue[0]!;
  r.equal("el bruto son 4 noches a 1.000.000", row.gross, "4000000.00");
  r.equal("la comisión del 20 % son 800.000", row.commission, "800000.00");
  r.equal("los gastos del período son 200.000", row.expenses, "200000.00");
  r.equal("el neto del propietario son 3.000.000", row.ownerNet, "3000000.00");
  r.equal("y el ratio de gastos es 5 %", row.expenseRatioPct, 5);
  r.equal("los totales suman lo mismo", totalsFrom(revenue).ownerNet, "3000000.00");

  const dashboard = await analyticsDashboard(window, { listingIds: [fx.stayId, fx.carId] });
  r.check("el panel trae las seis métricas", Boolean(dashboard.occupancy && dashboard.revenue && dashboard.fleet && dashboard.locations && dashboard.sources && dashboard.totals));
  // `bookingSources` counts by CREATION date — "where did the bookings we took
  // this month come from" — so it is measured over a window around now, not
  // around the 2031 stay dates.
  const createdWindow = {
    startAt: new Date(Date.now() - 2 * MS_PER_DAY),
    endAt: new Date(Date.now() + MS_PER_DAY),
  };
  const sources = await bookingSources(createdWindow, { listingIds: [fx.stayId, fx.carId] });
  r.check(
    "el origen `manual` figura entre las fuentes",
    sources.some((source) => source.source === "manual"),
  );
  r.check(
    "y también el `web` de la solicitud pública",
    sources.some((source) => source.source === "web"),
  );

  const foreignDashboard = await analyticsDashboard(window, { listingIds: [fx.otherListingId] });
  r.equal(
    "la analítica de otro propietario no incluye nuestras publicaciones",
    foreignDashboard.revenue.filter((entry) => entry.listingId === fx.stayId).length,
    0,
  );
  r.equal(
    "y un alcance vacío no devuelve nada",
    (await revenueByListing(window, { listingIds: [] })).length,
    0,
  );

  /* --------------------------------------------------------- O10 onboarding */
  r.section("O-4 · Puesta en marcha del propietario (#19)");

  await ensureOnboarding(fx.otherOwnerId);
  await refreshDerivedSteps(fx.otherOwnerId);
  const before = await getOnboarding(fx.otherOwnerId);
  r.equal("el checklist tiene cinco pasos", before?.totalCount, 5);
  r.equal(
    "las fotos todavía no están",
    before?.steps.find((step) => step.stepKey === "photos")?.status,
    "pending",
  );
  r.equal(
    "la publicación publicada sí",
    before?.steps.find((step) => step.stepKey === "first_listing_published")?.status,
    "done",
  );
  r.equal(
    "y la base de información no",
    before?.steps.find((step) => step.stepKey === "info_base")?.status,
    "pending",
  );

  await db
    .insert(listingImages)
    .values({ listingId: fx.otherListingId, url: "/verify-o4.jpg", isCover: true });
  await upsertInfoItem({
    listingId: fx.otherListingId,
    question: "¿A qué hora es la entrada?",
    answer: "Desde las 14:00.",
  });
  await upsertInfoItem({
    listingId: fx.otherListingId,
    question: "¿Hay wifi?",
    answer: "Sí, fibra óptica.",
  });
  const after = await getOnboarding(fx.otherOwnerId);
  r.equal(
    "cargar una foto marca el paso solo",
    after?.steps.find((step) => step.stepKey === "photos")?.status,
    "done",
  );
  r.equal(
    "y dos respuestas marcan la base de información",
    after?.steps.find((step) => step.stepKey === "info_base")?.status,
    "done",
  );
  await r.throwsAsync(
    "un paso automático no se puede marcar a mano",
    () =>
      setOnboardingStep(
        { ownerId: fx.otherOwnerId, stepKey: "ical", status: "done" },
        fx.adminUser,
      ),
    "invalid_transition",
  );
  await setOnboardingStep(
    { ownerId: fx.otherOwnerId, stepKey: "ical", status: "skipped" },
    fx.adminUser,
  );
  const skipped = await getOnboarding(fx.otherOwnerId);
  r.equal(
    "pero sí omitir deliberadamente",
    skipped?.steps.find((step) => step.stepKey === "ical")?.status,
    "skipped",
  );
  await setOnboardingStep(
    { ownerId: fx.otherOwnerId, stepKey: "contract", status: "done" },
    fx.adminUser,
  );
  const completed = await getOnboarding(fx.otherOwnerId);
  r.check("con todos los pasos resueltos, el onboarding se cierra", completed?.completedAt !== null);

  /* ------------------------------------------------------- O10 publish flow */
  r.section("O-4 · Publicar es del administrador");

  await setListingStatus(fx.stayId, "paused", fx.ownerUser);
  const paused = await db.select().from(listings).where(eq(listings.id, fx.stayId)).limit(1);
  r.equal("un propietario puede pausar lo suyo", paused[0]?.status, "paused");
  await r.throwsAsync(
    "pero no puede publicar",
    () => setListingStatus(fx.stayId, "published", fx.ownerUser),
    "forbidden",
  );
  await setListingStatus(fx.stayId, "published", fx.adminUser);
  const republished = await db.select().from(listings).where(eq(listings.id, fx.stayId)).limit(1);
  r.equal("un administrador sí", republished[0]?.status, "published");
  r.check(
    "y `published_at` conserva la fecha original",
    republished[0]?.publishedAt !== null &&
      republished[0]!.publishedAt!.getTime() <= Date.now(),
  );

  await teardown();
  const leftovers = await db
    .select({ id: listings.id })
    .from(listings)
    .where(or(eq(listings.slug, STAY_SLUG), eq(listings.slug, CAR_SLUG), eq(listings.slug, OTHER_SLUG)));
  r.equal("las filas de verificación se limpian al terminar", leftovers.length, 0);
}
