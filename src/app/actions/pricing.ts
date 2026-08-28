"use server";

/**
 * Extras (#10) and promo codes (#18) administration — plan §5.O11.
 *
 * The price engine has been able to apply these since phase O-2; what was
 * missing was a way to create one without opening the database. Admin-only:
 * an extra or a code changes what every guest pays.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  setExtraActive,
  setPromoActive,
  upsertExtra,
  upsertPromoCode,
} from "@/db/queries/extras";
import { DISCOUNT_TYPES, EXTRA_SCOPES, VERTICALS } from "@/db/schema";
import { ADMIN_ROLES, requireRole } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/app/actions/form";

const id = z.coerce.number().int().positive();
const optionalId = z.coerce.number().int().positive().nullish();

const extraSchema = z.object({
  id: optionalId,
  name: z.string().trim().min(2).max(140),
  description: z.string().trim().max(300).nullish(),
  price: z.string().trim().min(1).max(20),
  scope: z.enum(EXTRA_SCOPES),
  vertical: z.enum(VERTICALS).nullish(),
  listingId: optionalId,
  perUnit: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export async function saveExtraAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    await requireRole(ADMIN_ROLES);
    const input = extraSchema.parse({
      id: formData.get("extraId") || null,
      name: formData.get("name"),
      description: formData.get("description") || null,
      price: formData.get("price"),
      scope: formData.get("scope"),
      vertical: formData.get("vertical") || null,
      listingId: formData.get("listingId") || null,
      perUnit: formData.get("perUnit") === "on",
      isActive: formData.get("isActive") !== "off",
    });
    await upsertExtra(input);
    revalidatePath("/admin/precios");
    return `Adicional "${input.name}" guardado`;
  });
}

export async function toggleExtraAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    await requireRole(ADMIN_ROLES);
    const extraId = id.parse(formData.get("extraId"));
    const isActive = formData.get("isActive") === "on";
    await setExtraActive(extraId, isActive);
    revalidatePath("/admin/precios");
    return isActive ? "Adicional activado" : "Adicional desactivado";
  });
}

const promoSchema = z.object({
  id: optionalId,
  code: z.string().trim().min(3).max(40),
  discountType: z.enum(DISCOUNT_TYPES),
  discountValue: z.string().trim().min(1).max(20),
  validFrom: z.coerce.date().nullish(),
  validUntil: z.coerce.date().nullish(),
  maxUses: z.coerce.number().int().min(1).max(100000).nullish(),
  vertical: z.enum(VERTICALS).nullish(),
  isActive: z.boolean().default(true),
});

export async function savePromoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    await requireRole(ADMIN_ROLES);
    const input = promoSchema.parse({
      id: formData.get("promoId") || null,
      code: formData.get("code"),
      discountType: formData.get("discountType"),
      discountValue: formData.get("discountValue"),
      validFrom: formData.get("validFrom") || null,
      validUntil: formData.get("validUntil") || null,
      maxUses: formData.get("maxUses") || null,
      vertical: formData.get("vertical") || null,
      isActive: formData.get("isActive") !== "off",
    });
    await upsertPromoCode(input);
    revalidatePath("/admin/precios");
    return `Código ${input.code.toUpperCase()} guardado`;
  });
}

export async function togglePromoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    await requireRole(ADMIN_ROLES);
    const promoId = id.parse(formData.get("promoId"));
    const isActive = formData.get("isActive") === "on";
    await setPromoActive(promoId, isActive);
    revalidatePath("/admin/precios");
    return isActive ? "Código activado" : "Código desactivado";
  });
}
