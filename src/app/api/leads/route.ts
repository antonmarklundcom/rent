/**
 * `POST /api/leads` — the public lead endpoint (plan §5.O10).
 *
 * Store first, forward second (`vendercrm-lead-capture`): the row lands in our
 * own `leads` table before VenderCRM is called, so an outage, a bad key or a
 * rate limit costs a `forward_status`, never the enquiry. The response is
 * always `ok` when we stored it — a visitor who filled in a form must never see
 * our CRM plumbing (skill rule 5).
 *
 * The API key lives only in server env (`VENDERCRM_API_KEY`, never
 * `NEXT_PUBLIC_`), and this handler is the only thing that reads it.
 */
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { captureLead } from "@/db/queries/leads";
import { VERTICALS } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { readAttribution } from "@/lib/vendercrm";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(2).max(180),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(255).optional(),
  message: z.string().trim().max(4000).optional(),
  vertical: z.enum(VERTICALS).optional(),
  listingId: z.coerce.number().int().positive().optional(),
  bookingId: z.coerce.number().int().positive().optional(),
  sourceUrl: z.string().trim().max(500).optional(),
  /** Honeypot (skill rule 4): bots fill it, humans never see it. */
  website: z.string().optional(),
});

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function POST(request: Request) {
  let raw: Record<string, unknown>;
  try {
    raw = await readBody(request);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation", issues: parsed.error.issues.map((i) => i.path.join(".")) },
      { status: 422 },
    );
  }

  // Honeypot: accept silently. Telling a bot it was caught only teaches it.
  if (parsed.data.website) return NextResponse.json({ ok: true });

  const cookieStore = await cookies();
  const headerList = await headers();
  const attribution = readAttribution(cookieStore.get("vc_attr")?.value);

  try {
    const { lead, forwardStatus } = await captureLead({
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      message: parsed.data.message ?? null,
      vertical: parsed.data.vertical ?? null,
      listingId: parsed.data.listingId ?? null,
      bookingId: parsed.data.bookingId ?? null,
      sourceUrl: parsed.data.sourceUrl ?? headerList.get("referer") ?? null,
      attribution,
    });
    // `crm` is reported for our own admin UI and tests; a visitor-facing form
    // shows a thank-you either way.
    return NextResponse.json({ ok: true, id: lead.id, crm: forwardStatus });
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
    }
    console.error("[api/leads]", error);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
