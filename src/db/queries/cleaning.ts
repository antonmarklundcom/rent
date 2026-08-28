/**
 * Cleaning & turnover (#1, #13 — plan §5.O6).
 *
 * Two ways in, one engine:
 *
 * - **Admin/owner**, holding a session, addressing a task by id. The caller
 *   has already passed `requireRole` and `assertCanAccessListing`.
 * - **Cleaner**, holding nothing but a magic token (plan §2). Every `*ByToken`
 *   function resolves the token to exactly ONE task id and writes only that
 *   id — no function takes a token AND a task id, so a token can never be
 *   pointed at somebody else's work.
 *
 * The status rules themselves live in the pure `src/lib/cleaning.ts`.
 */
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  cleaningTasks,
  listings,
  users,
  type CleaningStatus,
  type Vertical,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { consumeSuppliesForCleaning, type SupplyConsumption } from "@/db/queries/supplies";
import { addPhoto } from "@/db/queries/photos";
import { inTransaction } from "@/db/queries/tx";
import type { SessionUser } from "@/lib/auth-core";
import {
  applyChecklistUpdate,
  assertCleaningTransition,
  defaultChecklist,
  nextCleaningStatus,
  OPEN_CLEANING_STATUSES,
  type ChecklistItem,
} from "@/lib/cleaning";
import { DomainError } from "@/lib/errors";
import { newMagicToken } from "@/lib/magic-link";

export type CleaningTask = typeof cleaningTasks.$inferSelect;

/* -------------------------------------------------------------------------- */
/* Creating                                                                    */
/* -------------------------------------------------------------------------- */

export type CreateCleaningTaskInput = {
  listingId: number;
  bookingId?: number | null;
  assignedUserId?: number | null;
  dueBy?: Date | null;
  checklist?: ChecklistItem[] | null;
  notes?: string | null;
};

export async function createCleaningTask(
  input: CreateCleaningTaskInput,
  actor?: SessionUser | null,
  executor?: Executor,
): Promise<CleaningTask> {
  return inTransaction(executor, async (tx) => {
    const [listing] = await tx
      .select({ id: listings.id, vertical: listings.vertical })
      .from(listings)
      .where(eq(listings.id, input.listingId))
      .limit(1);
    if (!listing) {
      throw new DomainError("La publicación no existe", "not_found", {
        listingId: input.listingId,
      });
    }
    if (input.assignedUserId != null) {
      const [assignee] = await tx
        .select({ role: users.role, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, input.assignedUserId))
        .limit(1);
      if (!assignee || !assignee.isActive || assignee.role !== "cleaner") {
        throw new DomainError(
          "Sólo se pueden asignar tareas a personal de limpieza",
          "invalid_amount",
          { assignedUserId: input.assignedUserId },
        );
      }
    }
    return insertTask(tx, {
      listingId: listing.id,
      bookingId: input.bookingId ?? null,
      assignedUserId: input.assignedUserId ?? null,
      dueBy: input.dueBy ?? null,
      checklist: input.checklist ?? defaultChecklist(listing.vertical),
      notes: input.notes?.trim() || null,
      actorId: actor?.id ?? null,
      action: "cleaning_task.created",
    });
  });
}

/** Insert with a fresh magic token, retrying the (astronomically rare) collision. */
async function insertTask(
  tx: Executor,
  values: {
    listingId: number;
    bookingId: number | null;
    assignedUserId: number | null;
    dueBy: Date | null;
    checklist: ChecklistItem[];
    notes: string | null;
    actorId: number | null;
    action: string;
  },
): Promise<CleaningTask> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const magicToken = newMagicToken();
    try {
      const [inserted] = await tx
        .insert(cleaningTasks)
        .values({
          listingId: values.listingId,
          bookingId: values.bookingId,
          status: "needed",
          assignedUserId: values.assignedUserId,
          dueBy: values.dueBy,
          magicToken,
          checklist: values.checklist,
          notes: values.notes,
        })
        .$returningId();
      const [row] = await tx
        .select()
        .from(cleaningTasks)
        .where(eq(cleaningTasks.id, inserted!.id))
        .limit(1);
      await logActivity(
        {
          entity: "cleaning_task",
          entityId: inserted!.id,
          action: values.action,
          userId: values.actorId,
          meta: {
            listingId: values.listingId,
            bookingId: values.bookingId,
            assignedUserId: values.assignedUserId,
          },
        },
        tx,
      );
      return row!;
    } catch (error) {
      if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
    }
  }
  throw new DomainError("No se pudo generar el enlace de la tarea", "not_found");
}

/**
 * Checkout ⇒ turnover task (plan §3 group A, §5.O6).
 *
 * Called by `transitionBooking` INSIDE the booking's transaction, so a booking
 * cannot be completed without its cleaning task, and a failed task insert
 * rolls the checkout back rather than losing the turnover.
 *
 * Idempotent by design: a booking that already has a task gets that task back.
 * `cleaning_tasks` has no unique key on `booking_id` (a listing legitimately
 * gets several tasks for one booking — a mid-stay clean, then the turnover),
 * so the guard is an explicit lookup rather than a constraint.
 */
export async function ensureTurnoverTask(
  booking: { id: number; listingId: number; endAt: Date },
  listing: { vertical: Vertical },
  tx: Executor,
  actor?: SessionUser | null,
): Promise<{ task: CleaningTask; created: boolean }> {
  const [existing] = await tx
    .select()
    .from(cleaningTasks)
    .where(eq(cleaningTasks.bookingId, booking.id))
    .orderBy(desc(cleaningTasks.id))
    .limit(1);
  if (existing) return { task: existing, created: false };

  const task = await insertTask(tx, {
    listingId: booking.listingId,
    bookingId: booking.id,
    // Unassigned: the roster decides who, the checkout only decides that.
    assignedUserId: null,
    dueBy: booking.endAt,
    checklist: defaultChecklist(listing.vertical),
    notes: null,
    actorId: actor?.id ?? null,
    action: "cleaning_task.auto_created",
  });
  return { task, created: true };
}

/* -------------------------------------------------------------------------- */
/* Guest-readiness gate                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Open turnover tasks that stand between a listing and its next guest.
 *
 * A task blocks if it is still `needed | in_progress` AND it was due before
 * the moment asked about — a task due next week is somebody else's turnover,
 * not this check-in's.
 */
export async function openTasksBlockingCheckIn(
  listingId: number,
  at: Date,
  executor: Executor = db,
): Promise<CleaningTask[]> {
  return executor
    .select()
    .from(cleaningTasks)
    .where(
      and(
        eq(cleaningTasks.listingId, listingId),
        inArray(cleaningTasks.status, [...OPEN_CLEANING_STATUSES]),
        or(isNull(cleaningTasks.dueBy), lte(cleaningTasks.dueBy, at)),
      ),
    )
    .orderBy(asc(cleaningTasks.dueBy));
}

export async function isListingGuestReady(
  listingId: number,
  at: Date,
  executor: Executor = db,
): Promise<boolean> {
  return (await openTasksBlockingCheckIn(listingId, at, executor)).length === 0;
}

/**
 * A stay is not guest-ready until its turnover is `ready` (plan §5.O6).
 *
 * Enforced on `confirmed → active` — the moment a guest is actually let in.
 * There is no override: the resolution is to mark the task ready, which is one
 * tap for the cleaner and one click for an admin, and which is also the honest
 * record. An override would let somebody assert "clean" without saying so.
 *
 * Cars are not gated here — a returned vehicle's condition is an inspection
 * (#5), which is a different record with different evidence.
 */
export async function assertGuestReady(
  listing: { id: number; vertical: Vertical },
  at: Date,
  executor: Executor = db,
): Promise<void> {
  if (listing.vertical !== "stay") return;
  const blocking = await openTasksBlockingCheckIn(listing.id, at, executor);
  if (blocking.length === 0) return;
  throw new DomainError(
    "La propiedad todavía no está lista: hay limpieza pendiente",
    "not_guest_ready",
    {
      listingId: listing.id,
      taskIds: blocking.map((t) => t.id),
      statuses: blocking.map((t) => t.status),
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Mutating a task                                                             */
/* -------------------------------------------------------------------------- */

export type AdvanceResult = {
  task: CleaningTask;
  from: CleaningStatus;
  to: CleaningStatus;
  /** Populated only on the transition to `ready`. */
  supplies: SupplyConsumption[];
};

async function loadTaskForUpdate(tx: Executor, taskId: number): Promise<CleaningTask> {
  const [row] = await tx
    .select()
    .from(cleaningTasks)
    .where(eq(cleaningTasks.id, taskId))
    .limit(1)
    .for("update");
  if (!row) throw new DomainError("La tarea no existe", "not_found", { taskId });
  return row;
}

/**
 * Move a task through `needed → in_progress → ready`.
 *
 * Reaching `ready` consumes the listing's supplies (#17) in the SAME
 * transaction: the towels leave stock exactly when the task claims they were
 * used, or neither happens.
 */
export async function advanceCleaningTask(
  taskId: number,
  to: CleaningStatus,
  actor?: SessionUser | null,
  options: { actorLabel?: string } = {},
): Promise<AdvanceResult> {
  return db.transaction(async (tx) => {
    const task = await loadTaskForUpdate(tx, taskId);
    const from = task.status;
    assertCleaningTransition(from, to, task.checklist);

    const patch: Partial<typeof cleaningTasks.$inferInsert> = { status: to };
    if (to === "in_progress" && !task.startedAt) patch.startedAt = new Date();
    if (to === "ready") patch.completedAt = new Date();

    await tx.update(cleaningTasks).set(patch).where(eq(cleaningTasks.id, task.id));

    const supplies =
      to === "ready" ? await consumeSuppliesForCleaning(task.listingId, tx) : [];

    await logActivity(
      {
        entity: "cleaning_task",
        entityId: task.id,
        action: `cleaning_task.${to}`,
        userId: actor?.id ?? null,
        meta: {
          listingId: task.listingId,
          bookingId: task.bookingId,
          from,
          to,
          by: options.actorLabel ?? (actor ? `user:${actor.id}` : "magic_link"),
          supplies: supplies.map((s) => ({ id: s.supplyId, remaining: s.remaining })),
        },
      },
      tx,
    );

    const [updated] = await tx
      .select()
      .from(cleaningTasks)
      .where(eq(cleaningTasks.id, task.id))
      .limit(1);
    return { task: updated!, from, to, supplies };
  });
}

/** Tick or untick checklist items. Unknown keys are ignored, never fatal. */
export async function updateChecklist(
  taskId: number,
  updates: Record<string, boolean>,
  actor?: SessionUser | null,
): Promise<CleaningTask> {
  return db.transaction(async (tx) => {
    const task = await loadTaskForUpdate(tx, taskId);
    if (task.status === "ready") {
      throw new DomainError(
        "La tarea ya está marcada como lista",
        "invalid_transition",
        { taskId, status: task.status },
      );
    }
    const checklist = applyChecklistUpdate(task.checklist, updates);
    await tx.update(cleaningTasks).set({ checklist }).where(eq(cleaningTasks.id, task.id));
    const [updated] = await tx
      .select()
      .from(cleaningTasks)
      .where(eq(cleaningTasks.id, task.id))
      .limit(1);
    return updated!;
  });
}

export async function assignCleaner(
  taskId: number,
  assignedUserId: number | null,
  actor?: SessionUser | null,
): Promise<CleaningTask> {
  return db.transaction(async (tx) => {
    const task = await loadTaskForUpdate(tx, taskId);
    if (assignedUserId !== null) {
      const [assignee] = await tx
        .select({ id: users.id, role: users.role, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, assignedUserId))
        .limit(1);
      if (!assignee || !assignee.isActive) {
        throw new DomainError("La persona asignada no existe", "not_found", { assignedUserId });
      }
      // Only `cleaner` rows: the roster dropdown lists them, and
      // `cleanerJobCounts` (payroll, #13) counts them. Letting an admin be
      // assigned would put work on a roster nobody is ever paid from.
      if (assignee.role !== "cleaner") {
        throw new DomainError(
          "Sólo se pueden asignar tareas a personal de limpieza",
          "invalid_amount",
          { assignedUserId, role: assignee.role },
        );
      }
    }
    await tx.update(cleaningTasks).set({ assignedUserId }).where(eq(cleaningTasks.id, task.id));
    await logActivity(
      {
        entity: "cleaning_task",
        entityId: task.id,
        action: "cleaning_task.assigned",
        userId: actor?.id ?? null,
        meta: { from: task.assignedUserId, to: assignedUserId },
      },
      tx,
    );
    const [updated] = await tx
      .select()
      .from(cleaningTasks)
      .where(eq(cleaningTasks.id, task.id))
      .limit(1);
    return updated!;
  });
}

/* -------------------------------------------------------------------------- */
/* Magic-link surface — a token addresses exactly one task and nothing else    */
/* -------------------------------------------------------------------------- */

async function taskIdForToken(token: string): Promise<number> {
  // Same length guard as `resolveMagicToken`: a short string is never a token.
  if (!token || token.length < 16) {
    throw new DomainError("Este enlace no es válido", "not_found");
  }
  const [row] = await db
    .select({ id: cleaningTasks.id })
    .from(cleaningTasks)
    .where(eq(cleaningTasks.magicToken, token))
    .limit(1);
  if (!row) throw new DomainError("Este enlace no es válido", "not_found");
  return row.id;
}

/** Advance one step along the flow — what the cleaner's single button does. */
export async function advanceTaskByTokenToNext(token: string): Promise<AdvanceResult> {
  const taskId = await taskIdForToken(token);
  const [row] = await db
    .select({ status: cleaningTasks.status })
    .from(cleaningTasks)
    .where(eq(cleaningTasks.id, taskId))
    .limit(1);
  const to = nextCleaningStatus(row!.status);
  if (!to) {
    throw new DomainError("La tarea ya está lista", "invalid_transition", {
      status: row!.status,
    });
  }
  return advanceCleaningTask(taskId, to, null, { actorLabel: "magic_link" });
}

export async function updateChecklistByToken(
  token: string,
  updates: Record<string, boolean>,
): Promise<CleaningTask> {
  return updateChecklist(await taskIdForToken(token), updates, null);
}

export async function addPhotoByToken(token: string, url: string, caption: string | null) {
  const taskId = await taskIdForToken(token);
  return addPhoto({
    subjectType: "cleaning_task",
    subjectId: taskId,
    url,
    caption,
    uploadedBy: null,
  });
}

/* -------------------------------------------------------------------------- */
/* Reads — roster (#13), detail, counts                                        */
/* -------------------------------------------------------------------------- */

export type RosterFilter = {
  /** UTC day, `YYYY-MM-DD`. Omit for "everything still open". */
  day?: string;
  assignedUserId?: number | null;
  statuses?: CleaningStatus[];
  listingIds?: number[];
  limit?: number;
};

/** The day roster (#13): who is cleaning what, in due order. */
export async function listRoster(filter: RosterFilter = {}, executor: Executor = db) {
  if (filter.listingIds && filter.listingIds.length === 0) return [];
  const dayStart = filter.day ? new Date(`${filter.day}T00:00:00Z`) : null;
  if (dayStart && Number.isNaN(dayStart.getTime())) {
    throw new DomainError(`Fecha inválida: ${filter.day}`, "invalid_range");
  }
  const dayEnd = dayStart ? new Date(dayStart.getTime() + 86_400_000) : null;

  return executor
    .select({
      task: cleaningTasks,
      listingTitle: listings.title,
      listingVertical: listings.vertical,
      assigneeName: users.name,
      bookingReference: bookings.reference,
    })
    .from(cleaningTasks)
    .innerJoin(listings, eq(listings.id, cleaningTasks.listingId))
    .leftJoin(users, eq(users.id, cleaningTasks.assignedUserId))
    .leftJoin(bookings, eq(bookings.id, cleaningTasks.bookingId))
    .where(
      and(
        dayStart ? gte(cleaningTasks.dueBy, dayStart) : undefined,
        dayEnd ? lt(cleaningTasks.dueBy, dayEnd) : undefined,
        filter.assignedUserId === null
          ? isNull(cleaningTasks.assignedUserId)
          : filter.assignedUserId !== undefined
            ? eq(cleaningTasks.assignedUserId, filter.assignedUserId)
            : undefined,
        filter.statuses?.length ? inArray(cleaningTasks.status, filter.statuses) : undefined,
        filter.listingIds ? inArray(cleaningTasks.listingId, filter.listingIds) : undefined,
      ),
    )
    .orderBy(asc(cleaningTasks.dueBy), asc(cleaningTasks.id))
    .limit(filter.limit ?? 200);
}

export type CleanerJobCount = {
  userId: number;
  name: string;
  email: string;
  completed: number;
  open: number;
};

/**
 * Completed jobs per cleaner (#13) — what payroll is calculated from, so it
 * counts `ready` tasks by `completed_at`, not by whoever happens to be
 * assigned to an unfinished one.
 */
export async function cleanerJobCounts(
  window: { from?: Date; to?: Date } = {},
  executor: Executor = db,
): Promise<CleanerJobCount[]> {
  const staff = await executor
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.role, "cleaner"), eq(users.isActive, true)))
    .orderBy(asc(users.name));
  if (staff.length === 0) return [];
  const ids = staff.map((s) => s.id);

  const completedRows = await executor
    .select({ userId: cleaningTasks.assignedUserId, value: count() })
    .from(cleaningTasks)
    .where(
      and(
        inArray(cleaningTasks.assignedUserId, ids),
        eq(cleaningTasks.status, "ready"),
        window.from ? gte(cleaningTasks.completedAt, window.from) : undefined,
        window.to ? lt(cleaningTasks.completedAt, window.to) : undefined,
      ),
    )
    .groupBy(cleaningTasks.assignedUserId);

  const openRows = await executor
    .select({ userId: cleaningTasks.assignedUserId, value: count() })
    .from(cleaningTasks)
    .where(
      and(
        inArray(cleaningTasks.assignedUserId, ids),
        inArray(cleaningTasks.status, [...OPEN_CLEANING_STATUSES]),
      ),
    )
    .groupBy(cleaningTasks.assignedUserId);

  const completed = new Map(completedRows.map((r) => [r.userId, Number(r.value)]));
  const open = new Map(openRows.map((r) => [r.userId, Number(r.value)]));
  return staff.map((s) => ({
    userId: s.id,
    name: s.name,
    email: s.email,
    completed: completed.get(s.id) ?? 0,
    open: open.get(s.id) ?? 0,
  }));
}

/** Active cleaners, for the assignment dropdown. */
export async function listCleaners(executor: Executor = db) {
  return executor
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.role, "cleaner"), eq(users.isActive, true)))
    .orderBy(asc(users.name));
}

export async function countOpenTasks(
  options: { listingIds?: number[] } = {},
  executor: Executor = db,
): Promise<number> {
  if (options.listingIds && options.listingIds.length === 0) return 0;
  const [row] = await executor
    .select({ value: count() })
    .from(cleaningTasks)
    .where(
      and(
        inArray(cleaningTasks.status, [...OPEN_CLEANING_STATUSES]),
        options.listingIds ? inArray(cleaningTasks.listingId, options.listingIds) : undefined,
      ),
    );
  return Number(row?.value ?? 0);
}
