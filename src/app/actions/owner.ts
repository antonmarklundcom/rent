"use server";

/**
 * Owner panel + growth actions (#12, #15, #19 — plan §5.O10).
 *
 * Owner scoping is enforced here, per action, with `assertCanAccessListing`:
 * an owner may only ever write rows that hang off a listing they own, and the
 * query layer never sees a session. Publishing is admin-only (see
 * `OWNER_SETTABLE_STATUSES` in `src/db/queries/listings.ts` for why).
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { owners } from "@/db/schema";
import {
  createListing,
  setListingStatus,
  updateListing,
  type ListingWriteInput,
} from "@/db/queries/listings";
import { retryPendingLeads } from "@/db/queries/leads";
import { setOnboardingNotes, setOnboardingStep } from "@/db/queries/onboarding";
import {
  CANCELLATION_POLICIES,
  LISTING_STATUSES,
  ONBOARDING_STEP_STATUSES,
  PRICE_UNITS,
  PROPERTY_TYPES,
  VEHICLE_TYPES,
} from "@/db/schema";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import { AuthError } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { assertCanAccessListing } from "@/lib/scope";
import { toFormState } from "@/app/actions/form";

const OWNER_AND_ADMIN = ["super_admin", "admin", "owner"] as const;

const optionalInt = z.coerce.number().int().min(0).max(100000).nullish();

const listingSchema = z.object({
  title: z.string().trim().min(4).max(220),
  description: z.string().trim().max(5000).nullish(),
  price: z.string().trim().min(1).max(20),
  priceUnit: z.enum(PRICE_UNITS),
  locationId: z.coerce.number().int().positive().nullish(),
  cancellationPolicy: z.enum(CANCELLATION_POLICIES).default("moderate"),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  bedrooms: optionalInt,
  bathrooms: optionalInt,
  maxGuests: optionalInt,
  areaM2: optionalInt,
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
  make: z.string().trim().max(80).nullish(),
  model: z.string().trim().max(80).nullish(),
  year: z.coerce.number().int().min(1950).max(2100).nullish(),
  transmission: z.string().trim().max(40).nullish(),
  fuel: z.string().trim().max(40).nullish(),
  seats: optionalInt,
  plate: z.string().trim().max(20).nullish(),
  dailyKmLimit: optionalInt,
});

function readListingForm(formData: FormData): ListingWriteInput {
  const value = (name: string) => {
    const raw = formData.get(name);
    return raw === null || raw === "" ? null : String(raw);
  };
  return listingSchema.parse({
    title: formData.get("title"),
    description: value("description"),
    price: formData.get("price"),
    priceUnit: formData.get("priceUnit"),
    locationId: value("locationId"),
    cancellationPolicy: formData.get("cancellationPolicy") ?? "moderate",
    propertyType: value("propertyType") ?? undefined,
    bedrooms: value("bedrooms"),
    bathrooms: value("bathrooms"),
    maxGuests: value("maxGuests"),
    areaM2: value("areaM2"),
    vehicleType: value("vehicleType") ?? undefined,
    make: value("make"),
    model: value("model"),
    year: value("year"),
    transmission: value("transmission"),
    fuel: value("fuel"),
    seats: value("seats"),
    plate: value("plate"),
    dailyKmLimit: value("dailyKmLimit"),
  }) as ListingWriteInput;
}

export async function createListingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const user = await requireRole(OWNER_AND_ADMIN);
    const vertical = z.enum(["stay", "car"]).parse(formData.get("vertical"));
    // An admin creates a listing FOR an owner; an owner only ever for themselves.
    let ownerId: number;
    if (user.role === "owner") {
      if (!user.ownerId) {
        throw new AuthError("Tu cuenta no tiene perfil de propietario", "forbidden");
      }
      ownerId = user.ownerId;
    } else {
      ownerId = z.coerce.number().int().positive().parse(formData.get("ownerId"));
      // There are no foreign keys (plan §9, O-1 #4), so a mistyped id would
      // create a listing that belongs to nobody and that no panel can reach.
      const [owner] = await db
        .select({ id: owners.id })
        .from(owners)
        .where(eq(owners.id, ownerId))
        .limit(1);
      if (!owner) {
        throw new DomainError("Ese propietario no existe", "not_found", { ownerId });
      }
    }
    const input = readListingForm(formData);
    const listing = await createListing({ ...input, vertical, ownerId }, user);
    revalidatePath("/panel");
    revalidatePath("/admin/publicaciones");
    return `"${listing.title}" creada como borrador`;
  });
}

export async function updateListingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const user = await requireRole(OWNER_AND_ADMIN);
    const listingId = z.coerce.number().int().positive().parse(formData.get("listingId"));
    await assertCanAccessListing(user, listingId);
    await updateListing(listingId, readListingForm(formData), user);
    revalidatePath("/panel");
    revalidatePath(`/panel/publicaciones/${listingId}`);
    revalidatePath("/admin/publicaciones");
    return "Publicación actualizada";
  });
}

export async function setListingStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const user = await requireRole(OWNER_AND_ADMIN);
    const listingId = z.coerce.number().int().positive().parse(formData.get("listingId"));
    const status = z.enum(LISTING_STATUSES).parse(formData.get("status"));
    await assertCanAccessListing(user, listingId);
    await setListingStatus(listingId, status, user);
    revalidatePath("/panel");
    revalidatePath("/admin/publicaciones");
    revalidatePath("/alojamientos");
    revalidatePath("/autos");
    return `Publicación marcada como ${status}`;
  });
}

/* -------------------------------------------------------------------------- */
/* Onboarding (#19) — admin-only: it is the operator's pipeline                */
/* -------------------------------------------------------------------------- */

export async function setOnboardingStepAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const user = await requireRole(ADMIN_ROLES);
    const input = z
      .object({
        ownerId: z.coerce.number().int().positive(),
        stepKey: z.string().trim().min(2).max(60),
        status: z.enum(ONBOARDING_STEP_STATUSES),
      })
      .parse({
        ownerId: formData.get("ownerId"),
        stepKey: formData.get("stepKey"),
        status: formData.get("status"),
      });
    await setOnboardingStep(input, user);
    revalidatePath("/admin/propietarios");
    return "Checklist actualizado";
  });
}

export async function setOnboardingNotesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    await requireRole(ADMIN_ROLES);
    const ownerId = z.coerce.number().int().positive().parse(formData.get("ownerId"));
    const notes = z.string().trim().max(2000).nullish().parse(formData.get("notes") || null);
    await setOnboardingNotes(ownerId, notes ?? null);
    revalidatePath("/admin/propietarios");
    return "Notas guardadas";
  });
}

/* -------------------------------------------------------------------------- */
/* Leads (#CRM)                                                                */
/* -------------------------------------------------------------------------- */

/** Re-send every lead that never reached VenderCRM. Safe to press twice. */
export async function retryLeadsAction(_prev: FormState): Promise<FormState> {
  return toFormState(async () => {
    await requireRole(ADMIN_ROLES);
    const result = await retryPendingLeads();
    revalidatePath("/admin/consultas");
    if (result.skipped) {
      return "VenderCRM no está configurado todavía — las consultas quedan guardadas acá.";
    }
    return `${result.forwarded} de ${result.attempted} consulta(s) enviadas a VenderCRM`;
  });
}
