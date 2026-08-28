/**
 * Payment links for deposits and balances (#8, plan §5.O7).
 *
 * v1 has NO gateway integration by design (plan §3.B): we store the Bancard /
 * QR link an operator generated elsewhere, track its status, and let an admin
 * mark it paid. Every status change is written to `activity_log`, because
 * "who marked this paid" is the question that gets asked later.
 */
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { bookings, listings, paymentLinks, type PaymentStatus } from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import type { SessionUser } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";
import { toMoney, toNumber } from "@/lib/money";

export type CreatePaymentLinkInput = {
  bookingId: number;
  provider: string;
  amount: string;
  url?: string | null;
  reference?: string | null;
  currency?: string;
  expiresAt?: Date | null;
};

export async function createPaymentLink(
  input: CreatePaymentLinkInput,
  actor?: SessionUser | null,
): Promise<typeof paymentLinks.$inferSelect> {
  const amount = toMoney(input.amount);
  if (toNumber(amount) <= 0) {
    throw new DomainError("El monto del link tiene que ser mayor a cero", "invalid_amount");
  }
  const provider = input.provider.trim();
  if (!provider) {
    throw new DomainError("Indicá el proveedor del link de pago", "invalid_amount");
  }
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (!booking) {
      throw new DomainError("La reserva no existe", "not_found", { bookingId: input.bookingId });
    }
    const [inserted] = await tx
      .insert(paymentLinks)
      .values({
        bookingId: input.bookingId,
        provider,
        url: input.url?.trim() || null,
        reference: input.reference?.trim() || null,
        amount,
        currency: input.currency ?? booking.currency,
        status: "pending",
        expiresAt: input.expiresAt ?? null,
      })
      .$returningId();
    await logActivity(
      {
        entity: "payment_link",
        entityId: inserted!.id,
        action: "payment_link.created",
        userId: actor?.id ?? null,
        meta: { bookingId: input.bookingId, provider, amount },
      },
      tx,
    );
    const [row] = await tx.select().from(paymentLinks).where(eq(paymentLinks.id, inserted!.id));
    return row!;
  });
}

/** Manual mark-paid — the only way a link becomes `paid` in v1. */
export async function markPaymentLinkPaid(
  paymentLinkId: number,
  actor?: SessionUser | null,
): Promise<typeof paymentLinks.$inferSelect> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(paymentLinks)
      .where(eq(paymentLinks.id, paymentLinkId))
      .limit(1)
      .for("update");
    if (!row) {
      throw new DomainError("El link de pago no existe", "not_found", { paymentLinkId });
    }
    if (row.status === "paid") {
      throw new DomainError("El link ya está marcado como pagado", "already_settled", {
        paymentLinkId,
      });
    }
    await tx
      .update(paymentLinks)
      .set({ status: "paid", markedPaidBy: actor?.id ?? null, markedPaidAt: new Date() })
      .where(eq(paymentLinks.id, paymentLinkId));
    await logActivity(
      {
        entity: "payment_link",
        entityId: paymentLinkId,
        action: "payment_link.paid",
        userId: actor?.id ?? null,
        meta: { bookingId: row.bookingId, amount: row.amount, previousStatus: row.status },
      },
      tx,
    );
    const [updated] = await tx
      .select()
      .from(paymentLinks)
      .where(eq(paymentLinks.id, paymentLinkId));
    return updated!;
  });
}

/**
 * Flip pending links whose `expires_at` has passed. Cron-ready and idempotent —
 * a second run finds nothing left to expire.
 */
export async function expireOverduePaymentLinks(
  now: Date = new Date(),
  executor: Executor = db,
): Promise<number> {
  const due = await executor
    .select({ id: paymentLinks.id })
    .from(paymentLinks)
    .where(and(eq(paymentLinks.status, "pending"), lt(paymentLinks.expiresAt, now)));
  if (due.length === 0) return 0;
  await executor
    .update(paymentLinks)
    .set({ status: "expired" })
    .where(
      inArray(
        paymentLinks.id,
        due.map((row) => row.id),
      ),
    );
  return due.length;
}

export async function listPaymentLinksForBooking(bookingId: number, executor: Executor = db) {
  return executor
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.bookingId, bookingId))
    .orderBy(asc(paymentLinks.id));
}

export async function listPaymentLinks(
  options: { listingIds?: number[]; statuses?: PaymentStatus[] } = {},
  executor: Executor = db,
) {
  if (options.listingIds && options.listingIds.length === 0) return [];
  return executor
    .select({
      paymentLink: paymentLinks,
      bookingReference: bookings.reference,
      guestName: bookings.guestName,
      listingTitle: listings.title,
    })
    .from(paymentLinks)
    .innerJoin(bookings, eq(bookings.id, paymentLinks.bookingId))
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(
      and(
        options.listingIds ? inArray(listings.id, options.listingIds) : undefined,
        options.statuses?.length ? inArray(paymentLinks.status, options.statuses) : undefined,
      ),
    )
    .orderBy(asc(paymentLinks.status), asc(paymentLinks.id));
}

/** Total actually collected against a booking. */
export function paidTotal(links: Array<{ amount: string; status: PaymentStatus }>): string {
  return toMoney(
    links
      .filter((link) => link.status === "paid")
      .reduce((sum, link) => sum + toNumber(link.amount), 0),
  );
}
