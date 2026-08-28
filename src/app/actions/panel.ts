"use server";

/**
 * Form-shaped wrappers over the O-2 booking actions, for the owner panel.
 *
 * `src/app/actions/bookings.ts` returns `ActionResult<T>` for programmatic
 * callers; `ActionForm` needs a `FormState`. Rather than duplicate the gate or
 * change O-2's contract, these adapt one to the other — the authorisation and
 * the engine call still happen in exactly one place.
 */
import { z } from "zod";
import { createBlockAction, deleteBlockAction } from "@/app/actions/bookings";
import { DomainError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { toFormState } from "@/app/actions/form";

const blockSchema = z.object({
  listingId: z.coerce.number().int().positive(),
  startAt: z.string().trim().min(4),
  endAt: z.string().trim().min(4),
  reason: z.enum(["owner_use", "maintenance"]).default("owner_use"),
  note: z.string().trim().max(300).nullish(),
});

export async function blockDatesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const input = blockSchema.parse({
      listingId: formData.get("listingId"),
      startAt: formData.get("startAt"),
      endAt: formData.get("endAt"),
      reason: formData.get("reason") ?? "owner_use",
      note: formData.get("note") || null,
    });
    const result = await createBlockAction(input);
    if (!result.ok) throw new DomainError(result.error, "unavailable");
    return "Fechas bloqueadas";
  });
}

export async function unblockDatesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return toFormState(async () => {
    const blockId = z.coerce.number().int().positive().parse(formData.get("blockId"));
    const result = await deleteBlockAction(blockId);
    if (!result.ok) throw new DomainError(result.error, "not_found");
    return "Bloqueo quitado";
  });
}
