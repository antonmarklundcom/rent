import { getTranslations } from "next-intl/server";
import {
  createExpenseAction,
  createTicketAction,
  updateTicketAction,
  uploadTicketPhotoAction,
} from "@/app/actions/operations";
import { ActionForm } from "@/components/action-form";
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
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">{t("maintenance")}</h1>

      <section className="space-y-2">
        <h2 className="font-medium">Tickets (#6)</h2>
        {tickets.length === 0 ? (
          <p className="text-sm text-neutral-500">No hay tickets.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">#</th>
                <th>Propiedad</th>
                <th>Título</th>
                <th>Costo → gasto</th>
                <th>Estado / costo</th>
                <th>Foto</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((row) => (
                <tr key={row.ticket.id} className="border-b align-top">
                  <td className="py-2">{row.ticket.id}</td>
                  <td>{row.listingTitle}</td>
                  <td>
                    {row.ticket.title}
                    {row.ticket.inspectionId && (
                      <span className="block text-xs text-neutral-500">
                        de la inspección #{row.ticket.inspectionId}
                      </span>
                    )}
                  </td>
                  <td>
                    {row.expenseId ? (
                      <>
                        gasto #{row.expenseId} · {formatMoney(row.expenseAmount ?? 0)}
                        {row.expenseStatementId && (
                          <span className="block text-xs text-neutral-500">
                            facturado en estado #{row.expenseStatementId}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-neutral-500">sin costo</span>
                    )}
                  </td>
                  <td>
                    <ActionForm
                      action={updateTicketAction}
                      submitLabel="Guardar"
                      className="space-y-1"
                      submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <input type="hidden" name="ticketId" value={row.ticket.id} />
                      <select
                        name="status"
                        defaultValue={row.ticket.status}
                        className="w-full rounded border border-neutral-300 px-1 py-1"
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
                        className="w-full rounded border border-neutral-300 px-1 py-1"
                      />
                    </ActionForm>
                  </td>
                  <td>
                    <ActionForm
                      action={uploadTicketPhotoAction}
                      submitLabel="Subir"
                      className="space-y-1"
                      submitClassName="rounded border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <input type="hidden" name="ticketId" value={row.ticket.id} />
                      <input type="file" name="photo" accept={ACCEPT_ATTRIBUTE} required className="w-full text-xs" />
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Nuevo ticket</h2>
        <ActionForm action={createTicketAction} submitLabel="Crear ticket">
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
            <span>Título</span>
            <input name="title" required minLength={3} className="w-full rounded border border-neutral-300 px-2 py-1" />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Descripción</span>
            <textarea name="description" rows={2} className="w-full rounded border border-neutral-300 px-2 py-1" />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Costo (crea el gasto vinculado)</span>
            <input name="cost" inputMode="decimal" className="w-full rounded border border-neutral-300 px-2 py-1" />
          </label>
        </ActionForm>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Gastos (#7)</h2>
        <ul className="text-sm text-neutral-600">
          {totals.map((row) => (
            <li key={row.listingId}>
              {row.listingTitle}: {formatMoney(row.total)} en {row.count} gastos
            </li>
          ))}
        </ul>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Fecha</th>
              <th>Propiedad</th>
              <th>Categoría</th>
              <th>Monto</th>
              <th>Origen</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((row) => (
              <tr key={row.expense.id} className="border-b">
                <td className="py-1">{row.expense.incurredOn}</td>
                <td>{row.listingTitle}</td>
                <td>{tCategory(row.expense.category)}</td>
                <td>{formatMoney(row.expense.amount, row.expense.currency)}</td>
                <td className="text-xs text-neutral-500">
                  {row.ticketTitle
                    ? `ticket: ${row.ticketTitle}`
                    : (row.expense.description ?? "—")}
                  {row.expense.statementId ? ` · estado #${row.expense.statementId}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Nuevo gasto</h2>
        <ActionForm action={createExpenseAction} submitLabel="Registrar gasto">
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
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="space-y-1">
              <span>Categoría</span>
              <select name="category" className="w-full rounded border border-neutral-300 px-2 py-1">
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {tCategory(category)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span>Monto</span>
              <input name="amount" required inputMode="decimal" className="w-full rounded border border-neutral-300 px-2 py-1" />
            </label>
            <label className="space-y-1">
              <span>Fecha</span>
              <input type="date" name="incurredOn" defaultValue={today} required className="w-full rounded border border-neutral-300 px-2 py-1" />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span>Descripción</span>
            <input name="description" className="w-full rounded border border-neutral-300 px-2 py-1" />
          </label>
        </ActionForm>
      </section>
    </section>
  );
}
