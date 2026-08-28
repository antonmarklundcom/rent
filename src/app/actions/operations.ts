"use server";

/**
 * Server actions over the operations engine (plan §5.O6): cleaning & turnover
 * (#1), maintenance tickets (#6), expenses (#7), staff roster (#13) and
 * supplies (#17).
 *
 * Every action calls `requireRole` first — the engine functions in
 * `src/db/queries/` take no session, so this file IS the gate for the
 * logged-in surface. The cleaner's tokenized surface is separate and
 * deliberately session-free: `src/app/actions/cleaner.ts`.
 *
 * O-3 keeps these admin-only. Owners get their own scoped views of the same
 * queries in phase O-4's owner panel (§5.O10) — every read here already takes
 * a `listingIds` filter for that.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addCleaningPhoto,
  advanceCleaningTask,
  assignCleaner,
  createCleaningTask,
  updateChecklist,
} from "@/db/queries/cleaning";
import { createExpense } from "@/db/queries/expenses";
import { addTicketPhoto, createTicket, updateTicket } from "@/db/queries/maintenance";
import { adjustSupplyLevel, setSupplyLevel, upsertSupply } from "@/db/queries/supplies";
import { ADMIN_ROLES } from "@/lib/auth-core";
import { requireRole } from "@/lib/auth";
import { CLEANING_STATUSES, EXPENSE_CATEGORIES, TICKET_STATUSES } from "@/db/schema";
import { storeUpload } from "@/lib/uploads";
import { type FormState } from "@/lib/form-state";
import { toFormState } from "@/app/actions/form";

const OPS_PATHS = ["/admin", "/admin/limpieza", "/admin/mantenimiento"];

function revalidateOps() {
  for (const path of OPS_PATHS) revalidatePath(path);
}

/* ------------------------------------------------------------- cleaning #1 */

const createTaskSchema = z.object({
  listingId: z.coerce.number().int().positive(),
  bookingId: z.coerce.number().int().positive().nullish(),
  assignedUserId: z.coerce.number().int().positive().nullish(),
  dueBy: z.string().trim().min(1).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export async function createCleaningTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const parsed = createTaskSchema.parse({
      listingId: formData.get("listingId"),
      bookingId: formData.get("bookingId") || null,
      assignedUserId: formData.get("assignedUserId") || null,
      dueBy: formData.get("dueBy") || null,
      notes: formData.get("notes") || null,
    });
    const dueBy = parsed.dueBy ? new Date(parsed.dueBy) : null;
    if (dueBy && Number.isNaN(dueBy.getTime())) throw new Error("Fecha inválida");
    const task = await createCleaningTask(
      {
        listingId: parsed.listingId,
        bookingId: parsed.bookingId ?? null,
        assignedUserId: parsed.assignedUserId ?? null,
        dueBy,
        notes: parsed.notes ?? null,
      },
      user,
    );
    revalidateOps();
    return `Tarea #${task.id} creada`;
  });
}

const assignSchema = z.object({
  taskId: z.coerce.number().int().positive(),
  assignedUserId: z.coerce.number().int().positive().nullish(),
});

export async function assignCleanerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const parsed = assignSchema.parse({
      taskId: formData.get("taskId"),
      assignedUserId: formData.get("assignedUserId") || null,
    });
    await assignCleaner(parsed.taskId, parsed.assignedUserId ?? null, user);
    revalidateOps();
    return "Asignación actualizada";
  });
}

const advanceSchema = z.object({
  taskId: z.coerce.number().int().positive(),
  to: z.enum(CLEANING_STATUSES),
});

export async function advanceCleaningTaskAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const parsed = advanceSchema.parse({
      taskId: formData.get("taskId"),
      to: formData.get("to"),
    });
    const result = await advanceCleaningTask(parsed.taskId, parsed.to, user);
    revalidateOps();
    const low = result.supplies.filter((s) => s.low).map((s) => s.supplyName);
    return low.length > 0
      ? `Tarea marcada como "${parsed.to}". Stock bajo: ${low.join(", ")}`
      : `Tarea marcada como "${parsed.to}"`;
  });
}

export async function updateChecklistAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const taskId = z.coerce.number().int().positive().parse(formData.get("taskId"));
    await updateChecklist(taskId, readChecklistUpdates(formData), user);
    revalidateOps();
    return "Checklist actualizado";
  });
}

/**
 * Checklist keys arrive as `item:<key>` so they cannot collide with the form's
 * own fields. An unchecked box sends nothing, so the keys the page rendered are
 * declared separately in `itemKeys`.
 */
function readChecklistUpdates(formData: FormData): Record<string, boolean> {
  const declared = String(formData.get("itemKeys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const updates: Record<string, boolean> = {};
  for (const key of declared) updates[key] = formData.get(`item:${key}`) === "on";
  return updates;
}

export async function uploadCleaningPhotoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const taskId = z.coerce.number().int().positive().parse(formData.get("taskId"));
    const caption = (formData.get("caption") as string | null)?.trim() || null;
    const stored = await storeUpload(formData.get("photo") as File, "cleaning");
    await addCleaningPhoto(taskId, stored.url, caption, user);
    revalidateOps();
    return "Foto agregada";
  });
}

/* ---------------------------------------------------------- maintenance #6 */

const createTicketSchema = z.object({
  listingId: z.coerce.number().int().positive(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).nullish(),
  assignedUserId: z.coerce.number().int().positive().nullish(),
  cost: z.string().trim().max(20).nullish(),
});

export async function createTicketAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const parsed = createTicketSchema.parse({
      listingId: formData.get("listingId"),
      title: formData.get("title"),
      description: formData.get("description") || null,
      assignedUserId: formData.get("assignedUserId") || null,
      cost: formData.get("cost") || null,
    });
    const result = await createTicket(
      {
        listingId: parsed.listingId,
        title: parsed.title,
        description: parsed.description ?? null,
        assignedUserId: parsed.assignedUserId ?? null,
        cost: parsed.cost ?? null,
      },
      user,
    );
    revalidateOps();
    return result.expenseId
      ? `Ticket #${result.ticket.id} creado con gasto #${result.expenseId}`
      : `Ticket #${result.ticket.id} creado`;
  });
}

const updateTicketSchema = z.object({
  ticketId: z.coerce.number().int().positive(),
  status: z.enum(TICKET_STATUSES).optional(),
  assignedUserId: z.coerce.number().int().positive().nullish(),
  cost: z.string().trim().max(20).nullish(),
});

export async function updateTicketAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const raw = {
      ticketId: formData.get("ticketId"),
      status: (formData.get("status") as string | null) || undefined,
      assignedUserId: formData.get("assignedUserId") || null,
      cost: formData.get("cost") ?? null,
    };
    const parsed = updateTicketSchema.parse(raw);
    const result = await updateTicket(
      {
        ticketId: parsed.ticketId,
        status: parsed.status,
        assignedUserId:
          formData.get("assignedUserId") === null ? undefined : (parsed.assignedUserId ?? null),
        cost: formData.get("cost") === null ? undefined : (parsed.cost ?? null),
      },
      user,
    );
    revalidateOps();
    if (result.expenseLocked) {
      return `Ticket #${result.ticket.id} actualizado. El gasto ya fue facturado en un estado de cuenta: cargá una corrección aparte.`;
    }
    return result.expenseId
      ? `Ticket #${result.ticket.id} actualizado (gasto #${result.expenseId})`
      : `Ticket #${result.ticket.id} actualizado`;
  });
}

export async function uploadTicketPhotoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const ticketId = z.coerce.number().int().positive().parse(formData.get("ticketId"));
    const caption = (formData.get("caption") as string | null)?.trim() || null;
    const stored = await storeUpload(formData.get("photo") as File, "maintenance");
    await addTicketPhoto(ticketId, stored.url, caption, user);
    revalidateOps();
    return "Foto agregada";
  });
}

/* --------------------------------------------------------------- expenses #7 */

const expenseSchema = z.object({
  listingId: z.coerce.number().int().positive(),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.string().trim().min(1).max(20),
  incurredOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().max(300).nullish(),
});

export async function createExpenseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const parsed = expenseSchema.parse({
      listingId: formData.get("listingId"),
      category: formData.get("category"),
      amount: formData.get("amount"),
      incurredOn: formData.get("incurredOn"),
      description: formData.get("description") || null,
    });
    const expense = await createExpense(
      {
        listingId: parsed.listingId,
        category: parsed.category,
        amount: parsed.amount,
        incurredOn: parsed.incurredOn,
        description: parsed.description ?? null,
      },
      user,
    );
    revalidateOps();
    return `Gasto #${expense.id} registrado`;
  });
}

/* -------------------------------------------------------------- supplies #17 */

export async function adjustSupplyLevelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const levelId = z.coerce.number().int().positive().parse(formData.get("levelId"));
    const delta = z.coerce.number().int().parse(formData.get("delta"));
    const row = await adjustSupplyLevel(levelId, delta, user);
    revalidateOps();
    return `Stock actualizado: ${row.qty}`;
  });
}

const supplyLevelSchema = z.object({
  listingId: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(140),
  unit: z.string().trim().max(40).optional(),
  consumedPerCleaning: z.coerce.number().int().min(0).max(100),
  qty: z.coerce.number().int().min(0),
  lowThreshold: z.coerce.number().int().min(0),
});

export async function setSupplyLevelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const parsed = supplyLevelSchema.parse({
      listingId: formData.get("listingId"),
      name: formData.get("name"),
      unit: formData.get("unit") || undefined,
      consumedPerCleaning: formData.get("consumedPerCleaning") ?? 0,
      qty: formData.get("qty") ?? 0,
      lowThreshold: formData.get("lowThreshold") ?? 0,
    });
    const supply = await upsertSupply({
      name: parsed.name,
      unit: parsed.unit,
      consumedPerCleaning: parsed.consumedPerCleaning,
    });
    await setSupplyLevel(
      {
        supplyId: supply.id,
        listingId: parsed.listingId,
        qty: parsed.qty,
        lowThreshold: parsed.lowThreshold,
      },
      user,
    );
    revalidateOps();
    return `Stock de ${supply.name} actualizado`;
  });
}
