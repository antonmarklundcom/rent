"use server";

/**
 * User management (plan §2) — `super_admin` only.
 *
 * That is not a UI decision: `admin` is explicitly "day-to-day ops, cannot
 * manage users or global settings", and the role that can mint another admin
 * is the role that can hand out every other permission in the system.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createUser,
  setUserActive,
  setUserPassword,
  setUserRole,
} from "@/db/queries/users";
import { USER_ROLES } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { AuthError } from "@/lib/auth-core";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/app/actions/form";

const SUPER_ADMIN_ONLY = ["super_admin"] as const;
const userId = z.coerce.number().int().positive();

export async function createUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    await requireRole(SUPER_ADMIN_ONLY);
    const input = z
      .object({
        name: z.string().trim().min(2).max(180),
        email: z.string().trim().min(5).max(255),
        phone: z.string().trim().max(40).nullish(),
        role: z.enum(USER_ROLES),
        password: z.string().max(200).nullish(),
        displayName: z.string().trim().max(180).nullish(),
        defaultCommissionPct: z.string().trim().max(6).nullish(),
      })
      .parse({
        name: formData.get("name"),
        email: formData.get("email"),
        phone: formData.get("phone") || null,
        role: formData.get("role"),
        password: formData.get("password") || null,
        displayName: formData.get("displayName") || null,
        defaultCommissionPct: formData.get("defaultCommissionPct") || null,
      });
    await createUser(input);
    revalidatePath("/admin/usuarios");
    return `${input.name} creado como ${input.role}`;
  });
}

export async function setUserActiveAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const actor = await requireRole(SUPER_ADMIN_ONLY);
    const id = userId.parse(formData.get("userId"));
    const isActive = formData.get("isActive") === "on";
    // Locking yourself out would leave the installation with no way back in.
    if (id === actor.id && !isActive) {
      throw new AuthError("No podés desactivar tu propia cuenta", "forbidden");
    }
    await setUserActive(id, isActive);
    revalidatePath("/admin/usuarios");
    return isActive ? "Cuenta activada" : "Cuenta desactivada";
  });
}

export async function setUserRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const actor = await requireRole(SUPER_ADMIN_ONLY);
    const id = userId.parse(formData.get("userId"));
    const role = z.enum(USER_ROLES).parse(formData.get("role"));
    if (id === actor.id && role !== "super_admin") {
      throw new AuthError("No podés quitarte a vos mismo el rol de super_admin", "forbidden");
    }
    await setUserRole(id, role);
    revalidatePath("/admin/usuarios");
    return `Rol cambiado a ${role}`;
  });
}

export async function setUserPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    await requireRole(SUPER_ADMIN_ONLY);
    const id = userId.parse(formData.get("userId"));
    const password = z.string().min(1).max(200).parse(formData.get("password"));
    await setUserPassword(id, password);
    revalidatePath("/admin/usuarios");
    return "Contraseña actualizada";
  });
}
