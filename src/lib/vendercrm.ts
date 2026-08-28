/**
 * VenderCRM lead forwarding (plan §5.O10, per the `vendercrm-lead-capture` skill).
 *
 * No `server-only` marker and no Next.js import, deliberately: `scripts/` jobs
 * and `verify-core` reach this through the query layer, and `server-only`
 * throws outside Next's build (same split as `auth-core.ts` / `auth.ts`). The
 * key stays out of the browser because `VENDERCRM_API_KEY` has no
 * `NEXT_PUBLIC_` prefix — Next only inlines prefixed variables — and because
 * nothing in `src/components/` imports this file.
 *
 * Two rules from that skill shape it:
 *   1. The browser NEVER talks to VenderCRM: the site's own server holds the
 *      key and forwards.
 *   2. `sendLead` never throws. A visitor who filled in a form and got an error
 *      page is a lost customer; a logged failure is a five-minute fix. The lead
 *      is already in our own `leads` table before this module is called
 *      (store-first, forward-after), so a CRM outage cannot lose one.
 *
 * Pipeline, stage, owner and tag are deliberately never sent: routing lives on
 * the site record inside the CRM, so the customer can re-route without a deploy
 * and a leaked key cannot redirect leads into another pipeline.
 */
import { createHash } from "crypto";

export type LeadPayload = {
  /** Required by the CRM — the contact's identity. Local `0981…` is fine. */
  phone: string;
  idempotency_key: string;
  name?: string;
  email?: string;
  message?: string;
  source?: string;
  page_url?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  fbclid?: string;
  fields?: Record<string, string | number | null | undefined>;
};

export type ForwardResult =
  | { ok: true; status: number; contactId: string | null; dealId: string | null; duplicate: boolean }
  | { ok: false; status: number; error: string; configured: boolean };

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * `.env.example` documents `VENDERCRM_API_URL` as the full endpoint. Accept a
 * bare base URL too rather than silently POSTing to the wrong path.
 */
function leadsEndpoint(): string | null {
  const raw = process.env.VENDERCRM_API_URL?.trim();
  if (!raw) return null;
  const url = raw.replace(/\/+$/, "");
  return url.endsWith("/leads") ? url : `${url}/api/v1/leads`;
}

export function isCrmConfigured(): boolean {
  return Boolean(leadsEndpoint() && process.env.VENDERCRM_API_KEY?.trim());
}

/**
 * The same phone in the same hour is the same submission.
 *
 * Users double-click and networks time out after the write succeeded; without a
 * stable key each of those becomes a duplicate contact somebody has to clean
 * up. Hour granularity collapses a double-submit while still letting the same
 * person enquire again tomorrow.
 */
export function idempotencyKey(phone: string, at: Date = new Date()): string {
  return createHash("sha256")
    .update(`${phone}|${at.toISOString().slice(0, 13)}`)
    .digest("hex");
}

/** First-touch attribution cookie written by the CRM's `vc-attribution.js`. */
export function readAttribution(cookieValue: string | undefined): Record<string, string> {
  if (!cookieValue) return {};
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(cookieValue));
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value) out[key] = value.slice(0, 2000);
    }
    return out;
  } catch {
    return {};
  }
}

/** Empty strings fail the CRM's `email` validation — omit rather than send `""`. */
function compact(payload: LeadPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null || value === "") continue;
    if (key === "fields" && typeof value === "object") {
      const fields = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          ([, v]) => v !== undefined && v !== null && v !== "",
        ),
      );
      if (Object.keys(fields).length > 0) out.fields = fields;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * POST one lead. Resolves in every case — a missing key, a 422 and a dead
 * network are all results the caller records on the `leads` row.
 */
export async function sendLead(payload: LeadPayload): Promise<ForwardResult> {
  const endpoint = leadsEndpoint();
  const apiKey = process.env.VENDERCRM_API_KEY?.trim();
  if (!endpoint || !apiKey) {
    // Not an error: plan §4.5 says a missing env value degrades a feature. The
    // lead is stored and stays `pending` until somebody configures the key.
    return {
      ok: false,
      status: 0,
      configured: false,
      error: "VENDERCRM_API_URL / VENDERCRM_API_KEY sin configurar",
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify(compact(payload)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await response.text();
    if (!response.ok) {
      console.error("[vendercrm] lead rejected", response.status, text.slice(0, 500));
      return {
        ok: false,
        status: response.status,
        configured: true,
        error: `${response.status}: ${text.slice(0, 400)}`,
      };
    }

    let body: { contactId?: unknown; dealId?: unknown; duplicate?: unknown } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      // A 2xx with an unparseable body still means the lead landed.
    }
    return {
      ok: true,
      status: response.status,
      contactId: body.contactId ? String(body.contactId) : null,
      dealId: body.dealId ? String(body.dealId) : null,
      duplicate: body.duplicate === true,
    };
  } catch (error) {
    console.error("[vendercrm] unreachable", error);
    return {
      ok: false,
      status: 0,
      configured: true,
      error: error instanceof Error ? error.message.slice(0, 400) : "error de red",
    };
  }
}
