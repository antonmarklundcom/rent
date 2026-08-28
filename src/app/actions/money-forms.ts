"use server";

/**
 * Form-shaped wrappers over the O-2 money and booking actions (plan §5.O11).
 *
 * Same reasoning as `src/app/actions/panel.ts`: those actions return
 * `ActionResult<T>` for programmatic callers, `ActionForm` renders a
 * `FormState`, and the authorisation gate must stay in exactly one place. These
 * adapt the shape and nothing else — every one of them delegates.
 */
import { z } from "zod";
import {
  createManualBookingAction,
  transitionBookingAction,
  type ActionResult,
} from "@/app/actions/bookings";
import {
  createDepositAction,
  createPaymentLinkAction,
  deductDepositAction,
  expirePaymentLinksAction,
  generateStatementAction,
  markPaymentLinkPaidAction,
  returnDepositAction,
} from "@/app/actions/money";
import { BOOKING_STATUSES } from "@/db/schema";
import { DomainError, type DomainErrorCode } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/app/actions/form";

/** Turn an `ActionResult` failure back into the DomainError `toFormState` renders. */
function unwrap<T>(result: ActionResult<T>, fallback: DomainErrorCode = "invalid_amount"): T {
  if (!result.ok) throw new DomainError(result.error, (result.code as DomainErrorCode) ?? fallback);
  return result.data;
}

const bookingId = z.coerce.number().int().positive();
const money = z.string().trim().min(1).max(20);

/* ------------------------------------------------------------ payment links */

export async function createPaymentLinkForm(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const input = z
      .object({
        bookingId,
        provider: z.string().trim().min(2).max(80),
        amount: money,
        url: z.string().trim().max(700).nullish(),
        reference: z.string().trim().max(160).nullish(),
        expiresAt: z.coerce.date().nullish(),
      })
      .parse({
        bookingId: formData.get("bookingId"),
        provider: formData.get("provider"),
        amount: formData.get("amount"),
        url: formData.get("url") || null,
        reference: formData.get("reference") || null,
        expiresAt: formData.get("expiresAt") || null,
      });
    unwrap(await createPaymentLinkAction(input));
    return "Link de pago creado";
  });
}

export async function markPaymentPaidForm(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const id = z.coerce.number().int().positive().parse(formData.get("paymentLinkId"));
    unwrap(await markPaymentLinkPaidAction(id));
    return "Pago registrado";
  });
}

export async function expirePaymentsForm(_prev: FormState): Promise<FormState> {
  return toFormState(async () => {
    const result = unwrap(await expirePaymentLinksAction());
    return `${result.expired} link(s) vencido(s)`;
  });
}

/* ----------------------------------------------------------------- deposits */

export async function createDepositForm(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const input = z
      .object({ bookingId, amount: money })
      .parse({ bookingId: formData.get("bookingId"), amount: formData.get("amount") });
    unwrap(await createDepositAction(input));
    return "Depósito registrado como retenido";
  });
}

export async function returnDepositForm(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const id = z.coerce.number().int().positive().parse(formData.get("depositId"));
    unwrap(await returnDepositAction(id));
    return "Depósito devuelto";
  });
}

export async function deductDepositForm(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const input = z
      .object({
        depositId: z.coerce.number().int().positive(),
        deductionAmount: money,
        reason: z.string().trim().min(3).max(1000),
      })
      .parse({
        depositId: formData.get("depositId"),
        deductionAmount: formData.get("deductionAmount"),
        reason: formData.get("reason"),
      });
    unwrap(await deductDepositAction(input));
    return "Descuento aplicado al depósito";
  });
}

/* --------------------------------------------------------------- statements */

export async function generateStatementForm(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const input = z
      .object({
        ownerId: z.coerce.number().int().positive(),
        period: z.string().trim().regex(/^\d{4}-\d{2}$/, "El período va como 2026-08"),
      })
      .parse({ ownerId: formData.get("ownerId"), period: formData.get("period") });
    const result = unwrap(await generateStatementAction(input));
    return `Liquidación ${input.period} generada (neto ${result.netTotal})`;
  });
}

/* ----------------------------------------------------------------- bookings */

export async function createManualBookingForm(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const input = z
      .object({
        listingId: z.coerce.number().int().positive(),
        guestName: z.string().trim().min(2).max(180),
        guestPhone: z.string().trim().max(40).nullish(),
        guestEmail: z.string().trim().max(255).nullish(),
        startAt: z.string().trim().min(4),
        endAt: z.string().trim().min(4),
        status: z.enum(["inquiry", "confirmed"]).default("confirmed"),
        source: z.enum(["web", "whatsapp", "manual"]).default("manual"),
        promoCode: z.string().trim().max(40).nullish(),
        guestCount: z.coerce.number().int().min(1).max(50).nullish(),
        notes: z.string().trim().max(2000).nullish(),
      })
      .parse({
        listingId: formData.get("listingId"),
        guestName: formData.get("guestName"),
        guestPhone: formData.get("guestPhone") || null,
        guestEmail: formData.get("guestEmail") || null,
        startAt: formData.get("startAt"),
        endAt: formData.get("endAt"),
        status: formData.get("status") || "confirmed",
        source: formData.get("source") || "manual",
        promoCode: formData.get("promoCode") || null,
        guestCount: formData.get("guestCount") || null,
        notes: formData.get("notes") || null,
      });
    const booking = unwrap(await createManualBookingAction(input), "unavailable");
    return `Reserva ${booking.reference} creada`;
  });
}

export async function transitionBookingForm(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const input = z
      .object({
        bookingId,
        to: z.enum(BOOKING_STATUSES),
        reason: z.string().trim().max(300).optional(),
      })
      .parse({
        bookingId: formData.get("bookingId"),
        to: formData.get("to"),
        reason: formData.get("reason") || undefined,
      });
    const result = unwrap(await transitionBookingAction(input), "invalid_transition");
    return `Reserva marcada como ${result.status}`;
  });
}
