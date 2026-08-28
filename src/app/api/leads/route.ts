import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { captureLead } from "@/db/queries/leads";
import { readAttribution } from "@/lib/vendercrm";

/**
 * `POST /api/leads` — the public lead endpoint (plan §5.O10).
 *
 * Store first, forward second: `captureLead` writes our own row before it
 * touches VenderCRM, so the visitor's submission is never at the mercy of a
 * third party. The response is deliberately `{ ok: true }` even when the
 * forward failed — the visitor did their part, and the failure is ours to fix
 * from the log and the `failed` row in `/admin/consultas`.
 *
 * Unauthenticated by necessity. Its defences are a honeypot, a strict schema
 * and a per-IP rate limit.
 */
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(2).max(180),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(255).optional(),
  message: z.string().trim().max(5000).optional(),
  vertical: z.enum(["stay", "car"]).optional(),
  listingId: z.number().int().positive().optional(),
  sourceUrl: z.string().trim().max(500).optional(),
  /** Honeypot: a bot fills it, a human never sees it. */
  website: z.string().max(200).optional(),
});

/**
 * In-memory, per-instance rate limit. Right for one Hostinger Node slot
 * (plan §1.4) and documented in `KNOWN-ISSUES.md` for the day there are two.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, now = Date.now()): boolean {
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_input", fields: parsed.error.issues.map((i) => i.path.join(".")) },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // Honeypot: accept silently so the bot learns nothing, and store nothing.
  if (input.website) return NextResponse.json({ ok: true });

  if (!input.phone && !input.email) {
    return NextResponse.json({ ok: false, error: "contact_required" }, { status: 422 });
  }
  if (rateLimited(clientIp(request))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const attribution = readAttribution((await cookies()).get("vc_attr")?.value);

  const { lead, forwardStatus } = await captureLead(
    {
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      message: input.message ?? null,
      vertical: input.vertical ?? null,
      listingId: input.listingId ?? null,
      sourceUrl: input.sourceUrl ?? request.headers.get("referer"),
    },
    {
      referrer: attribution.referrer,
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      utm_term: attribution.utm_term,
      utm_content: attribution.utm_content,
      gclid: attribution.gclid,
      fbclid: attribution.fbclid,
    },
  );

  // `forwardStatus` is reported for observability, never as a failure: the lead
  // is stored either way.
  return NextResponse.json({ ok: true, id: lead.id, forwardStatus }, { status: 201 });
}
