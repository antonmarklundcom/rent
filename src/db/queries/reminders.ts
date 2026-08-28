/**
 * Fleet care & document expiry (#14, plan §5.O8).
 *
 * Per-vehicle reminders for service, insurance and registration/habilitación.
 * The stored `status` is a cache of what `src/lib/reminders.ts` says today —
 * `refreshVehicleReminders` walks the rows through the pure rules and persists
 * the promotions, so the admin "due soon" list is a plain indexed read and the
 * thresholds live in exactly one place.
 */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  listings,
  vehicleReminders,
  type ReminderStatus,
  type ReminderType,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { latestOdometer } from "@/db/queries/inspections";
import { inTransaction } from "@/db/queries/tx";
import type { SessionUser } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";
import { daysRemaining, deriveReminderStatus, isOverdue } from "@/lib/reminders";

export type VehicleReminder = typeof vehicleReminders.$inferSelect;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type CreateReminderInput = {
  listingId: number;
  type: ReminderType;
  label?: string | null;
  dueDate?: string | null;
  dueKm?: number | null;
};

export async function createVehicleReminder(
  input: CreateReminderInput,
  actor?: SessionUser | null,
  executor?: Executor,
): Promise<VehicleReminder> {
  if (!input.dueDate && input.dueKm == null) {
    throw new DomainError("El recordatorio necesita una fecha o un kilometraje", "invalid_amount");
  }
  if (input.dueDate && !YMD.test(input.dueDate.trim())) {
    throw new DomainError(`Fecha inválida: ${input.dueDate}`, "invalid_range");
  }
  if (input.dueKm != null && (!Number.isInteger(input.dueKm) || input.dueKm < 0)) {
    throw new DomainError("El kilometraje tiene que ser un entero positivo", "invalid_amount");
  }

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
    if (listing.vertical !== "car") {
      throw new DomainError(
        "Los recordatorios de flota son sólo para vehículos",
        "invalid_amount",
        { listingId: listing.id, vertical: listing.vertical },
      );
    }
    const [inserted] = await tx
      .insert(vehicleReminders)
      .values({
        listingId: listing.id,
        type: input.type,
        label: input.label?.trim() || null,
        dueDate: input.dueDate?.trim() || null,
        dueKm: input.dueKm ?? null,
        status: "upcoming",
      })
      .$returningId();
    await logActivity(
      {
        entity: "vehicle_reminder",
        entityId: inserted!.id,
        action: "reminder.created",
        userId: actor?.id ?? null,
        meta: {
          listingId: listing.id,
          type: input.type,
          dueDate: input.dueDate ?? null,
          dueKm: input.dueKm ?? null,
        },
      },
      tx,
    );
    const [row] = await tx
      .select()
      .from(vehicleReminders)
      .where(eq(vehicleReminders.id, inserted!.id))
      .limit(1);
    return row!;
  });
}

export type UpdateReminderInput = {
  reminderId: number;
  label?: string | null;
  dueDate?: string | null;
  dueKm?: number | null;
  status?: ReminderStatus;
};

export async function updateVehicleReminder(
  input: UpdateReminderInput,
  actor?: SessionUser | null,
): Promise<VehicleReminder> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(vehicleReminders)
      .where(eq(vehicleReminders.id, input.reminderId))
      .limit(1)
      .for("update");
    if (!row) {
      throw new DomainError("El recordatorio no existe", "not_found", {
        reminderId: input.reminderId,
      });
    }
    const patch: Partial<typeof vehicleReminders.$inferInsert> = {};
    if (input.label !== undefined) patch.label = input.label?.trim() || null;
    if (input.dueDate !== undefined) {
      if (input.dueDate && !YMD.test(input.dueDate.trim())) {
        throw new DomainError(`Fecha inválida: ${input.dueDate}`, "invalid_range");
      }
      patch.dueDate = input.dueDate?.trim() || null;
    }
    if (input.dueKm !== undefined) patch.dueKm = input.dueKm;
    if (input.status !== undefined && input.status !== row.status) {
      patch.status = input.status;
      // Completing a reminder is the fact payroll and the service book care
      // about, so it carries its own timestamp.
      patch.completedAt = input.status === "done" ? new Date() : null;
    }
    if (Object.keys(patch).length === 0) return row;

    await tx
      .update(vehicleReminders)
      .set(patch)
      .where(eq(vehicleReminders.id, input.reminderId));
    await logActivity(
      {
        entity: "vehicle_reminder",
        entityId: input.reminderId,
        action: input.status === "done" ? "reminder.done" : "reminder.updated",
        userId: actor?.id ?? null,
        meta: { listingId: row.listingId, changes: patch, from: row.status },
      },
      tx,
    );
    const [updated] = await tx
      .select()
      .from(vehicleReminders)
      .where(eq(vehicleReminders.id, input.reminderId))
      .limit(1);
    return updated!;
  });
}

export async function deleteVehicleReminder(
  reminderId: number,
  actor?: SessionUser | null,
): Promise<void> {
  const [row] = await db
    .select({ listingId: vehicleReminders.listingId })
    .from(vehicleReminders)
    .where(eq(vehicleReminders.id, reminderId))
    .limit(1);
  if (!row) {
    throw new DomainError("El recordatorio no existe", "not_found", { reminderId });
  }
  await db.delete(vehicleReminders).where(eq(vehicleReminders.id, reminderId));
  await logActivity({
    entity: "vehicle_reminder",
    entityId: reminderId,
    action: "reminder.deleted",
    userId: actor?.id ?? null,
    meta: { listingId: row.listingId },
  });
}

/**
 * Promote `upcoming` reminders that have come due, by date or by odometer.
 *
 * Cheap and idempotent: only rows whose derived status differs from the stored
 * one are written, so calling it on every admin page load costs nothing once
 * the fleet is settled. Cron-ready for phase S-3 if it ever needs to notify.
 */
export async function refreshVehicleReminders(
  options: { listingIds?: number[]; now?: Date } = {},
): Promise<{ promoted: number }> {
  const today = options.now ?? new Date();
  const rows = await db
    .select()
    .from(vehicleReminders)
    .where(
      and(
        ne(vehicleReminders.status, "done"),
        options.listingIds && options.listingIds.length > 0
          ? inArray(vehicleReminders.listingId, options.listingIds)
          : undefined,
      ),
    );
  if (rows.length === 0) return { promoted: 0 };

  const odometers = new Map<number, number | null>();
  for (const listingId of new Set(rows.map((r) => r.listingId))) {
    odometers.set(listingId, await latestOdometer(listingId));
  }

  let promoted = 0;
  for (const row of rows) {
    const next = deriveReminderStatus(row, {
      today,
      odometer: odometers.get(row.listingId) ?? null,
    });
    if (next !== row.status) {
      await db
        .update(vehicleReminders)
        .set({ status: next })
        .where(eq(vehicleReminders.id, row.id));
      promoted += 1;
    }
  }
  return { promoted };
}

export type ReminderRow = {
  reminder: VehicleReminder;
  listingTitle: string;
  daysLeft: number | null;
  overdue: boolean;
  odometer: number | null;
};

/**
 * The admin alert list (#14): everything due or overdue, soonest first.
 * Refreshes statuses first so the list can never be stale by a day.
 */
export async function listDueReminders(
  options: { listingIds?: number[]; includeUpcoming?: boolean; now?: Date } = {},
): Promise<ReminderRow[]> {
  if (options.listingIds && options.listingIds.length === 0) return [];
  await refreshVehicleReminders({ listingIds: options.listingIds, now: options.now });
  const today = options.now ?? new Date();
  const statuses: ReminderStatus[] = options.includeUpcoming ? ["due", "upcoming"] : ["due"];

  const rows = await db
    .select({ reminder: vehicleReminders, listingTitle: listings.title })
    .from(vehicleReminders)
    .innerJoin(listings, eq(listings.id, vehicleReminders.listingId))
    .where(
      and(
        inArray(vehicleReminders.status, statuses),
        options.listingIds ? inArray(vehicleReminders.listingId, options.listingIds) : undefined,
      ),
    )
    .orderBy(asc(vehicleReminders.dueDate), asc(vehicleReminders.id));

  const odometers = new Map<number, number | null>();
  for (const listingId of new Set(rows.map((r) => r.reminder.listingId))) {
    odometers.set(listingId, await latestOdometer(listingId));
  }

  return rows.map(({ reminder, listingTitle }) => ({
    reminder,
    listingTitle,
    daysLeft: daysRemaining(reminder, today),
    overdue: isOverdue(reminder, today),
    odometer: odometers.get(reminder.listingId) ?? null,
  }));
}

