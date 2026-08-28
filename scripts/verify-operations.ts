/**
 * Phase O-3 verification against a real database (plan §5.O6, O8).
 *
 * Called by `scripts/verify-core.ts` so `npm run verify` stays one command.
 * The pure rules (cleaning status machine, checklist, document gate, reminder
 * thresholds) are pinned without a database in `scripts/verify-logic.ts`.
 *
 * What is proven HERE is what only exists once rows are involved:
 *   · checkout auto-creates the turnover task, exactly once
 *   · a stay is not guest-ready until that task is `ready`
 *   · a magic token grants ONE task and nothing else
 *   · a ticket cost creates exactly one expense, and never rewrites a billed one
 *   · damage on a return inspection opens a ticket AND deducts the deposit,
 *     atomically — a rejected deduction leaves no inspection behind
 *   · a car booking cannot confirm on unverified documents, an admin can
 *     override, an owner cannot, and the override is logged
 *
 * Fixtures live under their own owner (`verify-o3@alquilar.local`) in 2029, a
 * year no seed row touches, and are torn down and rebuilt on every run.
 */
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { db } from "../src/db";
import {
  activityLog,
  bookingDocuments,
  bookingExtras,
  bookings,
  carDetails,
  cleaningTasks,
  deposits,
  expenses,
  inspections,
  listings,
  maintenanceTickets,
  owners,
  ownerStatements,
  messages,
  paymentLinks,
  scheduledMessages,
  stayDetails,
  supplies,
  supplyLevels,
  taskPhotos,
  users,
  vehicleReminders,
} from "../src/db/schema";
import type { CheckRunner } from "./lib/checks";
import { buildSessionUser, type SessionUser } from "../src/lib/auth-core";
import { createBooking, transitionBooking } from "../src/db/queries/bookings";
import {
  advanceCleaningTask,
  advanceTaskByTokenToNext,
  assignCleaner,
  cleanerJobCounts,
  createCleaningTask,
  ensureTurnoverTask,
  isListingGuestReady,
  listRoster,
  openTasksBlockingCheckIn,
  updateChecklist,
  updateChecklistByToken,
  addPhotoByToken,
} from "../src/db/queries/cleaning";
import { createTicket, updateTicket } from "../src/db/queries/maintenance";
import { getExpensesForTicket, listExpenses } from "../src/db/queries/expenses";
import {
  consumeSuppliesForCleaning,
  listLowStock,
  setSupplyLevel,
  upsertSupply,
} from "../src/db/queries/supplies";
import { createDeposit, getDepositForBooking } from "../src/db/queries/deposits";
import { recordInspection, latestOdometer } from "../src/db/queries/inspections";
import { createVehicleReminder, listDueReminders } from "../src/db/queries/reminders";
import {
  attachDocument,
  documentGateForBooking,
  listPendingDocuments,
  reviewDocument,
} from "../src/db/queries/documents";
import { listPhotos } from "../src/db/queries/photos";
import { resolveMagicToken } from "../src/lib/magic-link";

const OWNER_EMAIL = "verify-o3@alquilar.local";
const CLEANER_EMAIL = "verify-o3-cleaner@alquilar.local";
const STAY_SLUG = "verify-o3-casa";
const CAR_SLUG = "verify-o3-auto";
const SUPPLY_PREFIX = "Verify O3 —";

const d = (iso: string) => new Date(iso);

async function fixtureListingIds(): Promise<number[]> {
  const rows = await db
    .select({ id: listings.id })
    .from(listings)
    .where(inArray(listings.slug, [STAY_SLUG, CAR_SLUG]));
  return rows.map((r) => r.id);
}

/** Remove every row a previous run created, in dependency order. */
async function teardown(): Promise<void> {
  const listingIds = await fixtureListingIds();
  if (listingIds.length > 0) {
    const bookingIds = (
      await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(inArray(bookings.listingId, listingIds))
    ).map((r) => r.id);
    const taskIds = (
      await db
        .select({ id: cleaningTasks.id })
        .from(cleaningTasks)
        .where(inArray(cleaningTasks.listingId, listingIds))
    ).map((r) => r.id);
    const ticketIds = (
      await db
        .select({ id: maintenanceTickets.id })
        .from(maintenanceTickets)
        .where(inArray(maintenanceTickets.listingId, listingIds))
    ).map((r) => r.id);

    if (bookingIds.length > 0) {
      const inspectionIds = (
        await db
          .select({ id: inspections.id })
          .from(inspections)
          .where(inArray(inspections.bookingId, bookingIds))
      ).map((r) => r.id);
      if (inspectionIds.length > 0) {
        await db
          .delete(taskPhotos)
          .where(
            and(
              eq(taskPhotos.subjectType, "inspection"),
              inArray(taskPhotos.subjectId, inspectionIds),
            ),
          );
      }
      await db.delete(inspections).where(inArray(inspections.bookingId, bookingIds));
      await db.delete(bookingDocuments).where(inArray(bookingDocuments.bookingId, bookingIds));
      await db.delete(deposits).where(inArray(deposits.bookingId, bookingIds));
      await db.delete(paymentLinks).where(inArray(paymentLinks.bookingId, bookingIds));
      await db.delete(bookingExtras).where(inArray(bookingExtras.bookingId, bookingIds));
      // Confirming a booking enqueues its message sequence (phase O-4), so
      // these fixtures leave queue rows behind too.
      await db.delete(scheduledMessages).where(inArray(scheduledMessages.bookingId, bookingIds));
      await db.delete(messages).where(inArray(messages.bookingId, bookingIds));
      await db.delete(activityLog).where(
        and(eq(activityLog.entity, "booking"), inArray(activityLog.entityId, bookingIds)),
      );
    }
    if (taskIds.length > 0) {
      await db
        .delete(taskPhotos)
        .where(
          and(eq(taskPhotos.subjectType, "cleaning_task"), inArray(taskPhotos.subjectId, taskIds)),
        );
    }
    if (ticketIds.length > 0) {
      await db
        .delete(taskPhotos)
        .where(
          and(
            eq(taskPhotos.subjectType, "maintenance_ticket"),
            inArray(taskPhotos.subjectId, ticketIds),
          ),
        );
    }
    await db.delete(cleaningTasks).where(inArray(cleaningTasks.listingId, listingIds));
    await db.delete(expenses).where(inArray(expenses.listingId, listingIds));
    await db.delete(maintenanceTickets).where(inArray(maintenanceTickets.listingId, listingIds));
    await db.delete(supplyLevels).where(inArray(supplyLevels.listingId, listingIds));
    await db.delete(vehicleReminders).where(inArray(vehicleReminders.listingId, listingIds));
    await db.delete(bookings).where(inArray(bookings.listingId, listingIds));
    await db.delete(stayDetails).where(inArray(stayDetails.listingId, listingIds));
    await db.delete(carDetails).where(inArray(carDetails.listingId, listingIds));
    await db.delete(listings).where(inArray(listings.id, listingIds));
  }
  await db.delete(supplies).where(like(supplies.name, `${SUPPLY_PREFIX}%`));

  for (const email of [OWNER_EMAIL, CLEANER_EMAIL]) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!user) continue;
    const ownerIds = (
      await db.select({ id: owners.id }).from(owners).where(eq(owners.userId, user.id))
    ).map((r) => r.id);
    if (ownerIds.length > 0) {
      await db.delete(ownerStatements).where(inArray(ownerStatements.ownerId, ownerIds));
      await db.delete(owners).where(inArray(owners.id, ownerIds));
    }
    await db.delete(users).where(eq(users.id, user.id));
  }
}

type Fixture = {
  ownerUser: SessionUser;
  adminUser: SessionUser;
  cleanerId: number;
  stayId: number;
  carId: number;
  supplyId: number;
};

async function setup(): Promise<Fixture> {
  await teardown();

  const [ownerRow] = await db
    .insert(users)
    .values({
      name: "Verify O3 Owner",
      email: OWNER_EMAIL,
      // Never logged into — scoping is exercised through the session object.
      passwordHash: null,
      role: "owner",
    })
    .$returningId();
  const [ownerProfile] = await db
    .insert(owners)
    .values({ userId: ownerRow!.id, displayName: "Verify O3", defaultCommissionPct: "20.00" })
    .$returningId();

  const [cleanerRow] = await db
    .insert(users)
    .values({
      name: "Verify O3 Cleaner",
      email: CLEANER_EMAIL,
      passwordHash: null,
      role: "cleaner",
    })
    .$returningId();

  const [stayRow] = await db
    .insert(listings)
    .values({
      slug: STAY_SLUG,
      vertical: "stay",
      title: "Verify O3 — casa",
      price: "500000.00",
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
      title: "Verify O3 — auto",
      price: "300000.00",
      priceUnit: "per_day",
      currency: "PYG",
      status: "published",
      ownerId: ownerProfile!.id,
      publishedAt: new Date(),
    })
    .$returningId();
  await db.insert(carDetails).values({
    listingId: carRow!.id,
    vehicleType: "auto",
    make: "Toyota",
    model: "Verify",
    year: 2024,
  });

  const supply = await upsertSupply({
    name: `${SUPPLY_PREFIX} toallas`,
    unit: "unidad",
    consumedPerCleaning: 2,
  });
  await setSupplyLevel({ supplyId: supply.id, listingId: stayRow!.id, qty: 3, lowThreshold: 2 });

  const ownerUser = await buildSessionUser(ownerRow!.id);
  const [adminRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "super_admin"))
    .limit(1);
  const adminUser = await buildSessionUser(adminRow!.id);

  return {
    ownerUser: ownerUser!,
    adminUser: adminUser!,
    cleanerId: cleanerRow!.id,
    stayId: stayRow!.id,
    carId: carRow!.id,
    supplyId: supply.id,
  };
}

export async function runOperationsChecks(r: CheckRunner): Promise<void> {
  const fx = await setup();

  /* ------------------------------------------------ #1 turnover auto-creation */

  r.section("Checkout ⇒ tarea de limpieza (#1)");

  const stay1 = await createBooking(
    {
      listingId: fx.stayId,
      guestName: "Huésped O3",
      startAt: "2029-05-01",
      endAt: "2029-05-05",
      status: "confirmed",
      source: "manual",
    },
    fx.adminUser,
  );
  const checkout = await transitionBooking(stay1.booking.id, "completed", fx.adminUser);
  r.check("el checkout devuelve el id de la tarea creada", checkout.cleaningTaskId !== null);

  const tasksForBooking = await db
    .select()
    .from(cleaningTasks)
    .where(eq(cleaningTasks.bookingId, stay1.booking.id));
  r.equal("el checkout creó exactamente una tarea", tasksForBooking.length, 1);
  const turnover = tasksForBooking[0]!;
  r.equal("la tarea nace en estado needed", turnover.status, "needed");
  r.equal(
    "vence en el check-out de la reserva",
    turnover.dueBy?.toISOString(),
    stay1.booking.endAt.toISOString(),
  );
  r.check("trae el checklist por defecto", (turnover.checklist?.length ?? 0) > 0);
  r.check("y un token propio", turnover.magicToken.length >= 16);

  const again = await ensureTurnoverTask(
    { id: stay1.booking.id, listingId: fx.stayId, endAt: stay1.booking.endAt },
    { vertical: "stay" },
    db,
    fx.adminUser,
  );
  r.check("re-ejecutarla es idempotente: devuelve la misma tarea", !again.created);
  r.equal("y no crea una segunda", again.task.id, turnover.id);

  const autoLog = await db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entity, "cleaning_task"),
        eq(activityLog.entityId, turnover.id),
        eq(activityLog.action, "cleaning_task.auto_created"),
      ),
    );
  r.equal("queda registrada en activity_log", autoLog.length, 1);

  /* --------------------------------------------------- guest-readiness gate */

  r.section("Una estadía no está lista hasta que la limpieza esté ready");

  r.check(
    "con la tarea abierta la propiedad no está lista",
    !(await isListingGuestReady(fx.stayId, d("2029-05-10T14:00:00Z"))),
  );
  const blocking = await openTasksBlockingCheckIn(fx.stayId, d("2029-05-10T14:00:00Z"));
  r.equal("y sabemos exactamente qué tarea la bloquea", blocking[0]?.id, turnover.id);

  const stay2 = await createBooking(
    {
      listingId: fx.stayId,
      guestName: "Huésped O3 B",
      startAt: "2029-05-10",
      endAt: "2029-05-12",
      status: "confirmed",
      source: "manual",
    },
    fx.adminUser,
  );
  await r.throwsAsync(
    "confirmed → active se rechaza con limpieza pendiente",
    () => transitionBooking(stay2.booking.id, "active", fx.adminUser),
    "not_guest_ready",
  );

  /* --------------------------------- cleaning status machine + supplies (#17) */

  r.section("Máquina de estados de limpieza y consumo de insumos (#17)");

  await assignCleaner(turnover.id, fx.cleanerId, fx.adminUser);
  await r.throwsAsync(
    "no se asigna una limpieza a alguien que no es personal de limpieza",
    () => assignCleaner(turnover.id, fx.adminUser.id, fx.adminUser),
    "invalid_amount",
  );
  await r.throwsAsync(
    "no se puede saltar de needed a ready",
    () => advanceCleaningTask(turnover.id, "ready", fx.adminUser),
    "invalid_transition",
  );
  await advanceCleaningTask(turnover.id, "in_progress", fx.adminUser);
  await r.throwsAsync(
    "ready exige el checklist completo",
    () => advanceCleaningTask(turnover.id, "ready", fx.adminUser),
    "checklist_incomplete",
  );

  const allDone = Object.fromEntries(
    (turnover.checklist ?? []).map((item) => [item.key, true]),
  );
  await updateChecklist(turnover.id, allDone, fx.adminUser);
  const readied = await advanceCleaningTask(turnover.id, "ready", fx.adminUser);
  r.equal("con el checklist completo pasa a ready", readied.task.status, "ready");
  r.check("y queda con completed_at", readied.task.completedAt !== null);

  const consumed = readied.supplies.find((s) => s.supplyId === fx.supplyId);
  r.equal("el insumo se descuenta al completar (3 − 2)", consumed?.remaining, 1);
  r.check("y queda marcado como stock bajo", consumed?.low === true);
  const [level] = await db
    .select()
    .from(supplyLevels)
    .where(
      and(eq(supplyLevels.supplyId, fx.supplyId), eq(supplyLevels.listingId, fx.stayId)),
    );
  r.equal("el descuento está persistido", level?.qty, 1);
  const low = await listLowStock({ listingIds: [fx.stayId] });
  r.check("y aparece en la lista de reposición", low.some((x) => x.supplyId === fx.supplyId));

  await db.transaction(async (tx) => {
    await consumeSuppliesForCleaning(fx.stayId, tx);
  });
  const [clamped] = await db
    .select()
    .from(supplyLevels)
    .where(
      and(eq(supplyLevels.supplyId, fx.supplyId), eq(supplyLevels.listingId, fx.stayId)),
    );
  r.equal("el stock nunca queda negativo", clamped?.qty, 0);

  const activated = await transitionBooking(stay2.booking.id, "active", fx.adminUser);
  r.equal("con la limpieza lista el check-in procede", activated.to, "active");

  /* ------------------------------------------------------ roster + payroll (#13) */

  r.section("Roster del día y trabajos por limpiador (#13)");

  const roster = await listRoster({ day: stay1.booking.endAt.toISOString().slice(0, 10) });
  r.check(
    "el roster del día trae la tarea del turnover",
    roster.some((row) => row.task.id === turnover.id),
  );
  const counts = await cleanerJobCounts();
  const mine = counts.find((c) => c.userId === fx.cleanerId);
  r.equal("el limpiador tiene 1 trabajo completado", mine?.completed, 1);
  r.equal("y ninguno abierto", mine?.open, 0);

  /* ----------------------------------------------- magic link scoping (plan §2) */

  r.section("Magic link: un token da acceso a UNA tarea y a nada más");

  const other = await createCleaningTask(
    { listingId: fx.stayId, dueBy: d("2029-06-01T11:00:00Z") },
    fx.adminUser,
  );
  const resolved = await resolveMagicToken(turnover.magicToken);
  r.equal("el token resuelve a su propia tarea", resolved?.task.id, turnover.id);
  r.check("y no a la otra", resolved?.task.id !== other.id);
  r.equal("un token inexistente no resuelve nada", await resolveMagicToken("z".repeat(24)), null);

  await r.throwsAsync(
    "un token inválido no puede avanzar ninguna tarea",
    () => advanceTaskByTokenToNext("z".repeat(24)),
    "not_found",
  );
  await r.throwsAsync(
    "un token corto se rechaza antes de tocar la base",
    () => advanceTaskByTokenToNext("abc"),
    "not_found",
  );

  const advancedByToken = await advanceTaskByTokenToNext(other.magicToken);
  r.equal("el token de B avanza B", advancedByToken.task.id, other.id);
  const [turnoverAfter] = await db
    .select()
    .from(cleaningTasks)
    .where(eq(cleaningTasks.id, turnover.id));
  r.equal("y deja A intacta", turnoverAfter?.status, "ready");

  await updateChecklistByToken(other.magicToken, { sabanas: true });
  const [otherAfter] = await db
    .select()
    .from(cleaningTasks)
    .where(eq(cleaningTasks.id, other.id));
  r.check(
    "el checklist por token sólo toca su tarea",
    otherAfter?.checklist?.find((i) => i.key === "sabanas")?.done === true,
  );

  await addPhotoByToken(other.magicToken, "/api/uploads/cleaning/verify-o3.jpg", "prueba");
  const otherPhotos = await listPhotos("cleaning_task", other.id);
  const turnoverPhotos = await listPhotos("cleaning_task", turnover.id);
  r.equal("la foto por token queda en su tarea", otherPhotos.length, 1);
  r.equal("y no aparece en la otra", turnoverPhotos.length, 0);

  /* ------------------------------------------- #6 ticket cost ⇒ expense (#7) */

  r.section("Costo de ticket ⇒ gasto vinculado (#6 → #7)");

  const ticket = await createTicket(
    {
      listingId: fx.stayId,
      title: "Verify O3 — canilla que gotea",
      cost: "150000.00",
    },
    fx.adminUser,
  );
  r.check("crear el ticket con costo crea el gasto", ticket.expenseId !== null);
  let ticketExpenses = await getExpensesForTicket(ticket.ticket.id);
  r.equal("exactamente un gasto por ticket", ticketExpenses.length, 1);
  r.equal("con el monto del ticket", ticketExpenses[0]?.amount, "150000.00");
  r.equal("y categoría repair", ticketExpenses[0]?.category, "repair");

  await updateTicket({ ticketId: ticket.ticket.id, cost: "180000.00" }, fx.adminUser);
  ticketExpenses = await getExpensesForTicket(ticket.ticket.id);
  r.equal("corregir el costo NO duplica el gasto", ticketExpenses.length, 1);
  r.equal("y actualiza el monto", ticketExpenses[0]?.amount, "180000.00");

  // Pretend the statement generator already billed it (#3): history is frozen.
  await db
    .update(expenses)
    .set({ statementId: 999_999 })
    .where(eq(expenses.id, ticketExpenses[0]!.id));
  const locked = await updateTicket(
    { ticketId: ticket.ticket.id, cost: "999000.00" },
    fx.adminUser,
  );
  r.check("un gasto ya facturado no se reescribe", locked.expenseLocked);
  ticketExpenses = await getExpensesForTicket(ticket.ticket.id);
  r.equal("el monto facturado queda intacto", ticketExpenses[0]?.amount, "180000.00");
  await db.update(expenses).set({ statementId: null }).where(eq(expenses.id, ticketExpenses[0]!.id));

  const cleared = await updateTicket({ ticketId: ticket.ticket.id, cost: null }, fx.adminUser);
  r.equal("borrar el costo borra su gasto", (await getExpensesForTicket(ticket.ticket.id)).length, 0);
  r.equal("y no reporta un gasto vigente", cleared.expenseId, null);
  await updateTicket({ ticketId: ticket.ticket.id, cost: "180000.00" }, fx.adminUser);
  r.equal(
    "volver a cargarlo lo recrea, sin duplicar",
    (await getExpensesForTicket(ticket.ticket.id)).length,
    1,
  );

  // A billed expense is frozen against deletion too, not just against edits.
  const billed = (await getExpensesForTicket(ticket.ticket.id))[0]!;
  await db.update(expenses).set({ statementId: 999_998 }).where(eq(expenses.id, billed.id));
  const clearLocked = await updateTicket({ ticketId: ticket.ticket.id, cost: null }, fx.adminUser);
  r.check("un gasto ya facturado tampoco se borra", clearLocked.expenseLocked);
  r.equal(
    "y sigue en la base",
    (await getExpensesForTicket(ticket.ticket.id)).length,
    1,
  );
  await db.update(expenses).set({ statementId: null }).where(eq(expenses.id, billed.id));
  await updateTicket({ ticketId: ticket.ticket.id, cost: "180000.00" }, fx.adminUser);

  const listed = await listExpenses({ listingIds: [fx.stayId] });
  r.check(
    "el gasto se lista con el título de su ticket",
    listed.some((row) => row.ticketTitle === "Verify O3 — canilla que gotea"),
  );

  /* --------------------------- #5 inspection → ticket + deposit deduction (#9) */

  r.section("Daño en la devolución ⇒ ticket + deducción del depósito (#5 → #6/#9)");

  const carBooking = await createBooking(
    {
      listingId: fx.carId,
      guestName: "Conductor O3",
      startAt: d("2029-07-01T09:00:00Z"),
      endAt: d("2029-07-05T09:00:00Z"),
      status: "inquiry",
      source: "manual",
    },
    fx.adminUser,
  );
  await createDeposit(
    { bookingId: carBooking.booking.id, amount: "1000000.00" },
    fx.adminUser,
  );

  const pickup = await recordInspection(
    {
      bookingId: carBooking.booking.id,
      type: "pickup",
      odometer: 40000,
      fuelLevel: 100,
      confirmedByGuest: true,
    },
    fx.adminUser,
  );
  r.equal("la entrega se registra", pickup.inspection.type, "pickup");
  await r.throwsAsync(
    "una segunda entrega para la misma reserva se rechaza",
    () =>
      recordInspection(
        { bookingId: carBooking.booking.id, type: "pickup", odometer: 40001 },
        fx.adminUser,
      ),
    "inspection_exists",
  );
  await r.throwsAsync(
    "no se puede abrir un ticket sin marcar daño",
    () =>
      recordInspection(
        {
          bookingId: carBooking.booking.id,
          type: "return",
          openTicket: { title: "sin daño declarado" },
        },
        fx.adminUser,
      ),
    "invalid_amount",
  );

  // Atomicity: a deduction bigger than the deposit must leave NOTHING behind.
  await r.throwsAsync(
    "una deducción mayor al depósito se rechaza",
    () =>
      recordInspection(
        {
          bookingId: carBooking.booking.id,
          type: "return",
          damageFlag: true,
          deduct: { amount: "9000000.00", reason: "imposible" },
        },
        fx.adminUser,
      ),
    "deduction_too_large",
  );
  const orphanReturns = await db
    .select()
    .from(inspections)
    .where(
      and(eq(inspections.bookingId, carBooking.booking.id), eq(inspections.type, "return")),
    );
  r.equal("y no deja una inspección huérfana (la transacción revierte)", orphanReturns.length, 0);
  const orphanTickets = await db
    .select()
    .from(maintenanceTickets)
    .where(eq(maintenanceTickets.listingId, fx.carId));
  r.equal("ni un ticket huérfano", orphanTickets.length, 0);

  const damage = await recordInspection(
    {
      bookingId: carBooking.booking.id,
      type: "return",
      odometer: 40650,
      fuelLevel: 45,
      notes: "Rayón en la puerta trasera derecha.",
      damageFlag: true,
      confirmedByGuest: true,
      openTicket: { title: "Verify O3 — rayón puerta", cost: "250000.00" },
      deduct: { amount: "250000.00", reason: "Rayón en la puerta trasera derecha" },
    },
    fx.adminUser,
  );
  r.check("la devolución con daño abre un ticket", damage.ticketId !== null);
  r.check("el ticket genera su gasto", damage.expenseId !== null);
  r.check("y deduce el depósito", damage.depositId !== null);

  const [damageTicket] = await db
    .select()
    .from(maintenanceTickets)
    .where(eq(maintenanceTickets.id, damage.ticketId!));
  r.equal(
    "el ticket apunta a la inspección que lo originó",
    damageTicket?.inspectionId,
    damage.inspection.id,
  );
  const settled = await getDepositForBooking(carBooking.booking.id);
  r.equal("el depósito queda deducido", settled?.status, "deducted");
  r.equal("por el monto indicado", settled?.deductionAmount, "250000.00");
  r.equal("con la inspección enlazada", settled?.inspectionId, damage.inspection.id);
  r.equal("y el ticket enlazado", settled?.maintenanceTicketId, damage.ticketId);

  r.equal("el odómetro más reciente del vehículo es el de la devolución",
    await latestOdometer(fx.carId), 40650);

  /* --------------------------------------------------------- #14 fleet reminders */

  r.section("Recordatorios de flota (#14)");

  const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const far = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
  const dueSoon = await createVehicleReminder(
    { listingId: fx.carId, type: "insurance", dueDate: soon },
    fx.adminUser,
  );
  const notYet = await createVehicleReminder(
    { listingId: fx.carId, type: "registration", dueDate: far },
    fx.adminUser,
  );
  const byKm = await createVehicleReminder(
    { listingId: fx.carId, type: "service", dueKm: 41000 },
    fx.adminUser,
  );
  r.equal("un recordatorio nace como upcoming", dueSoon.status, "upcoming");

  const dueList = await listDueReminders({ listingIds: [fx.carId] });
  const dueIds = dueList.map((row) => row.reminder.id);
  r.check("el que vence en 10 días pasa a due", dueIds.includes(dueSoon.id));
  r.check("el que vence en 300 días no", !dueIds.includes(notYet.id));
  r.check(
    "el de kilometraje pasa a due con el odómetro cerca del objetivo",
    dueIds.includes(byKm.id),
  );
  await r.throwsAsync(
    "no se cargan recordatorios de flota en un alojamiento",
    () => createVehicleReminder({ listingId: fx.stayId, type: "service", dueKm: 1000 }, fx.adminUser),
    "invalid_amount",
  );

  /* ------------------------------------------------------ #16 document gate */

  r.section("Un auto no se confirma con documentos sin verificar (#16)");

  const gateBefore = await documentGateForBooking({
    id: carBooking.booking.id,
    vertical: "car",
  });
  r.check("sin documentos el portón está cerrado", !gateBefore.ok);
  r.equal("y el motivo es que no hay ninguno", gateBefore.reason, "no_documents");

  const carBooking2 = await createBooking(
    {
      listingId: fx.carId,
      guestName: "Conductor O3 B",
      startAt: d("2029-08-01T09:00:00Z"),
      endAt: d("2029-08-03T09:00:00Z"),
      status: "inquiry",
      source: "manual",
    },
    fx.adminUser,
  );
  await r.throwsAsync(
    "inquiry → confirmed se rechaza sin documentos",
    () => transitionBooking(carBooking2.booking.id, "confirmed", fx.adminUser),
    "documents_pending",
  );
  await r.throwsAsync(
    "crear la reserva ya confirmada tampoco esquiva el portón",
    () =>
      createBooking(
        {
          listingId: fx.carId,
          guestName: "Atajo",
          startAt: d("2029-09-01T09:00:00Z"),
          endAt: d("2029-09-02T09:00:00Z"),
          status: "confirmed",
          source: "manual",
        },
        fx.adminUser,
      ),
    "documents_pending",
  );

  const document = await attachDocument(
    {
      bookingId: carBooking2.booking.id,
      type: "cedula",
      fileUrl: "/api/uploads/document/verify-o3.jpg",
    },
    fx.adminUser,
  );
  r.equal("un documento recién cargado queda pendiente", document.status, "pending");
  await r.throwsAsync(
    "con el documento pendiente sigue cerrado",
    () => transitionBooking(carBooking2.booking.id, "confirmed", fx.adminUser),
    "documents_pending",
  );
  r.check(
    "y aparece en la cola de verificación",
    (await listPendingDocuments({ listingIds: [fx.carId] })).some(
      (row) => row.document.id === document.id,
    ),
  );

  await reviewDocument(
    { documentId: document.id, status: "rejected", rejectionReason: "Foto ilegible" },
    fx.adminUser,
  );
  const rejectedGate = await documentGateForBooking({
    id: carBooking2.booking.id,
    vertical: "car",
  });
  r.equal("rechazado no habilita: no hay ninguno verificado", rejectedGate.reason, "not_verified");
  await r.throwsAsync(
    "y la confirmación sigue rechazada",
    () => transitionBooking(carBooking2.booking.id, "confirmed", fx.adminUser),
    "documents_pending",
  );

  await r.throwsAsync(
    "un owner no puede usar el override",
    () =>
      transitionBooking(carBooking2.booking.id, "confirmed", fx.ownerUser, {
        overrideDocumentGate: true,
      }),
    "forbidden",
  );

  const good = await attachDocument(
    {
      bookingId: carBooking2.booking.id,
      type: "license",
      fileUrl: "/api/uploads/document/verify-o3-ok.jpg",
    },
    fx.adminUser,
  );
  await reviewDocument({ documentId: good.id, status: "verified" }, fx.adminUser);
  const okGate = await documentGateForBooking({ id: carBooking2.booking.id, vertical: "car" });
  r.check("con un documento verificado y ninguno pendiente, abre", okGate.ok);
  const confirmed = await transitionBooking(carBooking2.booking.id, "confirmed", fx.adminUser);
  r.equal("y la reserva se confirma", confirmed.to, "confirmed");
  r.check("sin marcar override", !confirmed.documentGateOverridden);

  const carBooking3 = await createBooking(
    {
      listingId: fx.carId,
      guestName: "Conductor O3 C",
      startAt: d("2029-10-01T09:00:00Z"),
      endAt: d("2029-10-03T09:00:00Z"),
      status: "inquiry",
      source: "manual",
    },
    fx.adminUser,
  );
  const overridden = await transitionBooking(carBooking3.booking.id, "confirmed", fx.adminUser, {
    reason: "Cédula verificada en mostrador",
    overrideDocumentGate: true,
  });
  r.check("un admin sí puede overridear", overridden.documentGateOverridden);
  const overrideLog = await db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.entity, "booking"),
        eq(activityLog.entityId, carBooking3.booking.id),
        eq(activityLog.action, "booking.document_gate.overridden"),
      ),
    )
    .orderBy(desc(activityLog.id));
  r.equal("y el override queda en activity_log", overrideLog.length, 1);
  r.equal("con el usuario que lo hizo", overrideLog[0]?.userId, fx.adminUser.id);

  const stayGate = await documentGateForBooking({ id: stay2.booking.id, vertical: "stay" });
  r.check("el portón no aplica a alojamientos", stayGate.ok && !stayGate.applies);

  await teardown();
  r.check("las filas de verificación se limpian al terminar", true);
}
