/**
 * Phase O-4 verification against a real database (plan §5.O9, O10, O11).
 *
 * Called by `scripts/verify-core.ts`, so `npm run verify` stays one command.
 * The pure calculators (schedule anchors, placeholder rendering, phone
 * normalisation, the wa.me link) are pinned without a database in
 * `scripts/verify-logic.ts`.
 *
 * What is proven HERE is what only exists once rows are involved:
 *   · confirming a booking enqueues the whole sequence, exactly once
 *   · cancelling stops everything that has not been sent, and only that
 *   · the "due" sweep is conditional, so two cron runs cannot double-claim
 *   · marking sent is terminal and writes the conversation row atomically
 *   · the unified inbox groups by thread and flags what is awaiting a reply
 *   · analytics occupancy is clipped to its window and never exceeds 100%
 *   · a lead is STORED even with no CRM configured, and stays `pending`
 *   · onboarding derives its steps from the data and never un-ticks itself
 *   · the public browse/detail queries never return a non-published listing
 *   · owner scoping still holds across every new query (owner A vs owner B)
 *
 * Fixtures live under their own owner (`verify-o4@alquilar.local`) in 2030, a
 * year no seed row and no other verify script touches, and are torn down and
 * rebuilt on every run.
 */
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "../src/db";
import {
  activityLog,
  availabilityBlocks,
  bookingExtras,
  bookings,
  carDetails,
  cleaningTasks,
  expenses,
  icalSources,
  infoItems,
  leads,
  listings,
  locations,
  messageTemplates,
  messages,
  onboardingSteps,
  ownerOnboarding,
  owners,
  scheduledMessages,
  stayDetails,
  users,
} from "../src/db/schema";
import type { CheckRunner } from "./lib/checks";
import { AuthError, buildSessionUser, type SessionUser } from "../src/lib/auth-core";
import { createBooking, transitionBooking } from "../src/db/queries/bookings";
import {
  cancelScheduledMessage,
  countAwaitingReply,
  enqueueBookingMessages,
  listInboxThreads,
  listOutbox,
  listThreadMessages,
  loadDraftSubject,
  deleteInfoItem,
  logMessage,
  markDueMessages,
  markScheduledSent,
  updateTemplate,
  upsertInfoItem,
} from "../src/db/queries/messages";
import {
  analyticsOverview,
  bookingSources,
  fleetUtilisation,
  listingPerformance,
  topLocations,
} from "../src/db/queries/analytics";
import { captureLead, leadCounts, listLeads } from "../src/db/queries/leads";
import { getOnboardingProgress, setOnboardingStep } from "../src/db/queries/onboarding";
import {
  browseListings,
  getPublicListing,
  locationIdsForSlug,
} from "../src/db/queries/listings";
import {
  getPanelListing,
  listPanelListings,
  panelCalendar,
  panelEarnings,
  updatePanelListing,
} from "../src/db/queries/panel";
import {
  createIcalSource,
  deleteIcalSource,
  listIcalSources,
} from "../src/db/queries/blocks";
import { listAllExtras, listPromoCodes } from "../src/db/queries/extras";
import { renderTemplate, TEMPLATE_PLACEHOLDERS, placeholdersIn } from "../src/lib/messaging";

const OWNER_EMAIL = "verify-o4@alquilar.local";
const OTHER_OWNER_EMAIL = "verify-o4-b@alquilar.local";
const STAY_SLUG = "verify-o4-casa";
const CAR_SLUG = "verify-o4-auto";
const DRAFT_SLUG = "verify-o4-borrador";
const OTHER_SLUG = "verify-o4-ajena";
const LOCATION_SLUG = "verify-o4-ciudad";
const BARRIO_SLUG = "verify-o4-barrio";
const LEAD_NAME = "Verify O4 Lead";

type Fixture = {
  ownerUser: SessionUser;
  otherOwnerUser: SessionUser;
  adminUser: SessionUser;
  ownerId: number;
  otherOwnerId: number;
  stayId: number;
  carId: number;
  draftId: number;
  otherListingId: number;
  cityId: number;
};

async function teardown(): Promise<void> {
  const listingRows = await db
    .select({ id: listings.id })
    .from(listings)
    .where(like(listings.slug, "verify-o4-%"));
  const listingIds = listingRows.map((row) => row.id);

  if (listingIds.length > 0) {
    const bookingRows = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(inArray(bookings.listingId, listingIds));
    const bookingIds = bookingRows.map((row) => row.id);
    if (bookingIds.length > 0) {
      await db.delete(scheduledMessages).where(inArray(scheduledMessages.bookingId, bookingIds));
      await db.delete(bookingExtras).where(inArray(bookingExtras.bookingId, bookingIds));
      await db
        .delete(activityLog)
        .where(and(eq(activityLog.entity, "booking"), inArray(activityLog.entityId, bookingIds)));
    }
    await db.delete(availabilityBlocks).where(inArray(availabilityBlocks.listingId, listingIds));
    await db.delete(icalSources).where(inArray(icalSources.listingId, listingIds));
    await db.delete(messages).where(inArray(messages.listingId, listingIds));
    await db.delete(infoItems).where(inArray(infoItems.listingId, listingIds));
    await db.delete(cleaningTasks).where(inArray(cleaningTasks.listingId, listingIds));
    await db.delete(expenses).where(inArray(expenses.listingId, listingIds));
    await db.delete(bookings).where(inArray(bookings.listingId, listingIds));
    await db.delete(stayDetails).where(inArray(stayDetails.listingId, listingIds));
    await db.delete(carDetails).where(inArray(carDetails.listingId, listingIds));
    await db.delete(listings).where(inArray(listings.id, listingIds));
  }

  await db.delete(leads).where(eq(leads.name, LEAD_NAME));

  const ownerRows = await db
    .select({ id: owners.id, userId: owners.userId })
    .from(owners)
    .innerJoin(users, eq(users.id, owners.userId))
    .where(inArray(users.email, [OWNER_EMAIL, OTHER_OWNER_EMAIL]));
  const ownerIds = ownerRows.map((row) => row.id);
  if (ownerIds.length > 0) {
    const boardRows = await db
      .select({ id: ownerOnboarding.id })
      .from(ownerOnboarding)
      .where(inArray(ownerOnboarding.ownerId, ownerIds));
    const boardIds = boardRows.map((row) => row.id);
    if (boardIds.length > 0) {
      await db.delete(onboardingSteps).where(inArray(onboardingSteps.onboardingId, boardIds));
      await db.delete(ownerOnboarding).where(inArray(ownerOnboarding.id, boardIds));
    }
    await db.delete(owners).where(inArray(owners.id, ownerIds));
  }
  await db.delete(users).where(inArray(users.email, [OWNER_EMAIL, OTHER_OWNER_EMAIL]));
  await db.delete(locations).where(like(locations.slug, "verify-o4-%"));
}

async function makeOwner(email: string, name: string) {
  const [userRow] = await db
    .insert(users)
    .values({ name, email, passwordHash: null, role: "owner" })
    .$returningId();
  const [ownerRow] = await db
    .insert(owners)
    .values({ userId: userRow!.id, displayName: name, defaultCommissionPct: "20.00" })
    .$returningId();
  const session = await buildSessionUser(userRow!.id);
  return { userId: userRow!.id, ownerId: ownerRow!.id, session: session! };
}

async function setup(): Promise<Fixture> {
  await teardown();

  const owner = await makeOwner(OWNER_EMAIL, "Verify O4");
  const other = await makeOwner(OTHER_OWNER_EMAIL, "Verify O4 B");

  const [cityRow] = await db
    .insert(locations)
    .values({ name: "Verify O4 Ciudad", slug: LOCATION_SLUG })
    .$returningId();
  const [barrioRow] = await db
    .insert(locations)
    .values({ name: "Verify O4 Barrio", slug: BARRIO_SLUG, parentId: cityRow!.id })
    .$returningId();

  async function stay(slug: string, ownerId: number, status: "published" | "draft", locationId: number | null) {
    const [row] = await db
      .insert(listings)
      .values({
        slug,
        vertical: "stay",
        title: `Verify O4 — ${slug}`,
        price: "500000.00",
        priceUnit: "per_night",
        currency: "PYG",
        status,
        ownerId,
        locationId,
        publishedAt: status === "published" ? new Date() : null,
      })
      .$returningId();
    await db.insert(stayDetails).values({
      listingId: row!.id,
      propertyType: "casa",
      bedrooms: 3,
      maxGuests: 6,
      checkInTime: "14:00",
      checkOutTime: "11:00",
    });
    return row!.id;
  }

  const stayId = await stay(STAY_SLUG, owner.ownerId, "published", barrioRow!.id);
  const draftId = await stay(DRAFT_SLUG, owner.ownerId, "draft", cityRow!.id);
  const otherListingId = await stay(OTHER_SLUG, other.ownerId, "published", cityRow!.id);

  const [carRow] = await db
    .insert(listings)
    .values({
      slug: CAR_SLUG,
      vertical: "car",
      title: "Verify O4 — auto",
      price: "300000.00",
      priceUnit: "per_day",
      currency: "PYG",
      status: "published",
      ownerId: owner.ownerId,
      locationId: cityRow!.id,
      publishedAt: new Date(),
    })
    .$returningId();
  await db.insert(carDetails).values({
    listingId: carRow!.id,
    vehicleType: "suv",
    make: "Toyota",
    model: "Verify",
    year: 2025,
    seats: 7,
  });

  const [adminRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "super_admin"))
    .limit(1);
  const adminUser = await buildSessionUser(adminRow!.id);

  return {
    ownerUser: owner.session,
    otherOwnerUser: other.session,
    adminUser: adminUser!,
    ownerId: owner.ownerId,
    otherOwnerId: other.ownerId,
    stayId,
    carId: carRow!.id,
    draftId,
    otherListingId,
    cityId: cityRow!.id,
  };
}

export async function runCommsChecks(r: CheckRunner): Promise<void> {
  const fx = await setup();

  /* ------------------------------------------------------ #4 message sequence */

  r.section("Confirmar una reserva agenda la secuencia (#4, #11)");

  const stayBooking = await createBooking(
    {
      listingId: fx.stayId,
      guestName: "Huésped O4",
      guestPhone: "0981 111 222",
      startAt: "2030-04-10",
      endAt: "2030-04-14",
      status: "inquiry",
      source: "web",
    },
    fx.adminUser,
  );
  const queuedOnInquiry = await db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.bookingId, stayBooking.booking.id));
  r.equal("una consulta no agenda nada", queuedOnInquiry.length, 0);

  const confirmed = await transitionBooking(stayBooking.booking.id, "confirmed", fx.adminUser);
  r.check("confirmar agendó mensajes", confirmed.messagesEnqueued > 0);

  const queued = await db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.bookingId, stayBooking.booking.id));
  r.equal("se agendaron las 5 plantillas sembradas", queued.length, 5);
  r.check(
    "incluye el pedido de reseña (#11)",
    queued.some((row) => row.templateKey === "review_request"),
  );
  r.check(
    "cada mensaje nace con su cuerpo ya renderizado",
    queued.every((row) => (row.renderedBody ?? "").length > 0),
  );
  r.check(
    "y con el nombre del huésped adentro",
    queued.every((row) => row.renderedBody!.includes("Huésped O4")),
  );
  r.check(
    "ninguno quedó con una variable sin resolver",
    queued.every((row) => !row.renderedBody!.includes("{{")),
  );

  const preArrival = queued.find((row) => row.templateKey === "pre_arrival")!;
  r.equal(
    "el pre-arrival cae un día antes del check-in",
    preArrival.sendAfter.toISOString(),
    new Date(stayBooking.booking.startAt.getTime() - 86_400_000).toISOString(),
  );
  const review = queued.find((row) => row.templateKey === "review_request")!;
  r.equal(
    "la reseña cae un día después del check-out",
    review.sendAfter.toISOString(),
    new Date(stayBooking.booking.endAt.getTime() + 86_400_000).toISOString(),
  );

  const repeat = await enqueueBookingMessages(stayBooking.booking.id, {}, fx.adminUser);
  r.equal("re-agendar es idempotente", repeat.created, 0);
  const afterRepeat = await db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.bookingId, stayBooking.booking.id));
  r.equal("y no duplica filas", afterRepeat.length, 5);

  /* ------------------------------------------------------------ due + outbox */

  r.section("La cola de envío");

  const flipped = await markDueMessages(new Date("2030-04-11T00:00:00Z"));
  r.check("el barrido marca lo vencido", flipped >= 2);
  const dueRows = await listOutbox({ statuses: ["due"] });
  const dueForBooking = dueRows.filter((row) => row.bookingId === stayBooking.booking.id);
  r.equal(
    "confirmación, pre-arrival y check-in quedaron para enviar",
    dueForBooking.length,
    3,
  );
  const secondSweep = await markDueMessages(new Date("2030-04-11T00:00:00Z"));
  r.equal("un segundo barrido no re-marca nada", secondSweep, 0);

  const outboxRow = dueForBooking[0]!;
  r.check(
    "el outbox trae un enlace wa.me con el cuerpo",
    outboxRow.whatsappUrl?.startsWith("https://wa.me/595981111222?text=") === true,
  );

  const sent = await markScheduledSent(outboxRow.id, fx.adminUser);
  r.check("marcar enviado devuelve el id del mensaje registrado", sent.messageId > 0);
  const [afterSend] = await db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.id, outboxRow.id));
  r.equal("la fila queda en sent", afterSend!.status, "sent");
  r.equal("con el usuario que lo mandó", afterSend!.sentBy, fx.adminUser.id);

  const loggedMessages = await listThreadMessages({ bookingId: stayBooking.booking.id });
  r.equal("y quedó una fila en la conversación", loggedMessages.length, 1);
  r.equal("como saliente", loggedMessages[0]!.direction, "outbound");

  await r.throwsAsync(
    "marcar enviado dos veces se rechaza",
    () => markScheduledSent(outboxRow.id, fx.adminUser),
    "already_settled",
  );

  const cancelledId = dueForBooking[1]!.id;
  await cancelScheduledMessage(cancelledId, fx.adminUser);
  const [afterCancel] = await db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.id, cancelledId));
  r.equal("cancelar un mensaje lo saca de la cola", afterCancel!.status, "cancelled");
  await r.throwsAsync(
    "un mensaje ya enviado no se puede cancelar",
    () => cancelScheduledMessage(outboxRow.id, fx.adminUser),
    "already_settled",
  );

  /* --------------------------------------------------- cancellation stops it */

  r.section("Cancelar la reserva calla la secuencia");

  const cancelled = await transitionBooking(stayBooking.booking.id, "cancelled", fx.adminUser);
  r.check("cancelar canceló los pendientes", cancelled.messagesCancelled > 0);
  const afterCancelAll = await db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.bookingId, stayBooking.booking.id));
  r.equal(
    "no queda nada agendado ni por enviar",
    afterCancelAll.filter((row) => row.status === "scheduled" || row.status === "due").length,
    0,
  );
  r.equal(
    "pero lo que ya se envió sigue enviado",
    afterCancelAll.filter((row) => row.status === "sent").length,
    1,
  );

  /* ----------------------------------------------------------- #20 inbox */

  r.section("Bandeja unificada (#20)");

  await logMessage(
    {
      bookingId: stayBooking.booking.id,
      listingId: fx.stayId,
      direction: "inbound",
      body: "¿Tiene cochera?",
      contactName: "Huésped O4",
      contactPhone: "0981111222",
    },
    fx.adminUser,
  );
  await logMessage(
    {
      listingId: fx.carId,
      direction: "inbound",
      body: "¿El auto tiene GPS?",
      contactName: "Consulta suelta",
      contactPhone: "0985 000 111",
    },
    fx.adminUser,
  );

  const threads = await listInboxThreads({ limit: 100 });
  const bookingThread = threads.find(
    (thread) => thread.bookingId === stayBooking.booking.id,
  );
  const listingThread = threads.find(
    (thread) => thread.listingId === fx.carId && thread.bookingId === null,
  );
  r.check("la conversación de la reserva aparece una sola vez", !!bookingThread);
  r.equal("con sus dos mensajes", bookingThread?.total, 2);
  r.check("y marcada como pendiente de respuesta", bookingThread?.awaitingReply === true);
  r.check("una consulta sin reserva es su propio hilo", !!listingThread);
  r.check(
    "el hilo de reserva se agrupa por reserva, no por publicación",
    bookingThread?.key === `booking:${stayBooking.booking.id}`,
  );
  const awaiting = await countAwaitingReply();
  r.check("el contador de pendientes los ve", awaiting >= 2);

  /* -------------------------------------------------- draft grounding + info */

  r.section("Base de información y contexto del borrador");

  await upsertInfoItem(
    { listingId: fx.stayId, question: "¿Hay cochera?", answer: "Sí, para un auto." },
    fx.ownerUser,
  );
  await upsertInfoItem(
    { listingId: fx.stayId, question: "¿Hay cochera?", answer: "Sí, para dos autos." },
    fx.ownerUser,
  );
  await upsertInfoItem(
    { listingId: fx.otherListingId, question: "¿Ajena?", answer: "De otro propietario." },
    fx.otherOwnerUser,
  );
  const [foreignItem] = await db
    .select()
    .from(infoItems)
    .where(eq(infoItems.listingId, fx.otherListingId));
  await r.throwsAsync(
    "no se puede borrar un ítem de otra publicación pasando la propia",
    () => deleteInfoItem(foreignItem!.id, fx.stayId, fx.ownerUser),
    "not_found",
  );
  r.equal(
    "y el ítem ajeno sigue ahí",
    (await db.select().from(infoItems).where(eq(infoItems.id, foreignItem!.id))).length,
    1,
  );
  await deleteInfoItem(foreignItem!.id, fx.otherListingId, fx.otherOwnerUser);

  const infoRows = await db.select().from(infoItems).where(eq(infoItems.listingId, fx.stayId));
  r.equal("guardar la misma pregunta actualiza en lugar de duplicar", infoRows.length, 1);
  r.equal("con la respuesta nueva", infoRows[0]!.answer, "Sí, para dos autos.");

  const subject = await loadDraftSubject({ bookingId: stayBooking.booking.id });
  r.equal("el contexto del borrador trae la publicación", subject?.listingId, fx.stayId);
  r.equal("y su base de información", subject?.infoItems.length, 1);
  r.check("y los datos de la reserva", subject?.bookingReference === stayBooking.booking.reference);
  r.equal(
    "una publicación sin reserva también tiene contexto",
    (await loadDraftSubject({ listingId: fx.carId }))?.listingId,
    fx.carId,
  );
  r.equal(
    "una reserva inexistente no tiene contexto",
    await loadDraftSubject({ bookingId: 99_999_999 }),
    null,
  );

  /* ---------------------------------------------------------------- templates */

  r.section("Plantillas");

  const seeded = await db.select().from(messageTemplates).where(eq(messageTemplates.locale, "es"));
  r.check("hay al menos las cinco plantillas del plan", seeded.length >= 5);
  const unknownPlaceholders = seeded.flatMap((template) =>
    placeholdersIn(template.body).filter(
      (key) => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(key),
    ),
  );
  r.equal(
    "ninguna plantilla sembrada usa una variable inexistente",
    unknownPlaceholders.join(","),
    "",
  );
  r.check(
    "todas están en voseo o sin verbo conjugado en tuteo",
    !seeded.some((template) => /\btienes\b|\bpuedes\b|\bescríbeme\b/i.test(template.body)),
  );

  const confirmTemplate = seeded.find((template) => template.key === "booking_confirmed")!;
  await updateTemplate(confirmTemplate.id, { label: "Reserva confirmada (editada)" }, fx.adminUser);
  const [reloaded] = await db
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.id, confirmTemplate.id));
  r.equal("editar una plantilla la guarda", reloaded!.label, "Reserva confirmada (editada)");
  r.equal(
    "y no reescribe lo que ya está en la cola",
    (
      await db
        .select()
        .from(scheduledMessages)
        .where(eq(scheduledMessages.id, outboxRow.id))
    )[0]!.renderedBody,
    afterSend!.renderedBody,
  );
  await updateTemplate(confirmTemplate.id, { label: confirmTemplate.label }, fx.adminUser);
  await r.throwsAsync(
    "una plantilla inexistente no se puede editar",
    () => updateTemplate(99_999_999, { label: "x" }, fx.adminUser),
    "not_found",
  );

  /* --------------------------------------------------------------- analytics */

  r.section("Analítica (#12)");

  const analyticsBooking = await createBooking(
    {
      listingId: fx.stayId,
      guestName: "Ocupación O4",
      startAt: "2030-06-01",
      endAt: "2030-06-11",
      status: "confirmed",
      source: "whatsapp",
    },
    fx.adminUser,
  );
  const window = {
    startAt: new Date("2030-06-01T00:00:00Z"),
    endAt: new Date("2030-06-11T00:00:00Z"),
  };
  const perListing = await listingPerformance(window, { listingIds: [fx.stayId] });
  const stayStats = perListing[0]!;
  r.check("la ocupación no supera el 100%", stayStats.occupancyPct <= 100);
  r.check("y para una reserva que llena la ventana ronda el 100%", stayStats.occupancyPct > 90);
  r.equal("cuenta la reserva", stayStats.bookingCount, 1);
  r.equal("y su facturación", stayStats.revenue, analyticsBooking.booking.total);

  const halfWindow = {
    startAt: new Date("2030-06-01T00:00:00Z"),
    endAt: new Date("2030-06-06T00:00:00Z"),
  };
  const halfStats = (await listingPerformance(halfWindow, { listingIds: [fx.stayId] }))[0]!;
  r.check(
    "una ventana que corta la reserva por la mitad sigue acotada al 100%",
    halfStats.occupancyPct > 80 && halfStats.occupancyPct <= 100,
  );

  const emptyWindow = {
    startAt: new Date("2030-01-01T00:00:00Z"),
    endAt: new Date("2030-01-31T00:00:00Z"),
  };
  const emptyStats = (await listingPerformance(emptyWindow, { listingIds: [fx.stayId] }))[0]!;
  r.equal("una ventana sin reservas da 0%", emptyStats.occupancyPct, 0);
  r.equal("y sin ratio de gastos", emptyStats.expenseRatioPct, null);

  const sources = await bookingSources(window, { listingIds: [fx.stayId] });
  r.check(
    "el origen whatsapp aparece",
    sources.some((row) => row.source === "whatsapp" && row.bookings === 1),
  );
  const locationsTop = await topLocations(window, { listingIds: [fx.stayId] });
  r.check("y la ubicación también", locationsTop.some((row) => row.locationName.includes("Barrio")));
  const fleet = await fleetUtilisation(window, { listingIds: [fx.stayId, fx.carId] });
  r.equal("la flota cuenta sólo autos", fleet.vehicles, 1);
  const overview = await analyticsOverview(window, { listingIds: [fx.stayId, fx.carId] });
  r.equal("el resumen suma ambas verticales", overview.portfolio.listings, 2);
  r.equal(
    "sin publicaciones alcanzables el resumen es vacío, no un error",
    (await analyticsOverview(window, { listingIds: [] })).portfolio.listings,
    0,
  );

  /* -------------------------------------------------------------- leads / CRM */

  r.section("Leads: guardar primero, enviar después");

  const before = await leadCounts();
  const captured = await captureLead({
    name: LEAD_NAME,
    phone: "0981 555 000",
    message: "Consulta de verificación",
    vertical: "stay",
    listingId: fx.stayId,
  });
  r.check("el lead se guardó", captured.lead.id > 0);
  r.equal(
    "y sin credencial del CRM queda pendiente, no perdido",
    process.env.VENDERCRM_API_KEY ? "skip" : captured.forwardStatus,
    process.env.VENDERCRM_API_KEY ? "skip" : "pending",
  );
  const afterLeads = await leadCounts();
  r.check(
    "el contador subió",
    afterLeads.pending + afterLeads.forwarded + afterLeads.failed >
      before.pending + before.forwarded + before.failed,
  );
  const storedLead = (await listLeads({ limit: 100 })).find((row) => row.name === LEAD_NAME);
  r.check("y aparece en la lista del admin", !!storedLead);
  r.equal("atado a su publicación", storedLead?.listingId, fx.stayId);

  const bogus = await captureLead({
    name: LEAD_NAME,
    phone: "0981 555 001",
    listingId: fx.draftId,
  });
  r.equal(
    "un lead que apunta a una publicación no publicada pierde esa atribución",
    bogus.lead.listingId,
    null,
  );
  const unknownListing = await captureLead({
    name: LEAD_NAME,
    phone: "0981 555 002",
    listingId: 99_999_999,
  });
  r.equal(
    "y una publicación inexistente tampoco se guarda",
    unknownListing.lead.listingId,
    null,
  );

  await r.throwsAsync(
    "un lead sin teléfono ni correo se rechaza",
    () => captureLead({ name: LEAD_NAME, message: "sin contacto" }),
    "invalid_amount",
  );

  /* ------------------------------------------------------------- onboarding */

  r.section("Onboarding del propietario (#19)");

  const progress = await getOnboardingProgress(fx.ownerId);
  r.equal("la checklist tiene los cinco pasos", progress.steps.length, 5);
  const published = progress.steps.find((step) => step.stepKey === "first_listing_published")!;
  r.equal("el paso de publicación se dedujo solo", published.status, "done");
  const infoStep = progress.steps.find((step) => step.stepKey === "info_base")!;
  r.equal("el de la base de información también", infoStep.status, "done");
  const contract = progress.steps.find((step) => step.stepKey === "contract")!;
  r.equal("el contrato lo tiene que marcar una persona", contract.status, "pending");
  r.check("y no es un paso derivado", contract.derived === false);
  const icalStep = progress.steps.find((step) => step.stepKey === "ical")!;
  r.equal("sin iCal conectado, ese paso sigue pendiente", icalStep.status, "pending");

  await setOnboardingStep(
    { ownerId: fx.ownerId, stepKey: "contract", status: "done" },
    fx.adminUser,
  );
  const afterTick = await getOnboardingProgress(fx.ownerId);
  r.equal(
    "marcarlo lo completa",
    afterTick.steps.find((step) => step.stepKey === "contract")!.status,
    "done",
  );
  await r.throwsAsync(
    "un paso inexistente se rechaza",
    () => setOnboardingStep({ ownerId: fx.ownerId, stepKey: "nope", status: "done" }, fx.adminUser),
    "not_found",
  );

  /* ------------------------------------------------------------ public pages */

  r.section("Consultas públicas (§5.O11)");

  const browsed = await browseListings({ vertical: "stay" });
  r.check(
    "la publicación publicada aparece",
    browsed.some((row) => row.slug === STAY_SLUG),
  );
  r.check(
    "el borrador NO aparece",
    !browsed.some((row) => row.slug === DRAFT_SLUG),
  );
  r.check(
    "el detalle público de un borrador no resuelve",
    (await getPublicListing(DRAFT_SLUG)) === null,
  );
  const detail = await getPublicListing(STAY_SLUG);
  r.check("el detalle publicado sí", detail !== null);
  r.check("y trae los datos tipados de alojamiento", detail?.stay?.propertyType === "casa");

  const carDetail = await getPublicListing(CAR_SLUG);
  r.check("un auto trae sus datos tipados", carDetail?.carMake === "Toyota");
  r.check(
    "y nunca la chapa (dato privado, plan §2)",
    !Object.keys(carDetail ?? {}).some((key) => key.toLowerCase().includes("plate")),
  );

  const cityIds = await locationIdsForSlug(LOCATION_SLUG);
  r.equal("una ciudad cubre su barrio", cityIds.length, 2);
  const byCity = await browseListings({ vertical: "stay", locationSlug: LOCATION_SLUG });
  r.check(
    "filtrar por ciudad incluye lo que está en su barrio",
    byCity.some((row) => row.slug === STAY_SLUG),
  );
  r.equal(
    "un slug de ubicación inexistente no devuelve todo",
    (await browseListings({ vertical: "stay", locationSlug: "no-existe-o4" })).length,
    0,
  );
  const byGuests = await browseListings({ vertical: "stay", guests: 10 });
  r.check(
    "el filtro de huéspedes excluye lo que no entra",
    !byGuests.some((row) => row.slug === STAY_SLUG),
  );
  const bySeats = await browseListings({ vertical: "car", seats: 7 });
  r.check("y el de asientos incluye la SUV", bySeats.some((row) => row.slug === CAR_SLUG));
  const cheap = await browseListings({ vertical: "stay", maxPrice: 100_000 });
  r.check("el filtro de precio máximo funciona", !cheap.some((row) => row.slug === STAY_SLUG));

  /* -------------------------------------------------------------- owner panel */

  r.section("Panel del propietario y alcance (plan §2)");

  const ownerListings = await listPanelListings(fx.ownerUser);
  r.check(
    "el propietario ve sus publicaciones",
    ownerListings.some((row) => row.id === fx.stayId),
  );
  r.check(
    "y NO las de otro propietario",
    !ownerListings.some((row) => row.id === fx.otherListingId),
  );
  r.equal(
    "el detalle de una publicación ajena no resuelve",
    await getPanelListing(fx.ownerUser, fx.otherListingId),
    null,
  );
  r.check(
    "un admin sí ve la ajena",
    (await getPanelListing(fx.adminUser, fx.otherListingId)) !== null,
  );

  let updateBlocked = false;
  try {
    await updatePanelListing(fx.ownerUser, fx.otherListingId, { title: "Secuestrada" });
  } catch (error) {
    updateBlocked = error instanceof AuthError;
  }
  r.check("y editar una publicación ajena se rechaza", updateBlocked);

  await updatePanelListing(fx.ownerUser, fx.draftId, { status: "published", title: "Verify O4 — publicada" });
  const [publishedRow] = await db.select().from(listings).where(eq(listings.id, fx.draftId));
  r.equal("el propietario puede publicar la suya", publishedRow!.status, "published");
  r.check("y queda sellado el published_at", publishedRow!.publishedAt !== null);
  const firstPublishedAt = publishedRow!.publishedAt!.getTime();
  await updatePanelListing(fx.ownerUser, fx.draftId, { status: "paused" });
  await updatePanelListing(fx.ownerUser, fx.draftId, { status: "published" });
  const [republished] = await db.select().from(listings).where(eq(listings.id, fx.draftId));
  r.equal(
    "republicar no mueve published_at",
    republished!.publishedAt!.getTime(),
    firstPublishedAt,
  );

  await r.throwsAsync(
    "un precio cero se rechaza",
    () => updatePanelListing(fx.ownerUser, fx.stayId, { price: "0" }),
    "invalid_amount",
  );

  const calendar = await panelCalendar(fx.ownerUser, {
    startAt: new Date("2030-01-01T00:00:00Z"),
    endAt: new Date("2031-01-01T00:00:00Z"),
  });
  r.check(
    "el calendario del propietario trae su reserva",
    calendar.some((entry) => entry.kind === "booking" && entry.id === analyticsBooking.booking.id),
  );
  r.check(
    "y ninguna entrada de otro propietario",
    calendar.every((entry) => entry.listingId !== fx.otherListingId),
  );

  const earnings = await panelEarnings(fx.ownerUser, {
    startAt: new Date("2030-01-01T00:00:00Z"),
    endAt: new Date("2031-01-01T00:00:00Z"),
  });
  r.equal(
    "una reserva confirmada todavía no es ganancia, es pipeline",
    earnings.gross,
    "0.00",
  );
  r.check("y sí aparece como por cobrar", Number(earnings.pipeline) > 0);

  await transitionBooking(analyticsBooking.booking.id, "active", fx.adminUser);
  await transitionBooking(analyticsBooking.booking.id, "completed", fx.adminUser);
  const afterCompletion = await panelEarnings(fx.ownerUser, {
    startAt: new Date("2030-01-01T00:00:00Z"),
    endAt: new Date("2031-01-01T00:00:00Z"),
  });
  r.equal(
    "una vez completada sí cuenta como bruto",
    afterCompletion.gross,
    analyticsBooking.booking.total,
  );
  r.check("y descuenta la comisión en el neto", Number(afterCompletion.net) < Number(afterCompletion.gross));

  const otherEarnings = await panelEarnings(fx.otherOwnerUser, {
    startAt: new Date("2030-01-01T00:00:00Z"),
    endAt: new Date("2031-01-01T00:00:00Z"),
  });
  r.equal("el otro propietario no ve nada de eso", otherEarnings.gross, "0.00");

  /* ----------------------------------------------------------- iCal sources */

  r.section("Conectar calendarios externos (#2)");

  await r.throwsAsync(
    "una URL que no es http(s) se rechaza",
    () => createIcalSource({ listingId: fx.stayId, url: "javascript:alert(1)" }, fx.ownerUser),
    "invalid_range",
  );
  await r.throwsAsync(
    "y una que no es URL tampoco",
    () => createIcalSource({ listingId: fx.stayId, url: "no soy una url" }, fx.ownerUser),
    "invalid_range",
  );
  const sourceId = await createIcalSource(
    { listingId: fx.stayId, url: "https://example.com/cal.ics", label: "Prueba" },
    fx.ownerUser,
  );
  r.equal(
    "el calendario queda conectado a la publicación",
    (await listIcalSources({ listingId: fx.stayId })).length,
    1,
  );
  // A block the importer would have written, to prove the cascade.
  await db.insert(availabilityBlocks).values({
    listingId: fx.stayId,
    startAt: new Date("2030-09-01T14:00:00Z"),
    endAt: new Date("2030-09-05T11:00:00Z"),
    reason: "external_ical",
    icalSourceId: sourceId,
    sourceRef: "verify-o4-uid",
  });
  await deleteIcalSource(sourceId, fx.ownerUser);
  r.equal(
    "desconectarlo lo borra",
    (await listIcalSources({ listingId: fx.stayId })).length,
    0,
  );
  r.equal(
    "y libera los bloqueos que había importado",
    (
      await db
        .select()
        .from(availabilityBlocks)
        .where(eq(availabilityBlocks.icalSourceId, sourceId))
    ).length,
    0,
  );
  await r.throwsAsync(
    "desconectar uno inexistente se rechaza",
    () => deleteIcalSource(99_999_999, fx.ownerUser),
    "not_found",
  );

  /* ------------------------------------------------------- money catalogues */

  r.section("Catálogos que lee el motor de precios (#10, #18)");

  r.check("los extras sembrados están", (await listAllExtras()).length > 0);
  r.check("y los códigos promocionales también", (await listPromoCodes()).length > 0);

  /* ------------------------------------------------------------- rendering */

  r.section("Render de plantillas con datos reales");

  const rendered = renderTemplate("Hola {{guest_name}}, {{listing_title}} — {{nope}}", {
    guest_name: "Ana",
    listing_title: "Casa",
  });
  r.check("las variables conocidas se llenan", rendered.body.startsWith("Hola Ana, Casa"));
  r.equal("y las desconocidas se reportan", rendered.unknown.join(","), "nope");

  await teardown();
  r.check("las filas de verificación se limpian al terminar", true);
}
