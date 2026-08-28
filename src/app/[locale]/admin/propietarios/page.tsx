import { ActionForm } from "@/components/action-form";
import { Badge, onboardingStepTone } from "@/components/ui/badge";
import { EmptyState, PageHeader, Section, TableWrap, table, td } from "@/components/ui/page-header";
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
    <div className="space-y-6">
      <PageHeader
        title="Propietarios y onboarding"
        subtitle="Los pasos marcados “auto” se completan solos cuando el dato existe (fotos, base de información, iCal, primera publicación publicada)."
      />

      {pipeline.length === 0 ? (
        <EmptyState>Todavía no hay propietarios cargados.</EmptyState>
      ) : (
        <div className="space-y-4">
          {pipeline.map((owner) => (
            <Section
              key={owner.ownerId}
              title={owner.ownerName}
              actions={
                <Badge tone={owner.completedAt ? "good" : "neutral"}>
                  {owner.doneCount}/{owner.totalCount}{owner.completedAt ? " · completo" : ""}
                </Badge>
              }
            >
              <TableWrap>
                <table className={table}>
                  <tbody>
                    {owner.steps.map((step) => (
                      <tr key={step.id}>
                        <td className={`${td} font-medium`}>
                          {step.label}{" "}
                          {step.derived && <span className="text-xs font-normal text-ink/45">(auto)</span>}
                        </td>
                        <td className={td}>
                          <Badge tone={onboardingStepTone(step.status)}>{step.status}</Badge>
                        </td>
                        <td className={td}>
                          {!step.derived && (
                            <ActionForm
                              action={setOnboardingStepAction}
                              submitLabel={step.status === "done" ? "Desmarcar" : "Marcar hecho"}
                              className="inline"
                              submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-ink/40 disabled:opacity-50"
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
              </TableWrap>
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}
