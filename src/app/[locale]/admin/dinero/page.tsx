import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import {
  expirePaymentLinksFormAction,
  generateStatementFormAction,
  markPaymentLinkPaidFormAction,
} from "@/app/actions/money";
import { ExpireLinksButton } from "./expire-button";
import { listPaymentLinks } from "@/db/queries/payments";
import { listStatements } from "@/db/queries/statements";
import { listAllExtras, listPromoCodes } from "@/db/queries/extras";
import { listOwnersWithCounts } from "@/db/queries/users";
import { periodOf } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireAdminPage } from "@/lib/page-guards";

/**
 * The money desk (plan §3 group B): deposit payment links (#8), owner
 * statements (#3), and the catalogues the price engine reads — extras (#10)
 * and promo codes (#18).
 *
 * Extras and promo codes are READ-ONLY here. Their arithmetic is proven
 * (`src/lib/pricing.ts`) and they are picked at booking; a CRUD screen for them
 * is not in §5's scope, so it is listed in §10 Backlog rather than half-built.
 */
function lastMonth(): string {
  const now = new Date();
  return periodOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

export default async function AdminMoneyPage() {
  await requireAdminPage();
  const [links, statements, extras, promos, owners] = await Promise.all([
    listPaymentLinks(),
    listStatements(),
    listAllExtras(),
    listPromoCodes(),
    listOwnersWithCounts(),
  ]);

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">Dinero</h1>

      <section className="space-y-2">
        <h2 className="font-medium">Links de pago (#8)</h2>
        <p className="text-sm text-neutral-600">
          v1 registra el link y su estado; no hay integración con la pasarela. Se marca
          pagado a mano cuando entra la transferencia.
        </p>
        <ExpireLinksButton action={expirePaymentLinksFormAction} />
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1">Reserva</th>
              <th>Proveedor</th>
              <th>Monto</th>
              <th>Vence</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {links.map((row) => (
              <tr key={row.paymentLink.id} className="border-b">
                <td className="py-1">
                  <Link
                    href={`/admin/reservas/${row.paymentLink.bookingId}`}
                    className="text-blue-700 underline"
                  >
                    {row.bookingReference}
                  </Link>
                </td>
                <td>
                  {row.paymentLink.url ? (
                    <a href={row.paymentLink.url} rel="noopener" className="text-blue-700 underline">
                      {row.paymentLink.provider}
                    </a>
                  ) : (
                    row.paymentLink.provider
                  )}
                </td>
                <td>{formatMoney(row.paymentLink.amount, row.paymentLink.currency)}</td>
                <td>{row.paymentLink.expiresAt ? row.paymentLink.expiresAt.toISOString().slice(0, 10) : "—"}</td>
                <td>{row.paymentLink.status}</td>
                <td>
                  {row.paymentLink.status === "pending" && (
                    <ActionForm
                      action={markPaymentLinkPaidFormAction}
                      submitLabel="Marcar pagado"
                      className="inline"
                      submitClassName="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
                    >
                      <input type="hidden" name="paymentLinkId" value={row.paymentLink.id} />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {links.length === 0 && (
          <p className="text-sm text-neutral-600">
            Sin links cargados. Se crean desde la reserva.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Estados de cuenta (#3)</h2>
        <ActionForm action={generateStatementFormAction} submitLabel="Generar">
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex flex-col">
              Propietario
              <select name="ownerId" className="border p-1">
                {owners.map((owner) => (
                  <option key={owner.ownerId} value={owner.ownerId}>
                    {owner.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              Período (YYYY-MM)
              <input name="period" defaultValue={lastMonth()} className="border p-1" />
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            Volver a generar el mismo período es seguro: libera lo que ya facturó y lo
            vuelve a calcular, así diez corridas dan el mismo número.
          </p>
        </ActionForm>

        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1">Período</th>
              <th>Propietario</th>
              <th>Bruto</th>
              <th>Comisión</th>
              <th>Gastos</th>
              <th>Neto</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {statements.map((row) => (
              <tr key={row.statement.id} className="border-b">
                <td className="py-1">{row.statement.period}</td>
                <td>{row.ownerName}</td>
                <td>{formatMoney(row.statement.grossTotal, row.statement.currency)}</td>
                <td>{formatMoney(row.statement.commissionTotal, row.statement.currency)}</td>
                <td>{formatMoney(row.statement.expensesTotal, row.statement.currency)}</td>
                <td>{formatMoney(row.statement.netTotal, row.statement.currency)}</td>
                <td>
                  <a
                    href={`/api/estados/${row.statement.id}.html`}
                    className="text-blue-700 underline"
                  >
                    ver
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {statements.length === 0 && (
          <p className="text-sm text-neutral-600">Todavía no se generó ninguno.</p>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <h2 className="font-medium">Extras (#10)</h2>
          <ul className="text-sm">
            {extras.map((extra) => (
              <li key={extra.id} className="border-b py-1">
                {extra.name} — {formatMoney(extra.price)} ·{" "}
                {extra.scope === "vertical" ? `toda la vertical ${extra.vertical}` : "una publicación"}
                {extra.isActive ? "" : " · inactivo"}
              </li>
            ))}
            {extras.length === 0 && <li className="text-neutral-600">Sin extras cargados.</li>}
          </ul>
        </div>
        <div className="space-y-2">
          <h2 className="font-medium">Códigos promocionales (#18)</h2>
          <ul className="text-sm">
            {promos.map((promo) => (
              <li key={promo.id} className="border-b py-1">
                <code>{promo.code}</code> —{" "}
                {promo.discountType === "percent"
                  ? `${promo.discountValue}%`
                  : formatMoney(promo.discountValue)}{" "}
                · usos {promo.usedCount}
                {promo.maxUses ? `/${promo.maxUses}` : ""}
                {promo.validUntil ? ` · hasta ${promo.validUntil.toISOString().slice(0, 10)}` : ""}
                {promo.isActive ? "" : " · inactivo"}
              </li>
            ))}
            {promos.length === 0 && <li className="text-neutral-600">Sin códigos cargados.</li>}
          </ul>
        </div>
      </section>
      <p className="text-xs text-neutral-500">
        Alta y edición de extras y códigos: §10 Backlog. El descuento se aplica sólo sobre
        el total base, nunca sobre los extras.
      </p>
    </section>
  );
}
