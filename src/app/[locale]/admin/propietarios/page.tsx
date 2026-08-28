import { ActionForm } from "@/components/action-form";
import { setOnboardingStepAction } from "@/app/actions/panel";
import { listOnboardingPipeline } from "@/db/queries/onboarding";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Owner onboarding pipeline (plan §5.O10, feature #19).
 *
 * Four of the five steps are derived from the database and tick themselves;
 * only `contract` needs a human. A step marked "auto" here is therefore a
 * statement about the data, not somebody's opinion of it.
 */
export default async function AdminOwnersPage() {
  await requireAdminPage();
  const pipeline = await listOnboardingPipeline();

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Propietarios y onboarding</h1>
        <p className="text-sm text-neutral-600">
          Los pasos marcados “auto” se completan solos cuando el dato existe (fotos, base de
          información, iCal, primera publicación publicada).
        </p>
      </header>

      {pipeline.length === 0 && (
        <p className="text-sm text-neutral-600">Todavía no hay propietarios cargados.</p>
      )}

      {pipeline.map((owner) => (
        <article key={owner.ownerId} className="space-y-2 border border-neutral-300 p-3">
          <h2 className="font-medium">
            {owner.ownerName} — {owner.doneCount}/{owner.totalCount}
            {owner.completedAt ? " ✔ completo" : ""}
          </h2>
          <table className="w-full text-left text-sm">
            <tbody>
              {owner.steps.map((step) => (
                <tr key={step.id} className="border-b">
                  <td className="py-1">
                    {step.label} {step.derived && <span className="text-xs text-neutral-500">(auto)</span>}
                  </td>
                  <td>{step.status}</td>
                  <td>
                    {!step.derived && (
                      <ActionForm
                        action={setOnboardingStepAction}
                        submitLabel={step.status === "done" ? "Desmarcar" : "Marcar hecho"}
                        className="inline"
                        submitClassName="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                      >
                        <input type="hidden" name="ownerId" value={owner.ownerId} />
                        <input type="hidden" name="stepKey" value={step.stepKey} />
                        <input
                          type="hidden"
                          name="status"
                          value={step.status === "done" ? "pending" : "done"}
                        />
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      ))}
    </section>
  );
}
