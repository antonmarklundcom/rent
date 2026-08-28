import { ActionForm } from "@/components/action-form";
import { setOnboardingNotesAction, setOnboardingStepAction } from "@/app/actions/owner";
import { listOnboarding, ONBOARDING_STEPS } from "@/db/queries/onboarding";
import { formatLocalDate } from "@/lib/messaging";
import { requireAdminPage } from "@/lib/page-guards";

const DERIVED = new Set(ONBOARDING_STEPS.filter((s) => s.derived).map((s) => s.key));

/**
 * Owner onboarding pipeline (#19 — plan §5.O10).
 *
 * Four of the five steps tick themselves from the data (photos, info base,
 * iCal, first published listing), so this page shows the truth rather than
 * whatever somebody last remembered to click. Only `contract` is set by hand —
 * and any step can be deliberately skipped.
 */
export default async function AdminOwnersPage() {
  await requireAdminPage();
  const owners = await listOnboarding();

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Propietarios</h1>
        <p className="text-sm text-neutral-600">
          Checklist de puesta en marcha. Los pasos con datos detrás se marcan solos; el
          contrato se marca a mano.
        </p>
      </div>

      {owners.map((owner) => (
        <section key={owner.ownerId} className="space-y-2 rounded border border-neutral-300 p-3">
          <div className="text-sm">
            <strong>{owner.displayName}</strong>{" "}
            <span className="text-neutral-500">{owner.email}</span>
            <span className="block text-xs text-neutral-500">
              {owner.doneCount}/{owner.totalCount} pasos · desde{" "}
              {formatLocalDate(owner.startedAt)}
              {owner.completedAt ? ` · completado ${formatLocalDate(owner.completedAt)}` : ""}
            </span>
          </div>

          <ul className="space-y-1 text-sm">
            {owner.steps.map((step) => (
              <li key={step.id} className="flex flex-wrap items-center gap-2">
                <span className="grow">
                  {step.status === "done" ? "✓" : step.status === "skipped" ? "–" : "○"}{" "}
                  {step.label}
                  {DERIVED.has(step.stepKey as never) && (
                    <span className="ml-1 text-xs text-neutral-500">(automático)</span>
                  )}
                </span>
                <ActionForm
                  action={setOnboardingStepAction}
                  submitLabel="Guardar"
                  className="flex items-center gap-1"
                  submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                >
                  <input type="hidden" name="ownerId" value={owner.ownerId} />
                  <input type="hidden" name="stepKey" value={step.stepKey} />
                  <select
                    name="status"
                    defaultValue={step.status}
                    className="rounded border border-neutral-300 px-1 py-1 text-xs"
                  >
                    <option value="pending">pendiente</option>
                    <option value="done">hecho</option>
                    <option value="skipped">omitido</option>
                  </select>
                </ActionForm>
              </li>
            ))}
          </ul>

          <ActionForm
            action={setOnboardingNotesAction}
            submitLabel="Guardar notas"
            className="space-y-1"
            submitClassName="rounded border border-neutral-400 px-3 py-1 text-xs disabled:opacity-50"
          >
            <input type="hidden" name="ownerId" value={owner.ownerId} />
            <textarea
              name="notes"
              rows={2}
              defaultValue={owner.notes ?? ""}
              placeholder="Notas internas sobre este propietario"
              className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </ActionForm>
        </section>
      ))}

      {owners.length === 0 && (
        <p className="text-sm text-neutral-500">Todavía no hay propietarios cargados.</p>
      )}
    </section>
  );
}
