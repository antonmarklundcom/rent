/**
 * Lead capture (plan §5.O10) — store first, forward second.
 *
 * The order is the whole design. `createLead` commits the row before anything
 * touches the network, so a CRM outage, a wrong key or a 422 costs us the
 * forward and never the lead: the row stays `pending` and
 * `retryPendingLeads` picks it up later. Nothing about a visitor's submission
 * depends on VenderCRM being up.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, listings, type LeadForwardStatus, type Vertical } from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { DomainError } from "@/lib/errors";
import {
  idempotencyKey,
  isCrmConfigured,
  sendLead,
  type LeadPayload,
} from "@/lib/vendercrm";

export type Lead = typeof leads.$inferSelect;

export type CreateLeadInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  message?: string | null;
  vertical?: Vertical | null;
  listingId?: number | null;
  bookingId?: number | null;
  sourceUrl?: string | null;
};

/** Step one: the lead exists in our database, whatever happens next. */
async function createLead(
  input: CreateLeadInput,
  executor: Executor = db,
): Promise<Lead> {
  const name = input.name.trim();
  if (name.length < 2) {
    throw new DomainError("Falta el nombre", "invalid_amount");
  }
  const phone = input.phone?.trim() || null;
  const email = input.email?.trim().toLowerCase() || null;
  if (!phone && !email) {
    throw new DomainError("Dejanos un teléfono o un correo para contactarte", "invalid_amount");
  }

  // `$returningId` and not "read back the highest id": two visitors submitting
  // at the same moment would otherwise both be handed the same row.
  const [inserted] = await executor
    .insert(leads)
    .values({
      name,
      phone,
      email,
      message: input.message?.trim() || null,
      vertical: input.vertical ?? null,
      listingId: input.listingId ?? null,
      bookingId: input.bookingId ?? null,
      sourceUrl: input.sourceUrl?.slice(0, 500) ?? null,
      forwardStatus: "pending",
    })
    .$returningId();

  const [row] = await executor.select().from(leads).where(eq(leads.id, inserted!.id)).limit(1);
  if (!row) throw new DomainError("No se pudo registrar la consulta", "not_found");
  return row;
}

/** Step two, and it is allowed to fail. Never throws. */
async function forwardLead(
  lead: Lead,
  extra: Partial<LeadPayload> = {},
  executor: Executor = db,
): Promise<LeadForwardStatus> {
  // The CRM identifies a contact by phone; without one there is nothing to
  // forward, so the row stays `pending` rather than failing forever.
  if (!lead.phone) return "pending";

  const result = await sendLead({
    phone: lead.phone,
    idempotency_key: idempotencyKey(lead.phone, lead.createdAt),
    name: lead.name,
    email: lead.email ?? undefined,
    message: lead.message ?? undefined,
    source: lead.vertical ? `alquilar:${lead.vertical}` : "alquilar",
    page_url: lead.sourceUrl ?? undefined,
    ...extra,
  });

  if (result.ok) {
    await executor
      .update(leads)
      .set({
        forwardStatus: "forwarded",
        forwardedAt: new Date(),
        forwardError: null,
        crmContactId: result.contactId,
        crmDealId: result.dealId,
      })
      .where(eq(leads.id, lead.id));
    return "forwarded";
  }

  // An unconfigured CRM is not a failure — it is a deployment that has not been
  // finished yet (plan §4.5). Those rows stay `pending` and retry cleanly.
  const status: LeadForwardStatus = result.configured ? "failed" : "pending";
  await executor
    .update(leads)
    .set({ forwardStatus: status, forwardError: result.error.slice(0, 500) })
    .where(eq(leads.id, lead.id));
  return status;
}

export type CaptureResult = { lead: Lead; forwardStatus: LeadForwardStatus };

/**
 * The one function every lead entry point calls: public contact form, listing
 * enquiry, and the booking-request action (a booking inquiry IS a lead —
 * plan §5.O10).
 */
export async function captureLead(
  input: CreateLeadInput,
  extra: Partial<LeadPayload> = {},
): Promise<CaptureResult> {
  const lead = await createLead(input);
  await logActivity({
    entity: "lead",
    entityId: lead.id,
    action: "lead.created",
    meta: { listingId: lead.listingId, bookingId: lead.bookingId, vertical: lead.vertical },
  });
  const forwardStatus = await forwardLead(lead, extra);
  return { lead: { ...lead, forwardStatus }, forwardStatus };
}

/** Re-send everything that has not landed in the CRM yet. Idempotent. */
export async function retryPendingLeads(
  options: { limit?: number } = {},
): Promise<{ attempted: number; forwarded: number; skipped: boolean }> {
  if (!isCrmConfigured()) return { attempted: 0, forwarded: 0, skipped: true };
  const rows = await db
    .select()
    .from(leads)
    .where(inArray(leads.forwardStatus, ["pending", "failed"]))
    .orderBy(leads.id)
    .limit(options.limit ?? 50);

  let forwarded = 0;
  for (const lead of rows) {
    if ((await forwardLead(lead)) === "forwarded") forwarded += 1;
  }
  return { attempted: rows.length, forwarded, skipped: false };
}

export type LeadRow = Lead & { listingTitle: string | null };

export async function listLeads(
  options: { listingIds?: number[]; status?: LeadForwardStatus; limit?: number } = {},
  executor: Executor = db,
): Promise<LeadRow[]> {
  if (options.listingIds && options.listingIds.length === 0) return [];
  const rows = await executor
    .select({ lead: leads, listingTitle: listings.title })
    .from(leads)
    .leftJoin(listings, eq(listings.id, leads.listingId))
    .where(
      and(
        options.status ? eq(leads.forwardStatus, options.status) : undefined,
        options.listingIds ? inArray(leads.listingId, options.listingIds) : undefined,
      ),
    )
    .orderBy(desc(leads.id))
    .limit(options.limit ?? 100);
  return rows.map((row) => ({ ...row.lead, listingTitle: row.listingTitle }));
}

export async function leadCounts(
  executor: Executor = db,
): Promise<Record<LeadForwardStatus, number>> {
  const rows = await executor
    .select({ status: leads.forwardStatus, value: sql<number>`count(*)` })
    .from(leads)
    .groupBy(leads.forwardStatus);
  const out: Record<LeadForwardStatus, number> = { pending: 0, forwarded: 0, failed: 0 };
  for (const row of rows) out[row.status] = Number(row.value);
  return out;
}
