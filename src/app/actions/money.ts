"use server";

/**
 * Server actions over the money engine (plan §5.O7): payment links (#8),
 * deposits (#9) and owner statements (#3).
 *
 * Money mutations are admin-only. An owner reads their statements — they never
 * mark a payment received or settle a deposit, because that is the operator's
 * accounting, not theirs.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createDeposit,
  deductDeposit,
  returnDeposit,
} from "@/db/queries/deposits";
import {
  createPaymentLink,
  expireOverduePaymentLinks,
  markPaymentLinkPaid,
} from "@/db/queries/payments";
import { generateStatement, getStatementDetail } from "@/db/queries/statements";
import { ADMIN_ROLES, AuthError, isAdmin } from "@/lib/auth-core";
import { requireRole } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { assertCanAccessBooking } from "@/lib/scope";
import { DomainError } from "@/lib/errors";
import { renderStatementHtml } from "@/lib/statement-html";
import type { ActionResult } from "@/app/actions/bookings";

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, error: error.message, code: error.code };
    }
    throw error;
  }
}

/* ------------------------------------------------------------ payment links */

const paymentLinkSchema = z.object({
  bookingId: z.number().int().positive(),
  provider: z.string().trim().min(2).max(80),
  amount: z.string().trim().min(1).max(20),
  url: z.string().trim().max(700).nullish(),
  reference: z.string().trim().max(160).nullish(),
  expiresAt: z.coerce.date().nullish(),
});

export async function createPaymentLinkAction(
  input: z.input<typeof paymentLinkSchema>,
): Promise<ActionResult<{ id: number }>> {
  const user = await requireRole(ADMIN_ROLES);
  const parsed = paymentLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos del link de pago inválidos" };
  return run(async () => {
    const link = await createPaymentLink(parsed.data, user);
    revalidatePath("/admin");
    return { id: link.id };
  });
}

export async function markPaymentLinkPaidAction(
  paymentLinkId: number,
): Promise<ActionResult<{ id: number; status: string }>> {
  const user = await requireRole(ADMIN_ROLES);
  return run(async () => {
    const link = await markPaymentLinkPaid(paymentLinkId, user);
    revalidatePath("/admin");
    return { id: link.id, status: link.status };
  });
}

export async function expirePaymentLinksAction(): Promise<ActionResult<{ expired: number }>> {
  await requireRole(ADMIN_ROLES);
  return run(async () => ({ expired: await expireOverduePaymentLinks() }));
}

/* ---------------------------------------------------------------- deposits */

const depositSchema = z.object({
  bookingId: z.number().int().positive(),
  amount: z.string().trim().min(1).max(20),
});

export async function createDepositAction(
  input: z.input<typeof depositSchema>,
): Promise<ActionResult<{ id: number; status: string }>> {
  const user = await requireRole(ADMIN_ROLES);
  const parsed = depositSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Monto de depósito inválido" };
  await assertCanAccessBooking(user, parsed.data.bookingId);
  return run(async () => {
    const deposit = await createDeposit(parsed.data, user);
    revalidatePath("/admin");
    return { id: deposit.id, status: deposit.status };
  });
}

export async function returnDepositAction(
  depositId: number,
): Promise<ActionResult<{ id: number; status: string }>> {
  const user = await requireRole(ADMIN_ROLES);
  return run(async () => {
    const deposit = await returnDeposit(depositId, user);
    revalidatePath("/admin");
    return { id: deposit.id, status: deposit.status };
  });
}

const deductionSchema = z.object({
  depositId: z.number().int().positive(),
  deductionAmount: z.string().trim().min(1).max(20),
  reason: z.string().trim().min(3).max(1000),
  inspectionId: z.number().int().positive().nullish(),
  maintenanceTicketId: z.number().int().positive().nullish(),
});

export async function deductDepositAction(
  input: z.input<typeof deductionSchema>,
): Promise<ActionResult<{ id: number; status: string }>> {
  const user = await requireRole(ADMIN_ROLES);
  const parsed = deductionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos de la deducción inválidos" };
  return run(async () => {
    const deposit = await deductDeposit(parsed.data, user);
    revalidatePath("/admin");
    return { id: deposit.id, status: deposit.status };
  });
}

/* -------------------------------------------------------------- statements */

const statementSchema = z.object({
  ownerId: z.number().int().positive(),
  period: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export async function generateStatementAction(
  input: z.input<typeof statementSchema>,
): Promise<ActionResult<{ id: number; netTotal: string }>> {
  const user = await requireRole(ADMIN_ROLES);
  const parsed = statementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Período inválido (se espera YYYY-MM)" };
  return run(async () => {
    const detail = await generateStatement(parsed.data.ownerId, parsed.data.period, user);
    revalidatePath("/admin");
    revalidatePath("/panel");
    return { id: detail.statement.id, netTotal: detail.statement.netTotal };
  });
}

/** Rendered statement for in-page preview; the printable copy is `/api/estados/<id>.html`. */
export async function statementHtmlAction(
  statementId: number,
): Promise<ActionResult<{ html: string }>> {
  const user = await requireRole(["super_admin", "admin", "owner"]);
  return run(async () => {
    const detail = await getStatementDetail(statementId);
    if (!detail) throw new DomainError("El estado de cuenta no existe", "not_found");
    if (!isAdmin(user) && detail.statement.ownerId !== user.ownerId) {
      throw new DomainError("No tenés permiso sobre este estado de cuenta", "not_found");
    }
    return { html: renderStatementHtml(detail) };
  });
}

/* -------------------------------------------------------------------------- */
/* Form-shaped wrappers (phase O-4 screens)                                    */
/* -------------------------------------------------------------------------- */

/**
 * The actions above return `ActionResult` and predate `ActionForm`. Rather than
 * change signatures phase O-2 already proved (and §4.7 freezes for Window 2),
 * O-4's screens call these thin adapters.
 */
async function asFormState<T>(
  fn: () => Promise<ActionResult<T>>,
  onOk: (data: T) => string,
): Promise<FormState> {
  try {
    const result = await fn();
    return result.ok ? { ok: true, message: onOk(result.data) } : { ok: false, error: result.error };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    console.error("[money-form]", error);
    return { ok: false, error: "No se pudo completar la acción" };
  }
}

export async function createPaymentLinkFormAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const expires = String(formData.get("expiresAt") ?? "");
  return asFormState(
    () =>
      createPaymentLinkAction({
        bookingId: Number(formData.get("bookingId")),
        provider: String(formData.get("provider") ?? ""),
        amount: String(formData.get("amount") ?? ""),
        url: String(formData.get("url") ?? "") || null,
        reference: String(formData.get("reference") ?? "") || null,
        // `datetime-local` has no timezone; the app stores UTC everywhere.
        expiresAt: expires ? new Date(`${expires}:00Z`) : null,
      }),
    () => "Link de pago registrado",
  );
}

export async function markPaymentLinkPaidFormAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return asFormState(
    () => markPaymentLinkPaidAction(Number(formData.get("paymentLinkId"))),
    () => "Pago marcado como recibido",
  );
}

export async function expirePaymentLinksFormAction(): Promise<FormState> {
  return asFormState(
    () => expirePaymentLinksAction(),
    ({ expired }) =>
      expired === 0 ? "No había links vencidos" : `${expired} link(s) marcados como vencidos`,
  );
}

export async function generateStatementFormAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return asFormState(
    () =>
      generateStatementAction({
        ownerId: Number(formData.get("ownerId")),
        period: String(formData.get("period") ?? ""),
      }),
    ({ netTotal }) => `Estado generado — neto ${netTotal}`,
  );
}
