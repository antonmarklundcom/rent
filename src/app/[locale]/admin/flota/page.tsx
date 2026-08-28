import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  createReminderAction,
  deleteReminderAction,
  updateReminderAction,
} from "@/app/actions/autos";
import { ActionForm } from "@/components/action-form";
import { listDamagedInspections } from "@/db/queries/inspections";
import { listListingsForUser } from "@/db/queries/listings";
import { listDueReminders } from "@/db/queries/reminders";
import { listPendingDocuments } from "@/db/queries/documents";
import { REMINDER_TYPES } from "@/db/schema";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * Fleet care (#14), damage evidence (#5) and the document queue (#16) —
 * plan §5.O8. The one screen that answers "what needs attention on the cars".
 */
export default async function AdminFleetPage() {
  const user = await requireAdminPage();
  const t = await getTranslations("admin");
  const tType = await getTranslations("reminderType");
  const tStatus = await getTranslations("reminderStatus");
  const tDocType = await getTranslations("documentType");

  const [due, listings, damaged, pendingDocs] = await Promise.all([
    listDueReminders({ includeUpcoming: true }),
    listListingsForUser(user),
    listDamagedInspections({ limit: 20 }),
    listPendingDocuments({ limit: 50 }),
  ]);
  const cars = listings.filter((l) => l.vertical === "car");

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">{t("fleet")}</h1>

      <section className="space-y-2">
        <h2 className="font-medium">{t("dueReminders")} (#14)</h2>
        {due.length === 0 ? (
          <p className="text-sm text-neutral-500">No hay recordatorios cargados.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Vehículo</th>
                <th>Tipo</th>
                <th>Vence</th>
                <th>Km</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {due.map(({ reminder, listingTitle, daysLeft, overdue, odometer }) => (
                <tr key={reminder.id} className={`border-b align-top ${overdue ? "bg-red-50" : ""}`}>
                  <td className="py-2">{listingTitle}</td>
                  <td>
                    {tType(reminder.type)}
                    {reminder.label && (
                      <span className="block text-xs text-neutral-500">{reminder.label}</span>
                    )}
                  </td>
                  <td>
                    {reminder.dueDate ?? "—"}
                    {daysLeft !== null && (
                      <span className="block text-xs text-neutral-500">
                        {overdue ? `vencido hace ${-daysLeft} días` : `en ${daysLeft} días`}
                      </span>
                    )}
                  </td>
                  <td>
                    {reminder.dueKm ?? "—"}
                    {odometer !== null && (
                      <span className="block text-xs text-neutral-500">actual: {odometer}</span>
                    )}
                  </td>
                  <td>{tStatus(reminder.status)}</td>
                  <td className="space-y-1">
                    <ActionForm
                      action={updateReminderAction}
                      submitLabel="Marcar hecho"
                      className="space-y-1"
                      submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <input type="hidden" name="reminderId" value={reminder.id} />
                      <input type="hidden" name="status" value="done" />
                    </ActionForm>
                    <ActionForm
                      action={deleteReminderAction}
                      submitLabel="Eliminar"
                      className="space-y-1"
                      submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <input type="hidden" name="reminderId" value={reminder.id} />
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Nuevo recordatorio</h2>
        <ActionForm action={createReminderAction} submitLabel="Crear recordatorio">
          <label className="block space-y-1 text-sm">
            <span>Vehículo</span>
            <select name="listingId" required className="w-full rounded border border-neutral-300 px-2 py-1">
              {cars.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="space-y-1">
              <span>Tipo</span>
              <select name="type" className="w-full rounded border border-neutral-300 px-2 py-1">
                {REMINDER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {tType(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span>Vence</span>
              <input type="date" name="dueDate" className="w-full rounded border border-neutral-300 px-2 py-1" />
            </label>
            <label className="space-y-1">
              <span>o Km</span>
              <input type="number" name="dueKm" min={0} className="w-full rounded border border-neutral-300 px-2 py-1" />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span>Etiqueta</span>
            <input name="label" className="w-full rounded border border-neutral-300 px-2 py-1" />
          </label>
        </ActionForm>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">{t("pendingDocuments")} (#16)</h2>
        {pendingDocs.length === 0 ? (
          <p className="text-sm text-neutral-500">No hay documentos pendientes.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {pendingDocs.map((row) => (
              <li key={row.document.id}>
                <Link
                  href={`/admin/reservas/${row.document.bookingId}`}
                  className="text-blue-700 underline"
                >
                  {row.bookingReference}
                </Link>{" "}
                — {row.listingTitle} · {tDocType(row.document.type)} · {row.guestName}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Inspecciones con daño (#5)</h2>
        {damaged.length === 0 ? (
          <p className="text-sm text-neutral-500">Sin daños registrados.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {damaged.map((row) => (
              <li key={row.inspection.id}>
                <Link
                  href={`/admin/reservas/${row.inspection.bookingId}`}
                  className="text-blue-700 underline"
                >
                  {row.bookingReference}
                </Link>{" "}
                — {row.listingTitle} · {row.inspection.notes ?? "sin notas"}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
