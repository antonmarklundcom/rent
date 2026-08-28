/**
 * Per-listing expense tracking (#7, plan §5.O6).
 *
 * Expenses are what turn a gross booking into an owner's net (#3): the
 * statement generator in `src/db/queries/statements.ts` bills every unbilled
 * expense in the period and stamps `statement_id` on it. So an expense row is
 * money that will be deducted from somebody — it is created deliberately, in
 * the same transaction as whatever justified it, and never twice.
 *
 * `expenses_ticket_uq` makes "one expense per maintenance ticket" a database
 * rule, which is why `upsertTicketExpense` updates rather than inserts when a
 * ticket's cost is corrected.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenses,
  listings,
  maintenanceTickets,
  type ExpenseCategory,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { inTransaction } from "@/db/queries/tx";
import type { SessionUser } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";
import { addMoney, toMoney, toNumber } from "@/lib/money";

export type CreateExpenseInput = {
  listingId: number;
  category: ExpenseCategory;
  amount: string;
  incurredOn: string;
  description?: string | null;
  currency?: string;
  maintenanceTicketId?: number | null;
  cleaningTaskId?: number | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function assertAmount(amount: string): string {
  const value = toMoney(amount);
  if (toNumber(value) <= 0) {
    throw new DomainError("El gasto tiene que ser mayor a cero", "invalid_amount");
  }
  return value;
}

function assertDate(incurredOn: string): string {
  const value = incurredOn.trim();
  if (!YMD.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new DomainError(`Fecha de gasto inválida: ${incurredOn}`, "invalid_range");
  }
  return value;
}

export async function createExpense(
  input: CreateExpenseInput,
  actor?: SessionUser | null,
  executor?: Executor,
): Promise<typeof expenses.$inferSelect> {
  const amount = assertAmount(input.amount);
  const incurredOn = assertDate(input.incurredOn);

  return inTransaction(executor, async (tx) => {
    const [listing] = await tx
      .select({ id: listings.id, currency: listings.currency })
      .from(listings)
      .where(eq(listings.id, input.listingId))
      .limit(1);
    if (!listing) {
      throw new DomainError("La publicación no existe", "not_found", {
        listingId: input.listingId,
      });
    }
    const [inserted] = await tx
      .insert(expenses)
      .values({
        listingId: input.listingId,
        category: input.category,
        amount,
        currency: input.currency ?? listing.currency,
        incurredOn,
        description: input.description?.trim() || null,
        maintenanceTicketId: input.maintenanceTicketId ?? null,
        cleaningTaskId: input.cleaningTaskId ?? null,
        createdBy: actor?.id ?? null,
      })
      .$returningId();
    const [row] = await tx.select().from(expenses).where(eq(expenses.id, inserted!.id)).limit(1);
    await logActivity(
      {
        entity: "expense",
        entityId: inserted!.id,
        action: "expense.created",
        userId: actor?.id ?? null,
        meta: {
          listingId: input.listingId,
          category: input.category,
          amount,
          maintenanceTicketId: input.maintenanceTicketId ?? null,
          cleaningTaskId: input.cleaningTaskId ?? null,
        },
      },
      tx,
    );
    return row!;
  });
}

/**
 * Create — or correct — the expense a maintenance ticket's cost produces (#6).
 *
 * Called by `src/db/queries/maintenance.ts` inside the ticket's own
 * transaction, so a ticket can never carry a cost the books have not seen.
 * An expense already billed on a statement is NOT rewritten: that money has
 * been reported to an owner, so a correction is a new expense, decided by a
 * human, not a silent edit of history.
 */
export async function upsertTicketExpense(
  input: {
    ticketId: number;
    listingId: number;
    amount: string;
    incurredOn: string;
    description?: string | null;
    currency?: string;
  },
  actor: SessionUser | null | undefined,
  executor: Executor,
): Promise<{ expense: typeof expenses.$inferSelect; created: boolean; locked: boolean }> {
  const amount = assertAmount(input.amount);
  const incurredOn = assertDate(input.incurredOn);

  const [existing] = await executor
    .select()
    .from(expenses)
    .where(eq(expenses.maintenanceTicketId, input.ticketId))
    .limit(1);

  if (existing) {
    if (existing.statementId !== null) {
      return { expense: existing, created: false, locked: true };
    }
    await executor
      .update(expenses)
      .set({
        amount,
        incurredOn,
        description: input.description?.trim() || existing.description,
        category: "repair",
      })
      .where(eq(expenses.id, existing.id));
    const [row] = await executor.select().from(expenses).where(eq(expenses.id, existing.id));
    await logActivity(
      {
        entity: "expense",
        entityId: existing.id,
        action: "expense.updated_from_ticket",
        userId: actor?.id ?? null,
        meta: { ticketId: input.ticketId, from: existing.amount, to: amount },
      },
      executor,
    );
    return { expense: row!, created: false, locked: false };
  }

  const expense = await createExpense(
    {
      listingId: input.listingId,
      category: "repair",
      amount,
      incurredOn,
      description: input.description ?? null,
      currency: input.currency,
      maintenanceTicketId: input.ticketId,
    },
    actor,
    executor,
  );
  return { expense, created: true, locked: false };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export type ExpenseFilter = {
  listingIds?: number[];
  categories?: ExpenseCategory[];
  from?: string;
  to?: string;
  unbilledOnly?: boolean;
  limit?: number;
};

export async function listExpenses(filter: ExpenseFilter = {}, executor: Executor = db) {
  if (filter.listingIds && filter.listingIds.length === 0) return [];
  return executor
    .select({
      expense: expenses,
      listingTitle: listings.title,
      ticketTitle: maintenanceTickets.title,
    })
    .from(expenses)
    .innerJoin(listings, eq(listings.id, expenses.listingId))
    .leftJoin(maintenanceTickets, eq(maintenanceTickets.id, expenses.maintenanceTicketId))
    .where(
      and(
        filter.listingIds ? inArray(expenses.listingId, filter.listingIds) : undefined,
        filter.categories?.length ? inArray(expenses.category, filter.categories) : undefined,
        filter.from ? gte(expenses.incurredOn, assertDate(filter.from)) : undefined,
        filter.to ? lte(expenses.incurredOn, assertDate(filter.to)) : undefined,
        filter.unbilledOnly ? isNull(expenses.statementId) : undefined,
      ),
    )
    .orderBy(desc(expenses.incurredOn), desc(expenses.id))
    .limit(filter.limit ?? 200);
}

/** Totals per listing — feeds the expense-ratio analytics in phase O-4 (#12). */
export async function expenseTotalsByListing(
  filter: Pick<ExpenseFilter, "listingIds" | "from" | "to"> = {},
  executor: Executor = db,
): Promise<Array<{ listingId: number; listingTitle: string; total: string; count: number }>> {
  if (filter.listingIds && filter.listingIds.length === 0) return [];
  const rows = await executor
    .select({
      listingId: expenses.listingId,
      listingTitle: listings.title,
      total: sql<string>`SUM(${expenses.amount})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(expenses)
    .innerJoin(listings, eq(listings.id, expenses.listingId))
    .where(
      and(
        filter.listingIds ? inArray(expenses.listingId, filter.listingIds) : undefined,
        filter.from ? gte(expenses.incurredOn, assertDate(filter.from)) : undefined,
        filter.to ? lte(expenses.incurredOn, assertDate(filter.to)) : undefined,
      ),
    )
    .groupBy(expenses.listingId, listings.title)
    .orderBy(asc(listings.title));
  return rows.map((row) => ({
    listingId: row.listingId,
    listingTitle: row.listingTitle,
    total: toMoney(row.total ?? 0),
    count: Number(row.count ?? 0),
  }));
}

export async function expenseTotal(
  filter: Pick<ExpenseFilter, "listingIds" | "from" | "to"> = {},
  executor: Executor = db,
): Promise<string> {
  const totals = await expenseTotalsByListing(filter, executor);
  return addMoney(...totals.map((row) => row.total));
}

export async function getExpensesForTicket(ticketId: number, executor: Executor = db) {
  return executor
    .select()
    .from(expenses)
    .where(eq(expenses.maintenanceTicketId, ticketId))
    .orderBy(asc(expenses.id));
}
