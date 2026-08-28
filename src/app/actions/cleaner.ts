"use server";

/**
 * The cleaner's surface (#1, plan §2 and §5.O6).
 *
 * NO session, NO role check, NO `requireRole` — by design. A cleaner has no
 * account; the tokenized URL is the credential. Which means the token is the
 * ONLY thing these actions may trust, and every one of them resolves it to
 * exactly one task id inside the query layer. None of them accepts a task id,
 * so a valid token can never be aimed at somebody else's task.
 *
 * Everything reachable from here is deliberately narrow: tick the checklist,
 * add a photo, advance the status. Nothing reads guest data, money or other
 * listings.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addPhotoByToken,
  advanceTaskByTokenToNext,
  updateChecklistByToken,
} from "@/db/queries/cleaning";
import { storeUpload } from "@/lib/uploads";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/app/actions/form";

const tokenSchema = z.string().trim().min(16).max(64);

function revalidateTask(token: string) {
  revalidatePath(`/tarea/${token}`);
  revalidatePath("/admin/limpieza");
}

/** Tick/untick checklist items. Unchecked boxes send nothing, so the page
 *  declares which keys it rendered in `itemKeys`. */
export async function cleanerUpdateChecklistAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const token = tokenSchema.parse(formData.get("token"));
    const keys = String(formData.get("itemKeys") ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const updates: Record<string, boolean> = {};
    for (const key of keys) updates[key] = formData.get(`item:${key}`) === "on";
    await updateChecklistByToken(token, updates);
    revalidateTask(token);
    return "Checklist guardado";
  });
}

/** One button, one step along `needed → in_progress → ready`. */
export async function cleanerAdvanceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const token = tokenSchema.parse(formData.get("token"));
    const result = await advanceTaskByTokenToNext(token);
    revalidateTask(token);
    if (result.to === "ready") {
      const low = result.supplies.filter((s) => s.low).map((s) => s.supplyName);
      return low.length > 0
        ? `¡Listo! Avisamos que falta reponer: ${low.join(", ")}`
        : "¡Listo! Gracias.";
    }
    return "Tarea empezada";
  });
}

export async function cleanerUploadPhotoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const token = tokenSchema.parse(formData.get("token"));
    const caption = (formData.get("caption") as string | null)?.trim() || null;
    const stored = await storeUpload(formData.get("photo") as File, "cleaning");
    await addPhotoByToken(token, stored.url, caption);
    revalidateTask(token);
    return "Foto subida";
  });
}
