import { getTranslations } from "next-intl/server";
import {
  adjustSupplyLevelAction,
  advanceCleaningTaskAction,
  assignCleanerAction,
  createCleaningTaskAction,
  setSupplyLevelAction,
} from "@/app/actions/operations";
import { ActionForm } from "@/components/action-form";
import { Badge, cleaningStatusTone } from "@/components/ui/badge";
import { fieldClass, labelClass } from "@/components/ui/field";
import { EmptyState, PageHeader, Section, TableWrap, table, th, td } from "@/components/ui/page-header";
import {
  cleanerJobCounts,
  listCleaners,
  listRoster,
} from "@/db/queries/cleaning";
import { listListingsForUser } from "@/db/queries/listings";
import { listLowStock, listSupplyLevels } from "@/db/queries/supplies";
import { nextCleaningStatus } from "@/lib/cleaning";
import { magicLinkUrl } from "@/lib/magic-link";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Cleaning & turnover control (#1, #13, #17 — plan §5.O6).
 * Functional, not designed: Sonnet styles this in phase S-2 (plan §6.S3).
 */
export default async function AdminCleaningPage({
  searchParams,
}: {
  searchParams: Promise<{ dia?: string }>;
}) {
  const user = await requireAdminPage();
  const { dia } = await searchParams;
  const t = await getTranslations("admin");
  const tStatus = await getTranslations("cleaningStatus");

  const day = dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : undefined;
  const [roster, cleaners, counts, listings, lowStock, levels] = await Promise.all([
    listRoster({ day }),
    listCleaners(),
    cleanerJobCounts(),
    listListingsForUser(user),
    listLowStock(),
    listSupplyLevels(),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader title={t("cleaning")} />

      <Section title={`Roster ${day ? `— ${day}` : "— todas las tareas con fecha"}`}>
        <form className="flex flex-wrap items-end gap-2 text-sm">
          <label className={labelClass}>
            <span className="text-ink/70">Día</span>
            <input type="date" name="dia" defaultValue={day ?? ""} className={fieldClass} />
          </label>
          <button type="submit" className="rounded-sm border border-ink/20 px-3 py-2 hover:border-ink/40">
            Filtrar
          </button>
        </form>

        {roster.length === 0 ? (
          <EmptyState>No hay tareas para ese filtro.</EmptyState>
        ) : (
          <TableWrap>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Propiedad</th>
                  <th className={th}>Estado</th>
                  <th className={th}>Para</th>
                  <th className={th}>Asignada a</th>
                  <th className={th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {roster.map(({ task, listingTitle, assigneeName, bookingReference }) => {
                  const next = nextCleaningStatus(task.status);
                  return (
                    <tr key={task.id}>
                      <td className={td}>{task.id}</td>
                      <td className={td}>
                        {listingTitle}
                        {bookingReference && (
                          <span className="block text-xs text-ink/50">{bookingReference}</span>
                        )}
                        <a href={magicLinkUrl(task.magicToken)} className="block text-xs text-accent hover:underline">
                          enlace del limpiador
                        </a>
                      </td>
                      <td className={td}>
                        <Badge tone={cleaningStatusTone(task.status)}>{tStatus(task.status)}</Badge>
                      </td>
                      <td className={td}>
                        {task.dueBy ? new Date(task.dueBy).toISOString().slice(0, 16).replace("T", " ") : "—"}
                      </td>
                      <td className={td}>
                        <ActionForm
                          action={assignCleanerAction}
                          submitLabel="Asignar"
                          className="space-y-1"
                          submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-ink/40 disabled:opacity-50"
                        >
                          <input type="hidden" name="taskId" value={task.id} />
                          <select
                            name="assignedUserId"
                            defaultValue={task.assignedUserId ?? ""}
                            className="rounded-sm border border-ink/15 px-1.5 py-1 text-xs"
                          >
                            <option value="">— sin asignar —</option>
                            {cleaners.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          {assigneeName && (
                            <span className="block text-xs text-ink/50">{assigneeName}</span>
                          )}
                        </ActionForm>
                      </td>
                      <td className={td}>
                        {next ? (
                          <ActionForm
                            action={advanceCleaningTaskAction}
                            submitLabel={`→ ${tStatus(next)}`}
                            className="space-y-1"
                            submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-ink/40 disabled:opacity-50"
                          >
                            <input type="hidden" name="taskId" value={task.id} />
                            <input type="hidden" name="to" value={next} />
                          </ActionForm>
                        ) : (
                          <span className="text-xs text-ink/45">completada</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Nueva tarea">
        <ActionForm action={createCleaningTaskAction} submitLabel="Crear tarea">
          <label className={labelClass}>
            <span className="text-ink/70">Propiedad</span>
            <select name="listingId" required className={fieldClass}>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            <span className="text-ink/70">Asignar a</span>
            <select name="assignedUserId" className={fieldClass}>
              <option value="">— sin asignar —</option>
              {cleaners.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            <span className="text-ink/70">Para (fecha y hora)</span>
            <input type="datetime-local" name="dueBy" className={fieldClass} />
          </label>
          <label className={labelClass}>
            <span className="text-ink/70">Notas</span>
            <textarea name="notes" rows={2} className={fieldClass} />
          </label>
        </ActionForm>
      </Section>

      <Section title="Trabajos por limpiador (#13)">
        <TableWrap>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Persona</th>
                <th className={th}>Completadas</th>
                <th className={th}>Abiertas</th>
              </tr>
            </thead>
            <tbody>
              {counts.map((row) => (
                <tr key={row.userId}>
                  <td className={`${td} font-medium`}>{row.name}</td>
                  <td className={`${td} tabular-nums`}>{row.completed}</td>
                  <td className={`${td} tabular-nums`}>{row.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section title={`${t("lowStock")} (#17)`}>
        {lowStock.length === 0 ? (
          <p className="text-sm text-ink/50">Todo el stock está por encima del mínimo.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {lowStock.map((row) => (
              <li key={row.levelId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2">
                <span>
                  {row.listingTitle} · {row.supplyName}:{" "}
                  <strong>{row.qty} {row.unit}</strong> (mín. {row.lowThreshold})
                </span>
                <ActionForm
                  action={adjustSupplyLevelAction}
                  submitLabel="Reponer"
                  className="flex items-center gap-1"
                  submitClassName="rounded-sm border border-ink/20 bg-surface px-2.5 py-1 text-xs hover:border-ink/40 disabled:opacity-50"
                >
                  <input type="hidden" name="levelId" value={row.levelId} />
                  <input type="number" name="delta" defaultValue={12} className="w-16 rounded-sm border border-ink/15 px-1.5 py-1 text-xs" />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}

        <details>
          <summary className="cursor-pointer text-sm font-medium">Todo el stock ({levels.length})</summary>
          <ul className="mt-2 space-y-1 text-sm text-ink/60">
            {levels.map((row) => (
              <li key={row.levelId}>
                {row.listingTitle} · {row.supplyName}: {row.qty} {row.unit} · consume{" "}
                {row.perCleaning}/limpieza
              </li>
            ))}
          </ul>
        </details>

        <details>
          <summary className="cursor-pointer text-sm font-medium">Cargar o actualizar un insumo</summary>
          <div className="mt-3">
            <ActionForm action={setSupplyLevelAction} submitLabel="Guardar insumo">
              <label className={labelClass}>
                <span className="text-ink/70">Propiedad</span>
                <select name="listingId" required className={fieldClass}>
                  {listings.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                <span className="text-ink/70">Insumo</span>
                <input name="name" required className={fieldClass} />
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className={labelClass}>
                  <span className="text-ink/70">Unidad</span>
                  <input name="unit" defaultValue="unidad" className={fieldClass} />
                </label>
                <label className={labelClass}>
                  <span className="text-ink/70">Consumo</span>
                  <input type="number" name="consumedPerCleaning" defaultValue={0} min={0} className={fieldClass} />
                </label>
                <label className={labelClass}>
                  <span className="text-ink/70">Stock</span>
                  <input type="number" name="qty" defaultValue={0} min={0} className={fieldClass} />
                </label>
                <label className={labelClass}>
                  <span className="text-ink/70">Mínimo</span>
                  <input type="number" name="lowThreshold" defaultValue={0} min={0} className={fieldClass} />
                </label>
              </div>
            </ActionForm>
          </div>
        </details>
      </Section>
    </div>
  );
}
