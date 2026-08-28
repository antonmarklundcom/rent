import { Link } from "@/i18n/navigation";
import { listStatements, listStatementsForOwner } from "@/db/queries/statements";
import { formatMoney } from "@/lib/money";
import { periodLabel } from "@/lib/statement-html";
import { requirePanelPage } from "@/lib/page-guards";

/** Owner statements list (#3 — plan §5.O10). The HTML itself is O-2's route. */
export default async function PanelStatementsPage() {
  const user = await requirePanelPage();
  // `listStatements` (admin) joins the owner's name, `listStatementsForOwner`
  // does not — normalise the two shapes so the table below has one row type.
  const rows =
    user.role === "owner" && user.ownerId
      ? (await listStatementsForOwner(user.ownerId)).map((statement) => ({
          statement,
          ownerName: null as string | null,
        }))
      : (await listStatements()).map((row) => ({
          statement: row.statement,
          ownerName: row.ownerName as string | null,
        }));

  return (
    <section className="space-y-4">
      <div>
        <Link href="/panel" className="text-sm text-blue-700 underline">
          ← Panel
        </Link>
        <h1 className="text-2xl font-semibold">Liquidaciones</h1>
        <p className="text-sm text-neutral-600">
          Bruto − comisión − gastos = neto. Se generan con{" "}
          <code>npm run statements</code>, una vez por mes.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Todavía no hay liquidaciones generadas.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Período</th>
              <th>Reservas</th>
              <th>Bruto</th>
              <th>Comisión</th>
              <th>Gastos</th>
              <th>Neto</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ statement, ownerName }) => (
              <tr key={statement.id} className="border-b">
                <td className="py-1">
                  {periodLabel(statement.period)}
                  {ownerName && (
                    <span className="block text-xs text-neutral-500">{ownerName}</span>
                  )}
                </td>
                <td>{statement.bookingCount}</td>
                <td>{formatMoney(statement.grossTotal, statement.currency)}</td>
                <td>{formatMoney(statement.commissionTotal, statement.currency)}</td>
                <td>{formatMoney(statement.expensesTotal, statement.currency)}</td>
                <td>
                  <strong>{formatMoney(statement.netTotal, statement.currency)}</strong>
                </td>
                <td>
                  <a
                    href={`/api/estados/${statement.id}.html`}
                    className="text-blue-700 underline"
                  >
                    ver
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
