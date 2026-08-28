import "server-only";
/**
 * Turning a thrown engine error into something a form can render.
 *
 * The query layer throws `DomainError` for expected input problems and
 * `AuthError` when a gate refuses; both already carry es-PY messages, so they
 * are shown as-is. Anything else is a real bug: it is logged server-side and
 * the user gets a generic line rather than a stack trace.
 */
import { AuthError } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";

export async function toFormState(fn: () => Promise<string>): Promise<FormState> {
  try {
    return { ok: true, message: await fn() };
  } catch (error) {
    if (error instanceof DomainError || error instanceof AuthError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof Error && error.name === "ZodError") {
      return { ok: false, error: "Revisá los datos del formulario" };
    }
    console.error("[action]", error);
    return { ok: false, error: "No se pudo completar la acción" };
  }
}
