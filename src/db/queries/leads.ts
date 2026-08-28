/**
 * Leads (plan §5.O10) — store first, forward second.
 *
 * The order is the whole design. A lead is written to OUR database before
 * anything is sent to VenderCRM, so a CRM outage, a wrong key or a rate limit
 * costs us a `forward_status`, never the enquiry itself. `retryForward` then
 * makes recovery a button rather than a data-recovery job.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, type LeadForwardStatus, type Vertical } from "@/db/schema";
import { logActivity } from "@/db/queries/activity";
import type { Executor } from "@/db/queries/availability";
import { DomainError } from "@/lib/errors";
import { forwardLead, idempotencyKey, type LeadPayload } from "@/lib/vendercrm";
import { normalisePhone } from "@/lib/messaging";

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
  /** First-touch attribution read from the `vc_attr` cookie server-side. */
  attribution?: Record<string, string>;
  /** Extra context for the CRM timeline (dates asked for, guest count, …). */
  fields?: Record<string, unknown>;
};

/** Store the lead. Always succeeds if the input is sane — forwarding is separate. */
export async function storeLead(
  input: CreateLeadInput,
  executor: Executor = db,
): Promise<Lead> {
  const name = input.name.trim();
  if (!name) throw new DomainError("Falta el nombre", "invalid_amount");
  const phone = input.phone?.trim() || null;
  const email = input.email?.trim().toLowerCase() || null;
  if (!phone && !email) {
    throw new DomainError("Dejanos un teléfono o un correo para contactarte", "invalid_amount");
  }
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
  if (!row) throw new DomainError("No se pudo guardar la consulta", "not_found");
  await logActivity(
    {
      entity: "lead",
      entityId: row.id,
      action: "lead.stored",
      meta: { listingId: row.listingId, bookingId: row.bookingId, vertical: row.vertical },
    },
    executor,
  );
  return row;
}

function payloadFor(lead: Lead, extra: CreateLeadInput = { name: lead.name }): LeadPayload {
  const attribution = extra.attribution ?? {};
  return {
    // The CRM identifies a contact by phone and normalises PY formats itself;
    // we still send the canonical form so our records and theirs match.
    phone: normalisePhone(lead.phone) ?? lead.phone ?? "",
    name: lead.name,
    email: lead.email,
    message: lead.message,
    source: `alquilar:${lead.vertical ?? "web"}`,
    page_url: attribution.landing_page ?? lead.sourceUrl,
    referrer: attribution.referrer,
    utm_source: attribution.utm_source,
    utm_medium: attribution.utm_medium,
    utm_campaign: attribution.utm_campaign,
    utm_term: attribution.utm_term,
    utm_content: attribution.utm_content,
    gclid: attribution.gclid,
    fbclid: attribution.fbclid,
    fields: extra.fields,
  };
}

/**
 * Try to forward one stored lead and record the outcome.
 *
 * Never throws. A lead with no phone at all cannot become a CRM contact (the
 * endpoint requires one), so it stays `pending` with a reason rather than
 * generating a guaranteed-failing call on every retry.
 */
export async function forwardStoredLead(
  lead: Lead,
  extra: CreateLeadInput = { name: lead.name },
  executor: Executor = db,
): Promise<LeadForwardStatus> {
  const phone = normalisePhone(lead.phone);
  if (!phone) {
    await executor
      .update(leads)
      .set({ forwardStatus: "pending", forwardError: "sin teléfono para el CRM" })
      .where(eq(leads.id, lead.id));
    return "pending";
  }
  const result = await forwardLead(payloadFor(lead, extra), {
    idempotencyKey: idempotencyKey(phone, lead.createdAt ?? new Date()),
  });

  if (result.status === "forwarded") {
    await executor
      .update(leads)
      .set({
        forwardStatus: "forwarded",
        forwardedAt: new Date(),
        forwardError: null,
        crmContactId: result.contactId ?? null,
        crmDealId: result.dealId ?? null,
      })
      .where(eq(leads.id, lead.id));
    await logActivity(
      {
        entity: "lead",
        entityId: lead.id,
        action: "lead.forwarded",
        meta: { contactId: result.contactId, duplicate: result.duplicate },
      },
      executor,
    );
    return "forwarded";
  }

  await executor
    .update(leads)
    .set({ forwardStatus: result.status, forwardError: result.error.slice(0, 500) })
    .where(eq(leads.id, lead.id));
  return result.status;
}

/**
 * The one call a form makes: store, then attempt the forward.
 *
 * Returns the stored row either way — the caller shows the guest a thank-you
 * regardless of what the CRM did (skill rule 5).
 */
export async function captureLead(input: CreateLeadInput): Promise<{
  lead: Lead;
  forwardStatus: LeadForwardStatus;
}> {
  const lead = await storeLead(input);
  const forwardStatus = await forwardStoredLead(lead, input);
  return { lead, forwardStatus };
}

/** Re-attempt everything that has not landed in the CRM yet. */
export async function retryPendingLeads(limit = 50): Promise<{
  attempted: number;
  forwarded: number;
}> {
  const rows = await db
    .select()
    .from(leads)
    .where(inArray(leads.forwardStatus, ["pending", "failed"]))
    .orderBy(leads.createdAt)
    .limit(limit);
  let forwarded = 0;
  for (const row of rows) {
    const status = await forwardStoredLead(row);
    if (status === "forwarded") forwarded += 1;
  }
  return { attempted: rows.length, forwarded };
}

export async function listLeads(
  options: { status?: LeadForwardStatus; limit?: number } = {},
  executor: Executor = db,
) {
  return executor
    .select()
    .from(leads)
    .where(options.status ? eq(leads.forwardStatus, options.status) : undefined)
    .orderBy(desc(leads.createdAt))
    .limit(options.limit ?? 100);
}

export async function leadCounts(executor: Executor = db) {
  const rows = await executor
    .select({ status: leads.forwardStatus, count: sql<number>`COUNT(*)` })
    .from(leads)
    .groupBy(leads.forwardStatus);
  const counts: Record<LeadForwardStatus, number> = { pending: 0, forwarded: 0, failed: 0 };
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}

/** Leads captured for one listing — shown on the admin listing screen. */
export async function listLeadsForListing(listingId: number, executor: Executor = db) {
  return executor
    .select()
    .from(leads)
    .where(and(eq(leads.listingId, listingId)))
    .orderBy(desc(leads.createdAt))
    .limit(50);
}
