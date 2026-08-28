/**
 * VenderCRM forwarding, written against the `vendercrm-lead-capture` skill.
 *
 * The skill's architectural rule: the browser NEVER talks to VenderCRM. Only
 * this module holds `VENDERCRM_API_KEY`, and only server code calls it.
 *
 * Two more rules from the skill shape this file:
 *   - **Never block the visitor.** `forwardLead` never throws; a CRM outage
 *     produces a `failed` status on our own row, not an error page for a guest
 *     who filled in a form.
 *   - **Always send `idempotency_key`.** Double-clicks and retried requests
 *     must not create two contacts a salesperson has to merge.
 *
 * And one from plan §4.5: with no key configured the lead is still STORED and
 * left `pending`, so nothing is lost and the app runs without the credential.
 *
 * No `server-only` marker here on purpose: `scripts/` (verify, and any future
 * retry cron) run this module under tsx, outside Next's bundler. What keeps the
 * key server-side is that it is read from `process.env.VENDERCRM_API_KEY` —
 * never `NEXT_PUBLIC_*` — and that nothing in `src/components/` imports this.
 */
import { createHash } from "node:crypto";

const DEFAULT_URL = "https://app.vendercrm.com/api/v1/leads";
const TIMEOUT_MS = 10_000;

export type LeadPayload = {
  phone: string;
  name?: string | null;
  email?: string | null;
  message?: string | null;
  source?: string | null;
  page_url?: string | null;
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  fields?: Record<string, unknown>;
};

export type ForwardResult =
  | { status: "forwarded"; contactId?: string; dealId?: string; duplicate: boolean }
  | { status: "pending"; error: string }
  | { status: "failed"; error: string };

export function isCrmConfigured(): boolean {
  return Boolean(process.env.VENDERCRM_API_KEY?.trim());
}

/**
 * Same phone within the same hour is the same submission (skill rule 2).
 * Collapses genuine double-submits without stopping the same person enquiring
 * again tomorrow.
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
      if (typeof value === "string" && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Empty strings fail the CRM's validation on `email` — omit instead of sending "". */
function compact(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
}

/**
 * POST one lead. Never throws.
 *
 * `pending` means "not attempted" (no key) and is retryable; `failed` means the
 * CRM rejected or was unreachable. The distinction is what the admin lead list
 * shows, because the fixes are different: configure a key vs. read the log.
 */
export async function forwardLead(
  payload: LeadPayload,
  options: { idempotencyKey?: string } = {},
): Promise<ForwardResult> {
  const key = process.env.VENDERCRM_API_KEY?.trim();
  if (!key) {
    return { status: "pending", error: "VENDERCRM_API_KEY no configurada" };
  }
  const url = process.env.VENDERCRM_API_URL?.trim() || DEFAULT_URL;
  const body = compact({
    ...payload,
    idempotency_key: options.idempotencyKey ?? idempotencyKey(payload.phone),
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      console.error("[vendercrm] lead rejected", response.status, text.slice(0, 500));
      return { status: "failed", error: `HTTP ${response.status}: ${text.slice(0, 300)}` };
    }
    // 201 = created, 200 = idempotency replay. Both are success (skill table).
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* a 2xx with a non-JSON body still means the lead landed */
    }
    return {
      status: "forwarded",
      contactId: parsed.contactId ? String(parsed.contactId) : undefined,
      dealId: parsed.dealId ? String(parsed.dealId) : undefined,
      duplicate: parsed.duplicate === true,
    };
  } catch (error) {
    console.error("[vendercrm] unreachable", error);
    return {
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "network error",
    };
  }
}
