/**
 * Renter ID verification (#16, plan §5.O8).
 *
 * Documents attached to a booking, each `pending → verified | rejected`. The
 * gate itself is the pure `src/lib/documents.ts`; this module supplies it with
 * rows and records the human decision behind every status change — "who looked
 * at this cédula and when" is the question an insurer asks.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  bookingDocuments,
  bookings,
  listings,
  type DocumentStatus,
  type DocumentType,
} from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { inTransaction } from "@/db/queries/tx";
import type { SessionUser } from "@/lib/auth-core";
import { evaluateDocumentGate, type DocumentGateResult } from "@/lib/documents";
import { DomainError } from "@/lib/errors";

export type BookingDocument = typeof bookingDocuments.$inferSelect;

export type AttachDocumentInput = {
  bookingId: number;
  type: DocumentType;
  fileUrl: string;
};

export async function attachDocument(
  input: AttachDocumentInput,
  actor?: SessionUser | null,
  executor?: Executor,
): Promise<BookingDocument> {
  const fileUrl = input.fileUrl.trim();
  if (!fileUrl) throw new DomainError("Falta el archivo del documento", "invalid_file");

  return inTransaction(executor, async (tx) => {
    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (!booking) {
      throw new DomainError("La reserva no existe", "not_found", { bookingId: input.bookingId });
    }
    const [inserted] = await tx
      .insert(bookingDocuments)
      .values({
        bookingId: input.bookingId,
        type: input.type,
        fileUrl,
        status: "pending",
      })
      .$returningId();
    await logActivity(
      {
        entity: "booking_document",
        entityId: inserted!.id,
        action: "document.attached",
        userId: actor?.id ?? null,
        meta: { bookingId: input.bookingId, type: input.type },
      },
      tx,
    );
    const [row] = await tx
      .select()
      .from(bookingDocuments)
      .where(eq(bookingDocuments.id, inserted!.id))
      .limit(1);
    return row!;
  });
}

/**
 * Verify or reject a document. A rejection must say why — the guest is going
 * to be asked to send another one, and "rejected" alone is not an instruction.
 */
export async function reviewDocument(
  input: {
    documentId: number;
    status: Extract<DocumentStatus, "verified" | "rejected">;
    rejectionReason?: string | null;
  },
  actor: SessionUser,
): Promise<BookingDocument> {
  if (input.status === "rejected" && !input.rejectionReason?.trim()) {
    throw new DomainError("Indicá por qué rechazás el documento", "invalid_amount");
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(bookingDocuments)
      .where(eq(bookingDocuments.id, input.documentId))
      .limit(1)
      .for("update");
    if (!row) {
      throw new DomainError("El documento no existe", "not_found", {
        documentId: input.documentId,
      });
    }
    await tx
      .update(bookingDocuments)
      .set({
        status: input.status,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        rejectionReason:
          input.status === "rejected" ? (input.rejectionReason?.trim() ?? null) : null,
      })
      .where(eq(bookingDocuments.id, input.documentId));
    await logActivity(
      {
        entity: "booking_document",
        entityId: input.documentId,
        action: `document.${input.status}`,
        userId: actor.id,
        meta: {
          bookingId: row.bookingId,
          type: row.type,
          from: row.status,
          reason: input.rejectionReason?.trim() ?? null,
        },
      },
      tx,
    );
    const [updated] = await tx
      .select()
      .from(bookingDocuments)
      .where(eq(bookingDocuments.id, input.documentId))
      .limit(1);
    return updated!;
  });
}

export async function listDocumentsForBooking(bookingId: number, executor: Executor = db) {
  return executor
    .select()
    .from(bookingDocuments)
    .where(eq(bookingDocuments.bookingId, bookingId))
    .orderBy(asc(bookingDocuments.id));
}

/**
 * The gate, resolved against the database.
 *
 * Used by `transitionBooking` before it confirms a car booking, and by the
 * admin UI to explain WHY a confirm button will refuse.
 */
export async function documentGateForBooking(
  booking: { id: number; vertical: (typeof listings.vertical.enumValues)[number] },
  executor: Executor = db,
): Promise<DocumentGateResult> {
  const rows = await executor
    .select({ status: bookingDocuments.status })
    .from(bookingDocuments)
    .where(eq(bookingDocuments.bookingId, booking.id));
  return evaluateDocumentGate(booking.vertical, rows);
}

/** Every document still waiting for a human — the admin verification queue. */
export async function listPendingDocuments(
  options: { listingIds?: number[]; limit?: number } = {},
  executor: Executor = db,
) {
  if (options.listingIds && options.listingIds.length === 0) return [];
  return executor
    .select({
      document: bookingDocuments,
      bookingReference: bookings.reference,
      guestName: bookings.guestName,
      bookingStatus: bookings.status,
      listingTitle: listings.title,
      listingVertical: listings.vertical,
    })
    .from(bookingDocuments)
    .innerJoin(bookings, eq(bookings.id, bookingDocuments.bookingId))
    .innerJoin(listings, eq(listings.id, bookings.listingId))
    .where(
      and(
        eq(bookingDocuments.status, "pending"),
        options.listingIds ? inArray(listings.id, options.listingIds) : undefined,
      ),
    )
    .orderBy(desc(bookingDocuments.id))
    .limit(options.limit ?? 100);
}
