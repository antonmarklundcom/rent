"use server";

/**
 * The public surface: booking requests and contact enquiries (plan §5.O11).
 *
 * No session, by design — these are the two things a stranger may do. Their
 * guards are therefore in the engine, not in a role check: `requirePublished`
 * refuses a listing that is not live (plan §9, O-2 judgment call 9), extras and
 * promo codes are re-resolved server-side so a tampered form cannot invent a
 * price, and a request only ever creates an `inquiry`, which never holds dates.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requestBookingAction } from "@/app/actions/bookings";
import { captureLead } from "@/db/queries/leads";
import { DomainError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/app/actions/form";

const guestSchema = {
  guestName: z.string().trim().min(2).max(180),
  guestPhone: z.string().trim().max(40).nullish(),
  guestEmail: z.string().trim().max(255).nullish(),
};

const requestSchema = z.object({
  listingId: z.coerce.number().int().positive(),
  ...guestSchema,
  startAt: z.string().trim().min(4),
  endAt: z.string().trim().min(4),
  guestCount: z.coerce.number().int().min(1).max(50).nullish(),
  promoCode: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  /** Honeypot — a bot fills it, a human never sees it. */
  website: z.string().max(200).nullish(),
});

/** Extras arrive as `extra:<id>` quantities; anything not offered is rejected
 *  by `resolveExtraSelections` in the engine, never trusted from here. */
function readExtras(formData: FormData): { extraId: number; qty: number }[] {
  const out: { extraId: number; qty: number }[] = [];
  for (const [key, value] of formData.entries()) {
    const match = /^extra:(\d+)$/.exec(key);
    if (!match) continue;
    const qty = Number(value);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 50) continue;
    out.push({ extraId: Number(match[1]), qty });
  }
  return out.slice(0, 20);
}

export async function requestBookingForm(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const input = requestSchema.parse({
      listingId: formData.get("listingId"),
      guestName: formData.get("guestName"),
      guestPhone: formData.get("guestPhone") || null,
      guestEmail: formData.get("guestEmail") || null,
      startAt: formData.get("startAt"),
      endAt: formData.get("endAt"),
      guestCount: formData.get("guestCount") || null,
      promoCode: formData.get("promoCode") || null,
      notes: formData.get("notes") || null,
      website: formData.get("website") || null,
    });
    // Accept silently so the bot learns nothing and nothing is stored.
    if (input.website) return "¡Gracias! Te contactamos a la brevedad.";
    if (!input.guestPhone && !input.guestEmail) {
      throw new DomainError("Dejanos un teléfono o un correo para contactarte", "invalid_amount");
    }

    const result = await requestBookingAction({
      listingId: input.listingId,
      guestName: input.guestName,
      guestPhone: input.guestPhone,
      guestEmail: input.guestEmail,
      startAt: input.startAt,
      endAt: input.endAt,
      guestCount: input.guestCount,
      promoCode: input.promoCode,
      notes: input.notes,
      extras: readExtras(formData),
    });
    if (!result.ok) {
      throw new DomainError(result.error, "unavailable");
    }
    return `¡Listo! Tu solicitud ${result.data.reference} quedó registrada. Te escribimos para confirmarla.`;
  });
}

const leadSchema = z.object({
  name: z.string().trim().min(2).max(180),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().max(255).nullish(),
  message: z.string().trim().max(5000).nullish(),
  vertical: z.enum(["stay", "car"]).nullish(),
  listingId: z.coerce.number().int().positive().nullish(),
  sourceUrl: z.string().trim().max(500).nullish(),
  website: z.string().max(200).nullish(),
});

/**
 * The contact form. Same store-first/forward-after path as `POST /api/leads`,
 * reached without JavaScript — the route handler exists for callers that have
 * it (plan §5.O10).
 */
export async function submitLeadForm(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const input = leadSchema.parse({
      name: formData.get("name"),
      phone: formData.get("phone") || null,
      email: formData.get("email") || null,
      message: formData.get("message") || null,
      vertical: formData.get("vertical") || null,
      listingId: formData.get("listingId") || null,
      sourceUrl: formData.get("sourceUrl") || null,
      website: formData.get("website") || null,
    });
    if (input.website) return "¡Gracias! Te contactamos a la brevedad.";

    await captureLead({
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      message: input.message ?? null,
      vertical: input.vertical ?? null,
      listingId: input.listingId ?? null,
      sourceUrl: input.sourceUrl ?? null,
    });
    revalidatePath("/admin/consultas");
    return "¡Gracias! Te contactamos a la brevedad.";
  });
}
