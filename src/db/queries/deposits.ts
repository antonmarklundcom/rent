/**
 * Security deposits (#9, plan §5.O7).
 *
 * Lifecycle: `held` → `returned` | `deducted`. Both settlements are terminal —
 * a settled deposit is money that has already moved, so re-settling it is a
 * correction, not an update, and the engine refuses it. A deduction may point
 * at the inspection (#5) or maintenance ticket (#6) that justifies it, which
 * is what phase O-3 wires up.
 *
 * Every mutation takes an OPTIONAL executor (see `src/db/queries/tx.ts`): a
 * return inspection that finds damage opens a ticket AND deducts the deposit,
 * and those two writes must land together or not at all.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { bookings, deposits, listings, type DepositStatus } from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { inTransaction } from "@/db/queries/tx";
import type { SessionUser } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";
import { toMoney, toNumber } from "@/lib/money";

export type CreateDepositInput = {
  bookingId: number;
  amount: string;
  currency?: string;
};

export async function createDeposit(
  input: CreateDepositInput,
  actor?: SessionUser | null,
  executor?: Executor,
): Promise<typeof deposits.$inferSelect> {
  const amount = toMoney(input.amount);
  if (toNumber(amount) <= 0) {
    throw new DomainError("El depósito tiene que ser mayor a cero", "invalid_amount");
  }
  return inTransaction(executor, async (tx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (!booking) {
      throw new DomainError("La reserva no existe", "not_found", { bookingId: input.bookingId });
    }
    const [existing] = await tx
      .select()
      .from(deposits)
      .where(eq(deposits.bookingId, input.bookingId))
      .limit(1);
    if (existing) {
      // `deposits_booking_uq` makes one deposit per booking the rule; re-running
      // a seed or a retried form must update the held amount, not duplicate it.
      if (existing.status !== "held") {
        throw new DomainError(
          "El depósito de esta reserva ya fue liquidado",
          "already_settled",
          { depositId: existing.id, status: existing.status },
        );
      }
      await tx
        .update(deposits)
        .set({ amount, currency: input.currency ?? booking.currency })
        .where(eq(deposits.id, existing.id));
      const [updated] = await tx.select().from(deposits).where(eq(deposits.id, existing.id));
      return updated!;
    }

    const [inserted] = await tx
      .insert(deposits)
      .values({
        bookingId: input.bookingId,
        amount,
        currency: input.currency ?? booking.currency,
        status: "held",
      })
      .$returningId();
    const [row] = await tx.select().from(deposits).where(eq(deposits.id, inserted!.id));
    await logActivity(
      {
        entity: "deposit",
        entityId: inserted!.id,
        action: "deposit.held",
        userId: actor?.id ?? null,
        meta: { bookingId: input.bookingId, amount },
      },
      tx,
    );
    return row!;
  });
}

async function loadHeldDeposit(tx: Executor, depositId: number) {
  const [row] = await tx
    .select()
    .from(deposits)
    .where(eq(deposits.id, depositId))
    .limit(1)
    .for("update");
  if (!row) throw new DomainError("El depósito no existe", "not_found", { depositId });
  if (row.status !== "held") {
    throw new DomainError(
      `El depósito ya está en estado "${row.status}"`,
      "already_settled",
      { depositId, status: row.status },
    );
  }
  return row;
}

/** Give the whole deposit back. */
export async function returnDeposit(
  depositId: number,
  actor?: SessionUser | null,
  executor?: Executor,
): Promise<typeof deposits.$inferSelect> {
  return inTransaction(executor, async (tx) => {
    const deposit = await loadHeldDeposit(tx, depositId);
    await tx
      .update(deposits)
      .set({
        status: "returned",
        deductionAmount: toMoney(0),
        settledBy: actor?.id ?? null,
        settledAt: new Date(),
      })
      .where(eq(deposits.id, depositId));
    await logActivity(
      {
        entity: "deposit",
        entityId: depositId,
        action: "deposit.returned",
        userId: actor?.id ?? null,
        meta: { bookingId: deposit.bookingId, amount: deposit.amount },
      },
      tx,
    );
    const [row] = await tx.select().from(deposits).where(eq(deposits.id, depositId));
    return row!;
  });
}

export type DeductDepositInput = {
  depositId: number;
  deductionAmount: string;
  reason: string;
  inspectionId?: number | null;
  maintenanceTicketId?: number | null;
};

/**
 * Keep part (or all) of a deposit. A deduction larger than what is held is
 * rejected — the operator cannot invent money it never took — and a deduction
 * always carries a written reason, because this ends up in a dispute.
 */
export async function deductDeposit(
  input: DeductDepositInput,
  actor?: SessionUser | null,
  executor?: Executor,
): Promise<typeof deposits.$inferSelect> {
  const deduction = toMoney(input.deductionAmount);
  const reason = input.reason.trim();
  if (toNumber(deduction) <= 0) {
    throw new DomainError("La deducción tiene que ser mayor a cero", "invalid_amount");
  }
  if (!reason) {
    throw new DomainError("Toda deducción necesita un motivo", "invalid_amount");
  }
  return inTransaction(executor, async (tx) => {
    const deposit = await loadHeldDeposit(tx, input.depositId);
    if (toNumber(deduction) > toNumber(deposit.amount)) {
      throw new DomainError(
        "La deducción no puede superar el depósito retenido",
        "deduction_too_large",
        { depositId: input.depositId, amount: deposit.amount, deduction },
      );
    }
    await tx
      .update(deposits)
      .set({
        status: "deducted",
        deductionAmount: deduction,
        deductionReason: reason,
        inspectionId: input.inspectionId ?? null,
        maintenanceTicketId: input.maintenanceTicketId ?? null,
        settledBy: actor?.id ?? null,
        settledAt: new Date(),
      })
      .where(eq(deposits.id, input.depositId));
    await logActivity(
      {
        entity: "deposit",
        entityId: input.depositId,
        action: "deposit.deducted",
        userId: actor?.id ?? null,
        meta: {
          bookingId: deposit.bookingId,
          amount: deposit.amount,
          deduction,
          reason,
          inspectionId: input.inspectionId ?? null,
          maintenanceTicketId: input.maintenanceTicketId ?? null,
        },
      },
      tx,
    );
    const [row] = await tx.select().from(deposits).where(eq(deposits.id, input.depositId));
    return row!;
  });
}

/** Amount actually handed back to the guest once a deposit is settled. */
export function refundedAmount(deposit: {
  amount: string;
  status: DepositStatus;
  deductionAmount: string | null;
}): string {
  if (deposit.status === "held") return toMoney(0);
  return toMoney(toNumber(deposit.amount) - toNumber(deposit.deductionAmount ?? 0));
}

export async function getDepositForBooking(bookingId: number, executor: Executor = db) {
  const [row] = await executor
    .select()
    .from(deposits)
    .where(eq(deposits.bookingId, bookingId))
    .limit(1);
  return row ?? null;
}

export async function listDeposits(
  options: { listingIds?: number[]; statuses?: DepositStatus[] } = {},
  executor: Executor = db,
) {
  if (options.listingIds && options.listingIds.length === 0) return [];
  return executor
    .select({
      deposit: deposits,
      bookingReference: bookings.reference,
      guestName: bookings.guestName,
      listingTitle: listings.title,
    })
    .from(deposits)
    .innerJoin(bookings, eq(bookings.id, deposits.bookingId))
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(
      and(
        options.listingIds ? inArray(listings.id, options.listingIds) : undefined,
        options.statuses?.length ? inArray(deposits.status, options.statuses) : undefined,
      ),
    )
    .orderBy(asc(deposits.status), asc(deposits.id));
}
