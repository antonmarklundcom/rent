import { getTranslations } from "next-intl/server";
import {
  createExpenseAction,
  createTicketAction,
  updateTicketAction,
  uploadTicketPhotoAction,
} from "@/app/actions/operations";
import { ActionForm } from "@/components/action-form";
import { fieldClass, labelClass } from "@/components/ui/field";
import { PageHeader, Section, TableWrap, EmptyState, table, th, td } from "@/components/ui/page-header";
import { expenseTotalsByListing, listExpenses } from "@/db/queries/expenses";
import { listListingsForUser } from "@/db/queries/listings";
import { listTickets } from "@/db/queries/maintenance";
import { EXPENSE_CATEGORIES, TICKET_STATUSES } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { requireAdminPage } from "@/lib/page-guards";
import { ACCEPT_ATTRIBUTE } from "@/lib/uploads";

/**
 * Maintenance tickets (#6) and per-listing expenses (#7) — plan §5.O6.
 *
 * The link between them is the point of this screen: a ticket's cost IS an
 * expense row, created in the same transaction, and the table shows which
 * expense a ticket produced and whether it has already been billed on an
 * owner statement.
 */
export default async function AdminMaintenancePage() {
  const user = await requireAdminPage();
  const t = await getTranslations("admin");
  const tTicket = await getTranslations("ticketStatus");
  const tCategory = await getTranslations("expenseCategory");

  const [tickets, listings, expenses, totals] = await Promise.all([
    listTickets(),
    listListingsForUser(user),
    listExpenses({ limit: 50 }),
    expenseTotalsByListing(),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-8">
      <PageHeader title={t("maintenance")} />

      <Section title="Tickets (#6)">
        {tickets.length === 0 ? (
          <EmptyState>No hay tickets.</EmptyState>
        ) : (
          <TableWrap>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Propiedad</th>
                  <th className={th}>Título</th>
                  <th className={th}>Costo → gasto</th>
                  <th className={th}>Estado / costo</th>
                  <th className={th}>Foto</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((row) => (
                  <tr key={row.ticket.id}>
                    <td className={td}>{row.ticket.id}</td>
                    <td className={td}>{row.listingTitle}</td>
                    <td className={td}>
                      {row.ticket.title}
                      {row.ticket.inspectionId && (
                        <span className="block text-xs text-ink/50">
                          de la inspección #{row.ticket.inspectionId}
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      {row.expenseId ? (
                        <>
                          gasto #{row.expenseId} · {formatMoney(row.expenseAmount ?? 0)}
                          {row.expenseStatementId && (
                            <span className="block text-xs text-ink/50">
                              facturado en estado #{row.expenseStatementId}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-ink/45">sin costo</span>
                      )}
                    </td>
                    <td className={td}>
                      <ActionForm
                        action={updateTicketAction}
                        submitLabel="Guardar"
                        className="space-y-1"
                        submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-ink/40 disabled:opacity-50"
                      >
                        <input type="hidden" name="ticketId" value={row.ticket.id} />
                        <select
                          name="status"
                          defaultValue={row.ticket.status}
                          className="w-full rounded-sm border border-ink/15 px-1.5 py-1 text-xs"
                        >
                          {TICKET_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {tTicket(status)}
                            </option>
                          ))}
                        </select>
                        <input
                          name="cost"
                          defaultValue={row.ticket.cost ?? ""}
                          placeholder="costo"
                          className="w-full rounded-sm border border-ink/15 px-1.5 py-1 text-xs"
                        />
                      </ActionForm>
                    </td>
                    <td className={td}>
                      <ActionForm
                        action={uploadTicketPhotoAction}
                        submitLabel="Subir"
                        className="space-y-1"
                        submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-ink/40 disabled:opacity-50"
                      >
                        <input type="hidden" name="ticketId" value={row.ticket.id} />
                        <input type="file" name="photo" accept={ACCEPT_ATTRIBUTE} required className="w-full text-xs" />
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Nuevo ticket">
        <ActionForm action={createTicketAction} submitLabel="Crear ticket">
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
            <span className="text-ink/70">Título</span>
            <input name="title" required minLength={3} className={fieldClass} />
          </label>
          <label className={labelClass}>
            <span className="text-ink/70">Descripción</span>
            <textarea name="description" rows={2} className={fieldClass} />
          </label>
          <label className={labelClass}>
            <span className="text-ink/70">Costo (crea el gasto vinculado)</span>
            <input name="cost" inputMode="decimal" className={fieldClass} />
          </label>
        </ActionForm>
      </Section>

      <Section title="Gastos (#7)">
        <ul className="grid gap-2 text-sm text-ink/60 sm:grid-cols-2">
          {totals.map((row) => (
            <li key={row.listingId} className="rounded-md border border-ink/10 px-3 py-2">
              <span className="font-medium text-ink">{row.listingTitle}</span>: {formatMoney(row.total)} en{" "}
              {row.count} gastos
            </li>
          ))}
        </ul>
        <TableWrap>
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Fecha</th>
                <th className={th}>Propiedad</th>
                <th className={th}>Categoría</th>
                <th className={th}>Monto</th>
                <th className={th}>Origen</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((row) => (
                <tr key={row.expense.id}>
                  <td className={td}>{row.expense.incurredOn}</td>
                  <td className={td}>{row.listingTitle}</td>
                  <td className={td}>{tCategory(row.expense.category)}</td>
                  <td className={`${td} tabular-nums`}>{formatMoney(row.expense.amount, row.expense.currency)}</td>
                  <td className={`${td} text-xs text-ink/50`}>
                    {row.ticketTitle ? `ticket: ${row.ticketTitle}` : (row.expense.description ?? "—")}
                    {row.expense.statementId ? ` · estado #${row.expense.statementId}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section title="Nuevo gasto">
        <ActionForm action={createExpenseAction} submitLabel="Registrar gasto">
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
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              <span className="text-ink/70">Categoría</span>
              <select name="category" className={fieldClass}>
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {tCategory(category)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className="text-ink/70">Monto</span>
              <input name="amount" required inputMode="decimal" className={fieldClass} />
            </label>
            <label className={labelClass}>
              <span className="text-ink/70">Fecha</span>
              <input type="date" name="incurredOn" defaultValue={today} required className={fieldClass} />
            </label>
          </div>
          <label className={labelClass}>
            <span className="text-ink/70">Descripción</span>
            <input name="description" className={fieldClass} />
          </label>
        </ActionForm>
      </Section>
    </div>
  );
}
