"use server";

/**
 * Owner-panel and admin-pipeline actions (plan §5.O10 — #15, #19, CRM).
 *
 * `requireRole` first, then `src/lib/scope.ts`. The owner-facing actions accept
 * `owner` as well as the admin roles; the pipeline and CRM ones do not.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { updatePanelListing } from "@/db/queries/panel";
import { setOnboardingStep } from "@/db/queries/onboarding";
import { retryPendingLeads } from "@/db/queries/leads";
import { LISTING_STATUSES, CANCELLATION_POLICIES } from "@/db/schema";
import { ADMIN_ROLES } from "@/lib/auth-core";
import { requireRole } from "@/lib/auth";
import { toFormState } from "@/app/actions/form";
import type { FormState } from "@/lib/form-state";

const OWNER_ROLES = ["super_admin", "admin", "owner"] as const;
const id = z.coerce.number().int().positive();

const listingSchema = z.object({
  listingId: id,
  title: z.string().trim().min(4).max(220).optional(),
  description: z.string().trim().max(5000).nullish(),
  price: z.string().trim().max(20).optional(),
  status: z.enum(LISTING_STATUSES).optional(),
  cancellationPolicy: z.enum(CANCELLATION_POLICIES).optional(),
});

/** Owner edits their own listing; the query layer enforces the scope. */
export async function updateListingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(OWNER_ROLES);
  return toFormState(async () => {
    const input = listingSchema.parse({
      listingId: formData.get("listingId"),
      title: formData.get("title") || undefined,
      description: formData.get("description") ?? undefined,
      price: formData.get("price") || undefined,
      status: formData.get("status") || undefined,
      cancellationPolicy: formData.get("cancellationPolicy") || undefined,
    });
    const { listingId, ...patch } = input;
    await updatePanelListing(user, listingId, patch);
    revalidatePath("/panel");
    revalidatePath(`/panel/publicaciones/${listingId}`);
    revalidatePath("/admin/publicaciones");
    return patch.status ? `Publicación marcada como "${patch.status}"` : "Publicación actualizada";
  });
}

const stepSchema = z.object({
  ownerId: id,
  stepKey: z.string().trim().min(2).max(60),
  status: z.enum(["pending", "done", "skipped"]),
});

/** #19 — a human ticks the steps the database cannot prove (the contract). */
export async function setOnboardingStepAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const input = stepSchema.parse({
      ownerId: formData.get("ownerId"),
      stepKey: formData.get("stepKey"),
      status: formData.get("status"),
    });
    await setOnboardingStep(input, user);
    revalidatePath("/admin/propietarios");
    return "Checklist actualizada";
  });
}

/** Re-attempt every lead that has not reached VenderCRM yet. */
export async function retryLeadsAction(): Promise<FormState> {
  await requireRole(ADMIN_ROLES);
  return toFormState(async () => {
    const { attempted, forwarded } = await retryPendingLeads();
    revalidatePath("/admin/leads");
    return attempted === 0
      ? "No hay consultas pendientes de enviar al CRM"
      : `${forwarded} de ${attempted} consulta(s) llegaron al CRM`;
  });
}
