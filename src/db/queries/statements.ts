/**
 * Owner statements (#3, plan §5.O7): gross − commission − expenses = net,
 * one row per owner per month, generated idempotently.
 *
 * Idempotency is the whole design. `owner_statements` is unique on
 * `(owner_id, period)`, and every expense a statement bills is stamped with
 * `expenses.statement_id`. Regenerating a period first releases its own stamps
 * and then re-claims them, so running the generator ten times produces exactly
 * the same numbers and never bills an expense twice or drops one.
 *
 * A booking belongs to the period its `end_at` (checkout) falls in, and only
 * `completed` bookings are billed — money is settled when the stay is over.
 */
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  expenses,
  listings,
  owners,
  ownerStatements,
  users,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import type { SessionUser } from "@/lib/auth-core";
import { periodRange } from "@/lib/dates";
import { DomainError } from "@/lib/errors";
import { addMoney, toMoney, toNumber } from "@/lib/money";
import { COMMISSION_BASE, computeCommission, resolveCommissionPct } from "@/lib/pricing";

export type StatementBookingLine = {
  bookingId: number;
  reference: string;
  listingTitle: string;
  guestName: string;
  startAt: Date;
  endAt: Date;
  gross: string;
  commissionPct: string;
  commission: string;
  net: string;
};

export type StatementExpenseLine = {
  expenseId: number;
  listingTitle: string;
  category: string;
  description: string | null;
  incurredOn: string;
  amount: string;
};

export type StatementDetail = {
  statement: typeof ownerStatements.$inferSelect;
  owner: { id: number; displayName: string; ruc: string | null; email: string | null };
  bookingLines: StatementBookingLine[];
  expenseLines: StatementExpenseLine[];
};

/**
 * Generate (or regenerate) one owner's statement for a `YYYY-MM` period.
 * Safe to re-run; safe to run for a period with no activity (produces a zeroed
 * statement, which is what an owner with an empty month should receive).
 */
export async function generateStatement(
  ownerId: number,
  period: string,
  actor?: SessionUser | null,
): Promise<StatementDetail> {
  const window = periodRange(period);

  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({
        id: owners.id,
        displayName: owners.displayName,
        ruc: owners.ruc,
        defaultCommissionPct: owners.defaultCommissionPct,
        email: users.email,
      })
      .from(owners)
      .leftJoin(users, eq(users.id, owners.userId))
      .where(eq(owners.id, ownerId))
      .limit(1);
    if (!owner) {
      throw new DomainError("El propietario no existe", "not_found", { ownerId });
    }

    // 1. Claim the statement row first, so its id can stamp the expenses.
    await tx
      .insert(ownerStatements)
      .values({ ownerId, period })
      .onDuplicateKeyUpdate({ set: { ownerId: sql`${ownerStatements.ownerId}` } });
    const [statementRow] = await tx
      .select()
      .from(ownerStatements)
      .where(and(eq(ownerStatements.ownerId, ownerId), eq(ownerStatements.period, period)))
      .limit(1)
      .for("update");
    if (!statementRow) {
      throw new DomainError("No se pudo crear el estado de cuenta", "not_found", {
        ownerId,
        period,
      });
    }
    const statementId = statementRow.id;

    // 2. Release what this statement billed last time — a regeneration must
    //    start from the same blank slate the first run saw.
    await tx
      .update(expenses)
      .set({ statementId: null })
      .where(eq(expenses.statementId, statementId));

    // 3. Bookings: completed, checking out inside the period.
    const bookingRows = await tx
      .select({
        booking: bookings,
        listingTitle: listings.title,
        listingCommissionPct: listings.commissionPct,
      })
      .from(bookings)
      .innerJoin(listings, eq(listings.id, bookings.listingId))
      .where(
        and(
          eq(listings.ownerId, ownerId),
          eq(bookings.status, "completed"),
          gte(bookings.endAt, window.startAt),
          lt(bookings.endAt, window.endAt),
        ),
      )
      .orderBy(asc(bookings.endAt));

    const currencies = new Set<string>();
    const bookingLines: StatementBookingLine[] = bookingRows.map((row) => {
      currencies.add(row.booking.currency);
      const gross = COMMISSION_BASE(row.booking);
      // Prefer the snapshot taken at confirmation; fall back to the configured
      // rate only when a booking predates the snapshot (legacy/imported rows).
      const commissionPct =
        row.booking.commissionPct ??
        resolveCommissionPct(row.listingCommissionPct, owner.defaultCommissionPct);
      const commission =
        row.booking.commissionAmount ??
        computeCommission(row.booking, commissionPct).commissionAmount;
      return {
        bookingId: row.booking.id,
        reference: row.booking.reference,
        listingTitle: row.listingTitle,
        guestName: row.booking.guestName,
        startAt: row.booking.startAt,
        endAt: row.booking.endAt,
        gross,
        commissionPct: toMoney(commissionPct),
        commission: toMoney(commission),
        net: toMoney(toNumber(gross) - toNumber(commission)),
      };
    });

    // 4. Expenses: incurred in the period on this owner's listings, not yet
    //    billed on another statement.
    const expenseRows = await tx
      .select({
        expense: expenses,
        listingTitle: listings.title,
      })
      .from(expenses)
      .innerJoin(listings, eq(listings.id, expenses.listingId))
      .where(
        and(
          eq(listings.ownerId, ownerId),
          gte(expenses.incurredOn, period + "-01"),
          lt(expenses.incurredOn, window.endAt.toISOString().slice(0, 10)),
          or(isNull(expenses.statementId), eq(expenses.statementId, statementId)),
        ),
      )
      .orderBy(asc(expenses.incurredOn), asc(expenses.id));

    const expenseLines: StatementExpenseLine[] = expenseRows.map((row) => {
      currencies.add(row.expense.currency);
      return {
        expenseId: row.expense.id,
        listingTitle: row.listingTitle,
        category: row.expense.category,
        description: row.expense.description,
        incurredOn: row.expense.incurredOn,
        amount: toMoney(row.expense.amount),
      };
    });

    if (currencies.size > 1) {
      // Summing two currencies into one net figure would be silently wrong
      // money, so refuse instead. v1 is PYG-only (plan §1).
      throw new DomainError(
        `El período ${period} mezcla monedas (${[...currencies].join(", ")})`,
        "invalid_amount",
        { ownerId, period, currencies: [...currencies] },
      );
    }
    const currency = currencies.values().next().value ?? statementRow.currency ?? "PYG";

    if (expenseLines.length > 0) {
      await tx
        .update(expenses)
        .set({ statementId })
        .where(
          inArray(
            expenses.id,
            expenseLines.map((line) => line.expenseId),
          ),
        );
    }

    const grossTotal = addMoney(...bookingLines.map((line) => line.gross));
    const commissionTotal = addMoney(...bookingLines.map((line) => line.commission));
    const expensesTotal = addMoney(...expenseLines.map((line) => line.amount));
    const netTotal = toMoney(
      toNumber(grossTotal) - toNumber(commissionTotal) - toNumber(expensesTotal),
    );

    await tx
      .update(ownerStatements)
      .set({
        grossTotal,
        commissionTotal,
        expensesTotal,
        netTotal,
        currency,
        bookingCount: bookingLines.length,
        htmlRef: `/api/estados/${statementId}.html`,
        generatedAt: new Date(),
      })
      .where(eq(ownerStatements.id, statementId));

    await logActivity(
      {
        entity: "owner_statement",
        entityId: statementId,
        action: "statement.generated",
        userId: actor?.id ?? null,
        meta: {
          ownerId,
          period,
          grossTotal,
          commissionTotal,
          expensesTotal,
          netTotal,
          bookingCount: bookingLines.length,
          expenseCount: expenseLines.length,
        },
      },
      tx,
    );

    const [statement] = await tx
      .select()
      .from(ownerStatements)
      .where(eq(ownerStatements.id, statementId))
      .limit(1);

    return {
      statement: statement!,
      owner: {
        id: owner.id,
        displayName: owner.displayName,
        ruc: owner.ruc,
        email: owner.email ?? null,
      },
      bookingLines,
      expenseLines,
    };
  });
}

/** Every owner that had a completed booking or an expense inside the period. */
export async function ownersWithActivity(
  period: string,
  executor: Executor = db,
): Promise<number[]> {
  const window = periodRange(period);
  const [fromBookings, fromExpenses] = await Promise.all([
    executor
      .selectDistinct({ ownerId: listings.ownerId })
      .from(bookings)
      .innerJoin(listings, eq(listings.id, bookings.listingId))
      .where(
        and(
          eq(bookings.status, "completed"),
          gte(bookings.endAt, window.startAt),
          lt(bookings.endAt, window.endAt),
        ),
      ),
    executor
      .selectDistinct({ ownerId: listings.ownerId })
      .from(expenses)
      .innerJoin(listings, eq(listings.id, expenses.listingId))
      .where(
        and(
          gte(expenses.incurredOn, period + "-01"),
          lt(expenses.incurredOn, window.endAt.toISOString().slice(0, 10)),
        ),
      ),
  ]);
  return [...new Set([...fromBookings, ...fromExpenses].map((row) => row.ownerId))].sort(
    (a, b) => a - b,
  );
}

/** Re-read a stored statement together with the lines that make it up. */
export async function getStatementDetail(
  statementId: number,
  executor: Executor = db,
): Promise<StatementDetail | null> {
  const [row] = await executor
    .select({
      statement: ownerStatements,
      displayName: owners.displayName,
      ruc: owners.ruc,
      email: users.email,
    })
    .from(ownerStatements)
    .innerJoin(owners, eq(owners.id, ownerStatements.ownerId))
    .leftJoin(users, eq(users.id, owners.userId))
    .where(eq(ownerStatements.id, statementId))
    .limit(1);
  if (!row) return null;

  const window = periodRange(row.statement.period);
  const [ownerRow] = await executor
    .select({ defaultCommissionPct: owners.defaultCommissionPct })
    .from(owners)
    .where(eq(owners.id, row.statement.ownerId))
    .limit(1);
  const bookingRows = await executor
    .select({
      booking: bookings,
      listingTitle: listings.title,
      listingCommissionPct: listings.commissionPct,
    })
    .from(bookings)
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(
      and(
        eq(listings.ownerId, row.statement.ownerId),
        eq(bookings.status, "completed"),
        gte(bookings.endAt, window.startAt),
        lt(bookings.endAt, window.endAt),
      ),
    )
    .orderBy(asc(bookings.endAt));

  const expenseRows = await executor
    .select({ expense: expenses, listingTitle: listings.title })
    .from(expenses)
    .innerJoin(listings, eq(listings.id, expenses.listingId))
    .where(eq(expenses.statementId, statementId))
    .orderBy(asc(expenses.incurredOn), asc(expenses.id));

  return {
    statement: row.statement,
    owner: {
      id: row.statement.ownerId,
      displayName: row.displayName,
      ruc: row.ruc,
      email: row.email ?? null,
    },
    bookingLines: bookingRows.map((b) => {
      const gross = COMMISSION_BASE(b.booking);
      // Same fallback the generator uses, so a re-read never shows a different
      // commission than the totals it is explaining.
      const commissionPct =
        b.booking.commissionPct ??
        resolveCommissionPct(b.listingCommissionPct, ownerRow?.defaultCommissionPct);
      const commission = toMoney(
        b.booking.commissionAmount ?? computeCommission(b.booking, commissionPct).commissionAmount,
      );
      return {
        bookingId: b.booking.id,
        reference: b.booking.reference,
        listingTitle: b.listingTitle,
        guestName: b.booking.guestName,
        startAt: b.booking.startAt,
        endAt: b.booking.endAt,
        gross,
        commissionPct: toMoney(commissionPct),
        commission,
        net: toMoney(toNumber(gross) - toNumber(commission)),
      };
    }),
    expenseLines: expenseRows.map((e) => ({
      expenseId: e.expense.id,
      listingTitle: e.listingTitle,
      category: e.expense.category,
      description: e.expense.description,
      incurredOn: e.expense.incurredOn,
      amount: toMoney(e.expense.amount),
    })),
  };
}

export async function listStatementsForOwner(ownerId: number, executor: Executor = db) {
  return executor
    .select()
    .from(ownerStatements)
    .where(eq(ownerStatements.ownerId, ownerId))
    .orderBy(sql`${ownerStatements.period} desc`);
}

export async function listStatements(period?: string, executor: Executor = db) {
  return executor
    .select({
      statement: ownerStatements,
      ownerName: owners.displayName,
    })
    .from(ownerStatements)
    .innerJoin(owners, eq(owners.id, ownerStatements.ownerId))
    .where(period ? eq(ownerStatements.period, period) : undefined)
    .orderBy(sql`${ownerStatements.period} desc`, asc(owners.displayName));
}
