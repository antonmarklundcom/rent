/**
 * Maintenance ticketing (#6, plan §5.O6).
 *
 * A ticket's `cost` is not a note — it is money the owner will be billed for
 * on their next statement (#3). So the cost and its `expenses` row are written
 * in ONE transaction (`upsertTicketExpense`), and `expenses_ticket_uq` makes
 * "one expense per ticket" a database rule rather than a convention.
 *
 * Tickets are also the landing point for damage found on a return inspection
 * (#5): `src/db/queries/inspections.ts` opens one through `createTicket` with
 * the inspection id attached.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenses,
  listings,
  maintenanceTickets,
  users,
  type TicketStatus,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { removeTicketExpense, upsertTicketExpense } from "@/db/queries/expenses";
import { addPhoto } from "@/db/queries/photos";
import { inTransaction } from "@/db/queries/tx";
import type { SessionUser } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";
import { toMoney, toNumber } from "@/lib/money";

export type MaintenanceTicket = typeof maintenanceTickets.$inferSelect;

export type CreateTicketInput = {
  listingId: number;
  title: string;
  description?: string | null;
  assignedUserId?: number | null;
  cost?: string | null;
  /** Set when the ticket was opened by a damaged-vehicle inspection (#5). */
  inspectionId?: number | null;
};

export type TicketWriteResult = {
  ticket: MaintenanceTicket;
  expenseId: number | null;
  /** True when a cost was set but its expense is already billed and frozen. */
  expenseLocked: boolean;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function createTicket(
  input: CreateTicketInput,
  actor?: SessionUser | null,
  executor?: Executor,
): Promise<TicketWriteResult> {
  const title = input.title.trim();
  if (!title) throw new DomainError("El ticket necesita un título", "invalid_amount");

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
    const cost = input.cost ? toMoney(input.cost) : null;
    if (cost !== null && toNumber(cost) < 0) {
      throw new DomainError("El costo no puede ser negativo", "invalid_amount");
    }

    const [inserted] = await tx
      .insert(maintenanceTickets)
      .values({
        listingId: listing.id,
        reportedBy: actor?.id ?? null,
        title,
        description: input.description?.trim() || null,
        status: "open",
        assignedUserId: input.assignedUserId ?? null,
        cost,
        inspectionId: input.inspectionId ?? null,
      })
      .$returningId();

    await logActivity(
      {
        entity: "maintenance_ticket",
        entityId: inserted!.id,
        action: "ticket.created",
        userId: actor?.id ?? null,
        meta: {
          listingId: listing.id,
          title,
          cost,
          inspectionId: input.inspectionId ?? null,
        },
      },
      tx,
    );

    let expenseId: number | null = null;
    let expenseLocked = false;
    if (cost !== null && toNumber(cost) > 0) {
      const result = await upsertTicketExpense(
        {
          ticketId: inserted!.id,
          listingId: listing.id,
          amount: cost,
          incurredOn: today(),
          description: title,
          currency: listing.currency,
        },
        actor,
        tx,
      );
      expenseId = result.expense.id;
      expenseLocked = result.locked;
    }

    const [row] = await tx
      .select()
      .from(maintenanceTickets)
      .where(eq(maintenanceTickets.id, inserted!.id))
      .limit(1);
    return { ticket: row!, expenseId, expenseLocked };
  });
}

export type UpdateTicketInput = {
  ticketId: number;
  status?: TicketStatus;
  assignedUserId?: number | null;
  cost?: string | null;
  title?: string;
  description?: string | null;
};

/**
 * Update a ticket. Setting a cost creates (or corrects) the linked expense in
 * the same transaction — a ticket cost that exists only on the ticket is a
 * cost the owner is never billed for, which is a silent accounting hole.
 */
export async function updateTicket(
  input: UpdateTicketInput,
  actor?: SessionUser | null,
  executor?: Executor,
): Promise<TicketWriteResult> {
  return inTransaction(executor, async (tx) => {
    const [ticket] = await tx
      .select()
      .from(maintenanceTickets)
      .where(eq(maintenanceTickets.id, input.ticketId))
      .limit(1)
      .for("update");
    if (!ticket) {
      throw new DomainError("El ticket no existe", "not_found", { ticketId: input.ticketId });
    }
    const [listing] = await tx
      .select({ currency: listings.currency })
      .from(listings)
      .where(eq(listings.id, ticket.listingId))
      .limit(1);

    const patch: Partial<typeof maintenanceTickets.$inferInsert> = {};
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new DomainError("El ticket necesita un título", "invalid_amount");
      patch.title = title;
    }
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.assignedUserId !== undefined) patch.assignedUserId = input.assignedUserId;
    if (input.status !== undefined && input.status !== ticket.status) {
      patch.status = input.status;
      patch.resolvedAt = input.status === "done" ? new Date() : null;
    }

    let cost: string | null = ticket.cost;
    if (input.cost !== undefined) {
      cost = input.cost === null || input.cost === "" ? null : toMoney(input.cost);
      if (cost !== null && toNumber(cost) < 0) {
        throw new DomainError("El costo no puede ser negativo", "invalid_amount");
      }
      patch.cost = cost;
    }

    if (Object.keys(patch).length > 0) {
      await tx
        .update(maintenanceTickets)
        .set(patch)
        .where(eq(maintenanceTickets.id, ticket.id));
      await logActivity(
        {
          entity: "maintenance_ticket",
          entityId: ticket.id,
          action: "ticket.updated",
          userId: actor?.id ?? null,
          meta: { changes: patch, from: { status: ticket.status, cost: ticket.cost } },
        },
        tx,
      );
    }

    let expenseId: number | null = null;
    let expenseLocked = false;
    if (cost !== null && toNumber(cost) > 0) {
      const result = await upsertTicketExpense(
        {
          ticketId: ticket.id,
          listingId: ticket.listingId,
          amount: cost,
          incurredOn: today(),
          description: patch.title ?? ticket.title,
          currency: listing?.currency,
        },
        actor,
        tx,
      );
      expenseId = result.expense.id;
      expenseLocked = result.locked;
    } else if (input.cost !== undefined) {
      // The cost was cleared. Its expense goes with it, or the owner keeps
      // being billed for a charge the ticket no longer claims.
      const removal = await removeTicketExpense(ticket.id, actor, tx);
      expenseLocked = removal.locked;
    }

    const [row] = await tx
      .select()
      .from(maintenanceTickets)
      .where(eq(maintenanceTickets.id, ticket.id))
      .limit(1);
    return { ticket: row!, expenseId, expenseLocked };
  });
}

export async function addTicketPhoto(
  ticketId: number,
  url: string,
  caption: string | null,
  actor?: SessionUser | null,
) {
  return addPhoto({
    subjectType: "maintenance_ticket",
    subjectId: ticketId,
    url,
    caption,
    uploadedBy: actor?.id ?? null,
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listTickets(
  filter: { listingIds?: number[]; statuses?: TicketStatus[]; limit?: number } = {},
  executor: Executor = db,
) {
  if (filter.listingIds && filter.listingIds.length === 0) return [];
  return executor
    .select({
      ticket: maintenanceTickets,
      listingTitle: listings.title,
      listingVertical: listings.vertical,
      assigneeName: users.name,
      expenseId: expenses.id,
      expenseAmount: expenses.amount,
      expenseStatementId: expenses.statementId,
    })
    .from(maintenanceTickets)
    .innerJoin(listings, eq(listings.id, maintenanceTickets.listingId))
    .leftJoin(users, eq(users.id, maintenanceTickets.assignedUserId))
    .leftJoin(expenses, eq(expenses.maintenanceTicketId, maintenanceTickets.id))
    .where(
      and(
        filter.listingIds ? inArray(maintenanceTickets.listingId, filter.listingIds) : undefined,
        filter.statuses?.length ? inArray(maintenanceTickets.status, filter.statuses) : undefined,
      ),
    )
    .orderBy(asc(maintenanceTickets.status), desc(maintenanceTickets.id))
    .limit(filter.limit ?? 200);
}

export async function countOpenTickets(
  options: { listingIds?: number[] } = {},
  executor: Executor = db,
): Promise<number> {
  if (options.listingIds && options.listingIds.length === 0) return 0;
  const [row] = await executor
    .select({ value: sql<number>`COUNT(*)` })
    .from(maintenanceTickets)
    .where(
      and(
        inArray(maintenanceTickets.status, ["open", "in_progress"]),
        options.listingIds
          ? inArray(maintenanceTickets.listingId, options.listingIds)
          : undefined,
      ),
    );
  return Number(row?.value ?? 0);
}
