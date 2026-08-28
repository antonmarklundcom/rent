import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  createReminderAction,
  deleteReminderAction,
  updateReminderAction,
} from "@/app/actions/autos";
import { ActionForm } from "@/components/action-form";
import { Badge, reminderStatusTone } from "@/components/ui/badge";
import { fieldClass, labelClass } from "@/components/ui/field";
import { EmptyState, PageHeader, Section, TableWrap, table, th, td } from "@/components/ui/page-header";
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
    <div className="space-y-8">
      <PageHeader title={t("fleet")} />

      <Section title={`${t("dueReminders")} (#14)`}>
        {due.length === 0 ? (
          <EmptyState>No hay recordatorios cargados.</EmptyState>
        ) : (
          <TableWrap>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Vehículo</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Vence</th>
                  <th className={th}>Km</th>
                  <th className={th}>Estado</th>
                  <th className={th}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {due.map(({ reminder, listingTitle, daysLeft, overdue, odometer }) => (
                  <tr key={reminder.id} className={overdue ? "bg-red-50/60" : ""}>
                    <td className={`${td} font-medium`}>{listingTitle}</td>
                    <td className={td}>
                      {tType(reminder.type)}
                      {reminder.label && <span className="block text-xs text-ink/50">{reminder.label}</span>}
                    </td>
                    <td className={td}>
                      {reminder.dueDate ?? "—"}
                      {daysLeft !== null && (
                        <span className="block text-xs text-ink/50">
                          {overdue ? `vencido hace ${-daysLeft} días` : `en ${daysLeft} días`}
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      {reminder.dueKm ?? "—"}
                      {odometer !== null && <span className="block text-xs text-ink/50">actual: {odometer}</span>}
                    </td>
                    <td className={td}>
                      <Badge tone={reminderStatusTone(reminder.status)}>{tStatus(reminder.status)}</Badge>
                    </td>
                    <td className={`${td} space-y-1`}>
                      <ActionForm
                        action={updateReminderAction}
                        submitLabel="Marcar hecho"
                        className="space-y-1"
                        submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50"
                      >
                        <input type="hidden" name="reminderId" value={reminder.id} />
                        <input type="hidden" name="status" value="done" />
                      </ActionForm>
                      <ActionForm
                        action={deleteReminderAction}
                        submitLabel="Eliminar"
                        className="space-y-1"
                        submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                      >
                        <input type="hidden" name="reminderId" value={reminder.id} />
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Nuevo recordatorio">
        <ActionForm action={createReminderAction} submitLabel="Crear recordatorio">
          <label className={labelClass}>
            <span className="text-ink/70">Vehículo</span>
            <select name="listingId" required className={fieldClass}>
              {cars.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              <span className="text-ink/70">Tipo</span>
              <select name="type" className={fieldClass}>
                {REMINDER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {tType(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className="text-ink/70">Vence</span>
              <input type="date" name="dueDate" className={fieldClass} />
            </label>
            <label className={labelClass}>
              <span className="text-ink/70">o Km</span>
              <input type="number" name="dueKm" min={0} className={fieldClass} />
            </label>
          </div>
          <label className={labelClass}>
            <span className="text-ink/70">Etiqueta</span>
            <input name="label" className={fieldClass} />
          </label>
        </ActionForm>
      </Section>

      <Section title={`${t("pendingDocuments")} (#16)`}>
        {pendingDocs.length === 0 ? (
          <EmptyState>No hay documentos pendientes.</EmptyState>
        ) : (
          <ul className="divide-y divide-ink/8 text-sm">
            {pendingDocs.map((row) => (
              <li key={row.document.id} className="py-2">
                <Link href={`/admin/reservas/${row.document.bookingId}`} className="font-medium text-accent hover:underline">
                  {row.bookingReference}
                </Link>{" "}
                — {row.listingTitle} · {tDocType(row.document.type)} · {row.guestName}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Inspecciones con daño (#5)">
        {damaged.length === 0 ? (
          <EmptyState>Sin daños registrados.</EmptyState>
        ) : (
          <ul className="divide-y divide-ink/8 text-sm">
            {damaged.map((row) => (
              <li key={row.inspection.id} className="py-2">
                <Link href={`/admin/reservas/${row.inspection.bookingId}`} className="font-medium text-accent hover:underline">
                  {row.bookingReference}
                </Link>{" "}
                — {row.listingTitle} · {row.inspection.notes ?? "sin notas"}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
