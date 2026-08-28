import { getTranslations } from "next-intl/server";
import {
  adjustSupplyLevelAction,
  advanceCleaningTaskAction,
  assignCleanerAction,
  createCleaningTaskAction,
  setSupplyLevelAction,
} from "@/app/actions/operations";
import { ActionForm } from "@/components/action-form";
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
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">{t("cleaning")}</h1>

      <section className="space-y-2">
        <h2 className="font-medium">
          Roster {day ? `— ${day}` : "— todas las tareas con fecha"}
        </h2>
        <form className="flex items-end gap-2 text-sm">
          <label className="space-y-1">
            <span className="block">Día</span>
            <input
              type="date"
              name="dia"
              defaultValue={day ?? ""}
              className="rounded border border-neutral-300 px-2 py-1"
            />
          </label>
          <button type="submit" className="rounded border border-neutral-400 px-3 py-1">
            Filtrar
          </button>
        </form>

        {roster.length === 0 ? (
          <p className="text-sm text-neutral-500">No hay tareas para ese filtro.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">#</th>
                <th>Propiedad</th>
                <th>Estado</th>
                <th>Para</th>
                <th>Asignada a</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {roster.map(({ task, listingTitle, assigneeName, bookingReference }) => {
                const next = nextCleaningStatus(task.status);
                return (
                  <tr key={task.id} className="border-b align-top">
                    <td className="py-2">{task.id}</td>
                    <td>
                      {listingTitle}
                      {bookingReference && (
                        <span className="block text-xs text-neutral-500">{bookingReference}</span>
                      )}
                      <a
                        href={magicLinkUrl(task.magicToken)}
                        className="block text-xs text-blue-700 underline"
                      >
                        enlace del limpiador
                      </a>
                    </td>
                    <td>{tStatus(task.status)}</td>
                    <td>{task.dueBy ? new Date(task.dueBy).toISOString().slice(0, 16).replace("T", " ") : "—"}</td>
                    <td>
                      <ActionForm
                        action={assignCleanerAction}
                        submitLabel="Asignar"
                        className="space-y-1"
                        submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                      >
                        <input type="hidden" name="taskId" value={task.id} />
                        <select
                          name="assignedUserId"
                          defaultValue={task.assignedUserId ?? ""}
                          className="rounded border border-neutral-300 px-1 py-1"
                        >
                          <option value="">— sin asignar —</option>
                          {cleaners.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        {assigneeName && (
                          <span className="block text-xs text-neutral-500">{assigneeName}</span>
                        )}
                      </ActionForm>
                    </td>
                    <td>
                      {next ? (
                        <ActionForm
                          action={advanceCleaningTaskAction}
                          submitLabel={`→ ${tStatus(next)}`}
                          className="space-y-1"
                          submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                        >
                          <input type="hidden" name="taskId" value={task.id} />
                          <input type="hidden" name="to" value={next} />
                        </ActionForm>
                      ) : (
                        <span className="text-xs text-neutral-500">completada</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Nueva tarea</h2>
        <ActionForm action={createCleaningTaskAction} submitLabel="Crear tarea">
          <label className="block space-y-1 text-sm">
            <span>Propiedad</span>
            <select name="listingId" required className="w-full rounded border border-neutral-300 px-2 py-1">
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>Asignar a</span>
            <select name="assignedUserId" className="w-full rounded border border-neutral-300 px-2 py-1">
              <option value="">— sin asignar —</option>
              {cleaners.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>Para (fecha y hora)</span>
            <input type="datetime-local" name="dueBy" className="w-full rounded border border-neutral-300 px-2 py-1" />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Notas</span>
            <textarea name="notes" rows={2} className="w-full rounded border border-neutral-300 px-2 py-1" />
          </label>
        </ActionForm>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Trabajos por limpiador (#13)</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Persona</th>
              <th>Completadas</th>
              <th>Abiertas</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((row) => (
              <tr key={row.userId} className="border-b">
                <td className="py-1">{row.name}</td>
                <td>{row.completed}</td>
                <td>{row.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">{t("lowStock")} (#17)</h2>
        {lowStock.length === 0 ? (
          <p className="text-sm text-neutral-500">Todo el stock está por encima del mínimo.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {lowStock.map((row) => (
              <li key={row.levelId} className="flex items-center gap-2">
                <span className="grow">
                  {row.listingTitle} · {row.supplyName}: {row.qty} {row.unit} (mín. {row.lowThreshold})
                </span>
                <ActionForm
                  action={adjustSupplyLevelAction}
                  submitLabel="Reponer"
                  className="flex items-center gap-1"
                  submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                >
                  <input type="hidden" name="levelId" value={row.levelId} />
                  <input
                    type="number"
                    name="delta"
                    defaultValue={12}
                    className="w-16 rounded border border-neutral-300 px-1 py-1"
                  />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}

        <details>
          <summary className="cursor-pointer text-sm">Todo el stock ({levels.length})</summary>
          <ul className="mt-1 space-y-0.5 text-sm text-neutral-600">
            {levels.map((row) => (
              <li key={row.levelId}>
                {row.listingTitle} · {row.supplyName}: {row.qty} {row.unit} · consume{" "}
                {row.perCleaning}/limpieza
              </li>
            ))}
          </ul>
        </details>

        <details>
          <summary className="cursor-pointer text-sm">Cargar o actualizar un insumo</summary>
          <ActionForm action={setSupplyLevelAction} submitLabel="Guardar insumo">
            <label className="block space-y-1 text-sm">
              <span>Propiedad</span>
              <select name="listingId" required className="w-full rounded border border-neutral-300 px-2 py-1">
                {listings.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span>Insumo</span>
              <input name="name" required className="w-full rounded border border-neutral-300 px-2 py-1" />
            </label>
            <div className="grid grid-cols-4 gap-2 text-sm">
              <label className="space-y-1">
                <span>Unidad</span>
                <input name="unit" defaultValue="unidad" className="w-full rounded border border-neutral-300 px-2 py-1" />
              </label>
              <label className="space-y-1">
                <span>Consumo</span>
                <input type="number" name="consumedPerCleaning" defaultValue={0} min={0} className="w-full rounded border border-neutral-300 px-2 py-1" />
              </label>
              <label className="space-y-1">
                <span>Stock</span>
                <input type="number" name="qty" defaultValue={0} min={0} className="w-full rounded border border-neutral-300 px-2 py-1" />
              </label>
              <label className="space-y-1">
                <span>Mínimo</span>
                <input type="number" name="lowThreshold" defaultValue={0} min={0} className="w-full rounded border border-neutral-300 px-2 py-1" />
              </label>
            </div>
          </ActionForm>
        </details>
      </section>
    </section>
  );
}
