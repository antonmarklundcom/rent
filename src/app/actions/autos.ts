"use server";

/**
 * Server actions for autos protection (plan §5.O8): handover inspections (#5),
 * fleet reminders (#14) and renter document verification (#16).
 *
 * Admin-only. These actions decide who pays for damage and who is allowed to
 * drive away, so `requireRole(ADMIN_ROLES)` is the first line of every one of
 * them and the override below is gated a second time inside the engine.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { transitionBooking } from "@/db/queries/bookings";
import { attachDocument, reviewDocument } from "@/db/queries/documents";
import {
  addInspectionPhoto,
  confirmInspectionByGuest,
  recordInspection,
} from "@/db/queries/inspections";
import {
  createVehicleReminder,
  deleteVehicleReminder,
  updateVehicleReminder,
} from "@/db/queries/reminders";
import { DOCUMENT_TYPES, INSPECTION_TYPES, REMINDER_STATUSES, REMINDER_TYPES } from "@/db/schema";
import { ADMIN_ROLES } from "@/lib/auth-core";
import { requireRole } from "@/lib/auth";
import { storeUpload } from "@/lib/uploads";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/app/actions/form";

function revalidateBooking(bookingId: number) {
  revalidatePath("/admin");
  revalidatePath("/admin/flota");
  revalidatePath(`/admin/reservas/${bookingId}`);
}

/* ------------------------------------------------------------ inspections #5 */

const inspectionSchema = z.object({
  bookingId: z.coerce.number().int().positive(),
  type: z.enum(INSPECTION_TYPES),
  odometer: z.coerce.number().int().min(0).nullish(),
  fuelLevel: z.coerce.number().int().min(0).max(100).nullish(),
  notes: z.string().trim().max(4000).nullish(),
  damageFlag: z.boolean(),
  confirmedByGuest: z.boolean(),
  ticketTitle: z.string().trim().max(200).nullish(),
  ticketCost: z.string().trim().max(20).nullish(),
  deductionAmount: z.string().trim().max(20).nullish(),
  deductionReason: z.string().trim().max(1000).nullish(),
});

/**
 * Record a handover. When the return finds damage, the ticket (#6) and the
 * deposit deduction (#9) are requested here and land in ONE transaction with
 * the inspection — see `recordInspection`.
 */
export async function recordInspectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const parsed = inspectionSchema.parse({
      bookingId: formData.get("bookingId"),
      type: formData.get("type"),
      odometer: formData.get("odometer") || null,
      fuelLevel: formData.get("fuelLevel") || null,
      notes: formData.get("notes") || null,
      damageFlag: formData.get("damageFlag") === "on",
      confirmedByGuest: formData.get("confirmedByGuest") === "on",
      ticketTitle: formData.get("ticketTitle") || null,
      ticketCost: formData.get("ticketCost") || null,
      deductionAmount: formData.get("deductionAmount") || null,
      deductionReason: formData.get("deductionReason") || null,
    });

    const result = await recordInspection(
      {
        bookingId: parsed.bookingId,
        type: parsed.type,
        odometer: parsed.odometer ?? null,
        fuelLevel: parsed.fuelLevel ?? null,
        notes: parsed.notes ?? null,
        damageFlag: parsed.damageFlag,
        confirmedByGuest: parsed.confirmedByGuest,
        openTicket: parsed.ticketTitle
          ? { title: parsed.ticketTitle, cost: parsed.ticketCost ?? null }
          : null,
        deduct:
          parsed.deductionAmount && parsed.deductionReason
            ? { amount: parsed.deductionAmount, reason: parsed.deductionReason }
            : null,
      },
      user,
    );
    revalidateBooking(parsed.bookingId);

    const parts = [`Inspección #${result.inspection.id} registrada`];
    if (result.ticketId) parts.push(`ticket #${result.ticketId}`);
    if (result.expenseId) parts.push(`gasto #${result.expenseId}`);
    if (result.depositId) parts.push(`depósito #${result.depositId} deducido`);
    return parts.join(" · ");
  });
}

export async function uploadInspectionPhotoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const inspectionId = z.coerce
      .number()
      .int()
      .positive()
      .parse(formData.get("inspectionId"));
    const bookingId = z.coerce.number().int().positive().parse(formData.get("bookingId"));
    const caption = (formData.get("caption") as string | null)?.trim() || null;
    const stored = await storeUpload(formData.get("photo") as File, "inspection");
    await addInspectionPhoto(inspectionId, stored.url, caption, user);
    revalidateBooking(bookingId);
    return "Foto agregada";
  });
}

export async function confirmInspectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const inspectionId = z.coerce
      .number()
      .int()
      .positive()
      .parse(formData.get("inspectionId"));
    const bookingId = z.coerce.number().int().positive().parse(formData.get("bookingId"));
    await confirmInspectionByGuest(inspectionId, user);
    revalidateBooking(bookingId);
    return "Conformidad del huésped registrada";
  });
}

/* -------------------------------------------------------------- reminders #14 */

const createReminderSchema = z.object({
  listingId: z.coerce.number().int().positive(),
  type: z.enum(REMINDER_TYPES),
  label: z.string().trim().max(160).nullish(),
  dueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  dueKm: z.coerce.number().int().min(0).nullish(),
});

export async function createReminderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const parsed = createReminderSchema.parse({
      listingId: formData.get("listingId"),
      type: formData.get("type"),
      label: formData.get("label") || null,
      dueDate: formData.get("dueDate") || null,
      dueKm: formData.get("dueKm") || null,
    });
    const reminder = await createVehicleReminder(
      {
        listingId: parsed.listingId,
        type: parsed.type,
        label: parsed.label ?? null,
        dueDate: parsed.dueDate ?? null,
        dueKm: parsed.dueKm ?? null,
      },
      user,
    );
    revalidatePath("/admin/flota");
    return `Recordatorio #${reminder.id} creado`;
  });
}

const updateReminderSchema = z.object({
  reminderId: z.coerce.number().int().positive(),
  status: z.enum(REMINDER_STATUSES).optional(),
  label: z.string().trim().max(160).nullish(),
  dueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  dueKm: z.coerce.number().int().min(0).nullish(),
});

export async function updateReminderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const parsed = updateReminderSchema.parse({
      reminderId: formData.get("reminderId"),
      status: (formData.get("status") as string | null) || undefined,
      label: formData.get("label") ?? null,
      dueDate: formData.get("dueDate") ?? null,
      dueKm: formData.get("dueKm") ?? null,
    });
    await updateVehicleReminder(
      {
        reminderId: parsed.reminderId,
        status: parsed.status,
        label: formData.get("label") === null ? undefined : (parsed.label ?? null),
        dueDate: formData.get("dueDate") === null ? undefined : (parsed.dueDate ?? null),
        dueKm: formData.get("dueKm") === null ? undefined : (parsed.dueKm ?? null),
      },
      user,
    );
    revalidatePath("/admin/flota");
    return "Recordatorio actualizado";
  });
}

export async function deleteReminderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const reminderId = z.coerce.number().int().positive().parse(formData.get("reminderId"));
    await deleteVehicleReminder(reminderId, user);
    revalidatePath("/admin/flota");
    return "Recordatorio eliminado";
  });
}

/* -------------------------------------------------------------- documents #16 */

const attachSchema = z.object({
  bookingId: z.coerce.number().int().positive(),
  type: z.enum(DOCUMENT_TYPES),
});

export async function attachDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const parsed = attachSchema.parse({
      bookingId: formData.get("bookingId"),
      type: formData.get("type"),
    });
    const stored = await storeUpload(formData.get("file") as File, "document");
    const document = await attachDocument(
      { bookingId: parsed.bookingId, type: parsed.type, fileUrl: stored.url },
      user,
    );
    revalidateBooking(parsed.bookingId);
    return `Documento #${document.id} cargado — queda pendiente de verificación`;
  });
}

const reviewSchema = z.object({
  documentId: z.coerce.number().int().positive(),
  bookingId: z.coerce.number().int().positive(),
  status: z.enum(["verified", "rejected"]),
  rejectionReason: z.string().trim().max(300).nullish(),
});

export async function reviewDocumentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const parsed = reviewSchema.parse({
      documentId: formData.get("documentId"),
      bookingId: formData.get("bookingId"),
      status: formData.get("status"),
      rejectionReason: formData.get("rejectionReason") || null,
    });
    await reviewDocument(
      {
        documentId: parsed.documentId,
        status: parsed.status,
        rejectionReason: parsed.rejectionReason ?? null,
      },
      user,
    );
    revalidateBooking(parsed.bookingId);
    return parsed.status === "verified" ? "Documento verificado" : "Documento rechazado";
  });
}

/**
 * Confirm a car booking whose documents are not verified (#16).
 *
 * Deliberately its own action rather than a checkbox on the normal confirm:
 * an override is a decision somebody takes, and it is written to
 * `activity_log` by the booking engine.
 */
export async function confirmWithDocumentOverrideAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const bookingId = z.coerce.number().int().positive().parse(formData.get("bookingId"));
    const reason = z
      .string()
      .trim()
      .min(5, "Explicá por qué confirmás sin la verificación")
      .max(300)
      .parse(formData.get("reason"));
    const result = await transitionBooking(bookingId, "confirmed", user, {
      reason,
      overrideDocumentGate: true,
    });
    revalidateBooking(bookingId);
    return result.documentGateOverridden
      ? "Reserva confirmada con override de documentos (queda registrado)"
      : "Reserva confirmada";
  });
}
