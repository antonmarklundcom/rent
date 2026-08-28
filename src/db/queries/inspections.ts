/**
 * Handover / inspection module (#5, plan §5.O8).
 *
 * The record that decides who pays for a scratch. A `pickup` inspection says
 * what we handed over; a `return` inspection says what came back. Damage on a
 * return can, in ONE transaction, open a maintenance ticket (#6) — which
 * itself creates the repair expense (#7) — and deduct the security deposit
 * (#9), with both ids written onto the deposit row.
 *
 * That atomicity is the point: a deduction whose justifying ticket failed to
 * save is money taken with no paperwork, which is exactly the position a
 * dispute must never find us in.
 */
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  bookings,
  deposits,
  inspections,
  listings,
  type InspectionType,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { deductDeposit } from "@/db/queries/deposits";
import { createTicket } from "@/db/queries/maintenance";
import { addPhoto, listPhotos } from "@/db/queries/photos";
import { inTransaction } from "@/db/queries/tx";
import type { SessionUser } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";

export type Inspection = typeof inspections.$inferSelect;

export type RecordInspectionInput = {
  bookingId: number;
  type: InspectionType;
  odometer?: number | null;
  fuelLevel?: number | null;
  notes?: string | null;
  damageFlag?: boolean;
  confirmedByGuest?: boolean;
  /** Open a maintenance ticket for the damage found. Requires `damageFlag`. */
  openTicket?: { title: string; description?: string | null; cost?: string | null } | null;
  /** Keep part of the deposit for the damage. Requires `damageFlag`. */
  deduct?: { amount: string; reason: string } | null;
};

export type RecordInspectionResult = {
  inspection: Inspection;
  ticketId: number | null;
  expenseId: number | null;
  depositId: number | null;
};

export async function recordInspection(
  input: RecordInspectionInput,
  actor?: SessionUser | null,
  executor?: Executor,
): Promise<RecordInspectionResult> {
  const damageFlag = Boolean(input.damageFlag);
  if (!damageFlag && (input.openTicket || input.deduct)) {
    throw new DomainError(
      "Marcá el daño antes de abrir un ticket o deducir el depósito",
      "invalid_amount",
    );
  }
  if (input.fuelLevel !== null && input.fuelLevel !== undefined) {
    if (!Number.isInteger(input.fuelLevel) || input.fuelLevel < 0 || input.fuelLevel > 100) {
      throw new DomainError("El nivel de combustible va de 0 a 100", "invalid_amount");
    }
  }
  if (input.odometer !== null && input.odometer !== undefined) {
    if (!Number.isInteger(input.odometer) || input.odometer < 0) {
      throw new DomainError("El odómetro tiene que ser un entero positivo", "invalid_amount");
    }
  }

  return inTransaction(executor, async (tx) => {
    const [row] = await tx
      .select({ booking: bookings, listingId: listings.id, vertical: listings.vertical })
      .from(bookings)
      .innerJoin(listings, eq(listings.id, bookings.listingId))
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (!row) {
      throw new DomainError("La reserva no existe", "not_found", { bookingId: input.bookingId });
    }

    // `inspections_booking_type_uq` allows exactly one pickup and one return
    // per booking. A second attempt is a correction, and corrections to a
    // handover record are deliberate — never a silent overwrite.
    const [existing] = await tx
      .select({ id: inspections.id })
      .from(inspections)
      .where(
        and(eq(inspections.bookingId, input.bookingId), eq(inspections.type, input.type)),
      )
      .limit(1);
    if (existing) {
      throw new DomainError(
        `Esta reserva ya tiene una inspección de ${input.type === "pickup" ? "entrega" : "devolución"}`,
        "inspection_exists",
        { inspectionId: existing.id },
      );
    }

    const [inserted] = await tx
      .insert(inspections)
      .values({
        bookingId: input.bookingId,
        type: input.type,
        odometer: input.odometer ?? null,
        fuelLevel: input.fuelLevel ?? null,
        notes: input.notes?.trim() || null,
        damageFlag,
        confirmedByGuest: Boolean(input.confirmedByGuest),
        performedBy: actor?.id ?? null,
        performedAt: new Date(),
      })
      .$returningId();
    const inspectionId = inserted!.id;

    await logActivity(
      {
        entity: "inspection",
        entityId: inspectionId,
        action: `inspection.${input.type}`,
        userId: actor?.id ?? null,
        meta: {
          bookingId: input.bookingId,
          listingId: row.listingId,
          odometer: input.odometer ?? null,
          fuelLevel: input.fuelLevel ?? null,
          damageFlag,
          confirmedByGuest: Boolean(input.confirmedByGuest),
        },
      },
      tx,
    );

    let ticketId: number | null = null;
    let expenseId: number | null = null;
    if (input.openTicket) {
      const result = await createTicket(
        {
          listingId: row.listingId,
          title: input.openTicket.title,
          description: input.openTicket.description ?? input.notes ?? null,
          cost: input.openTicket.cost ?? null,
          inspectionId,
        },
        actor,
        tx,
      );
      ticketId = result.ticket.id;
      expenseId = result.expenseId;
    }

    let depositId: number | null = null;
    if (input.deduct) {
      const [deposit] = await tx
        .select({ id: deposits.id })
        .from(deposits)
        .where(eq(deposits.bookingId, input.bookingId))
        .limit(1);
      if (!deposit) {
        throw new DomainError(
          "Esta reserva no tiene un depósito para deducir",
          "not_found",
          { bookingId: input.bookingId },
        );
      }
      await deductDeposit(
        {
          depositId: deposit.id,
          deductionAmount: input.deduct.amount,
          reason: input.deduct.reason,
          inspectionId,
          maintenanceTicketId: ticketId,
        },
        actor,
        tx,
      );
      depositId = deposit.id;
    }

    const [inspection] = await tx
      .select()
      .from(inspections)
      .where(eq(inspections.id, inspectionId))
      .limit(1);
    return { inspection: inspection!, ticketId, expenseId, depositId };
  });
}

export async function addInspectionPhoto(
  inspectionId: number,
  url: string,
  caption: string | null,
  actor?: SessionUser | null,
) {
  return addPhoto({
    subjectType: "inspection",
    subjectId: inspectionId,
    url,
    caption,
    uploadedBy: actor?.id ?? null,
  });
}

/** Guest sign-off on a handover record — the "conforme" a dispute turns on. */
export async function confirmInspectionByGuest(
  inspectionId: number,
  actor?: SessionUser | null,
): Promise<Inspection> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(inspections)
      .where(eq(inspections.id, inspectionId))
      .limit(1);
    if (!row) {
      throw new DomainError("La inspección no existe", "not_found", { inspectionId });
    }
    if (!row.confirmedByGuest) {
      await tx
        .update(inspections)
        .set({ confirmedByGuest: true })
        .where(eq(inspections.id, inspectionId));
      await logActivity(
        {
          entity: "inspection",
          entityId: inspectionId,
          action: "inspection.confirmed_by_guest",
          userId: actor?.id ?? null,
          meta: { bookingId: row.bookingId, type: row.type },
        },
        tx,
      );
    }
    const [updated] = await tx
      .select()
      .from(inspections)
      .where(eq(inspections.id, inspectionId))
      .limit(1);
    return updated!;
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listInspectionsForBooking(bookingId: number, executor: Executor = db) {
  const rows = await executor
    .select()
    .from(inspections)
    .where(eq(inspections.bookingId, bookingId))
    .orderBy(asc(inspections.type), asc(inspections.id));
  return Promise.all(
    rows.map(async (inspection) => ({
      inspection,
      photos: await listPhotos("inspection", inspection.id, executor),
    })),
  );
}

/**
 * Latest odometer reading for a vehicle, across every booking of that listing.
 * Feeds the km-based fleet reminders (#14).
 */
export async function latestOdometer(
  listingId: number,
  executor: Executor = db,
): Promise<number | null> {
  // An inspection may legitimately carry no reading (a stay, or a rushed
  // handover), so take the newest one that HAS a number rather than the
  // newest one outright.
  const rows = await executor
    .select({ odometer: inspections.odometer })
    .from(inspections)
    .innerJoin(bookings, eq(bookings.id, inspections.bookingId))
    .where(and(eq(bookings.listingId, listingId), isNotNull(inspections.odometer)))
    .orderBy(desc(inspections.performedAt), desc(inspections.id))
    .limit(1);
  return rows[0]?.odometer ?? null;
}

export async function listDamagedInspections(
  options: { listingIds?: number[]; limit?: number } = {},
  executor: Executor = db,
) {
  if (options.listingIds && options.listingIds.length === 0) return [];
  return executor
    .select({
      inspection: inspections,
      bookingReference: bookings.reference,
      guestName: bookings.guestName,
      listingTitle: listings.title,
    })
    .from(inspections)
    .innerJoin(bookings, eq(bookings.id, inspections.bookingId))
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(
      and(
        eq(inspections.damageFlag, true),
        options.listingIds ? inArray(listings.id, options.listingIds) : undefined,
      ),
    )
    .orderBy(desc(inspections.performedAt))
    .limit(options.limit ?? 50);
}
