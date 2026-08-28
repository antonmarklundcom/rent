import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, paymentStatusTone } from "@/components/ui/badge";
import { fieldClass, labelClass } from "@/components/ui/field";
import { EmptyState, PageHeader, Section, TableWrap, table, th, td } from "@/components/ui/page-header";
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
    <div className="space-y-8">
      <PageHeader title="Dinero" />

      <Section
        title="Links de pago (#8)"
        description="v1 registra el link y su estado; no hay integración con la pasarela. Se marca pagado a mano cuando entra la transferencia."
        actions={<ExpireLinksButton action={expirePaymentLinksFormAction} />}
      >
        {links.length === 0 ? (
          <EmptyState>Sin links cargados. Se crean desde la reserva.</EmptyState>
        ) : (
          <TableWrap>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Reserva</th>
                  <th className={th}>Proveedor</th>
                  <th className={th}>Monto</th>
                  <th className={th}>Vence</th>
                  <th className={th}>Estado</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {links.map((row) => (
                  <tr key={row.paymentLink.id}>
                    <td className={td}>
                      <Link href={`/admin/reservas/${row.paymentLink.bookingId}`} className="text-accent hover:underline">
                        {row.bookingReference}
                      </Link>
                    </td>
                    <td className={td}>
                      {row.paymentLink.url ? (
                        <a href={row.paymentLink.url} rel="noopener" className="text-accent hover:underline">
                          {row.paymentLink.provider}
                        </a>
                      ) : (
                        row.paymentLink.provider
                      )}
                    </td>
                    <td className={`${td} tabular-nums`}>{formatMoney(row.paymentLink.amount, row.paymentLink.currency)}</td>
                    <td className={td}>{row.paymentLink.expiresAt ? row.paymentLink.expiresAt.toISOString().slice(0, 10) : "—"}</td>
                    <td className={td}>
                      <Badge tone={paymentStatusTone(row.paymentLink.status)}>{row.paymentLink.status}</Badge>
                    </td>
                    <td className={td}>
                      {row.paymentLink.status === "pending" && (
                        <ActionForm
                          action={markPaymentLinkPaidFormAction}
                          submitLabel="Marcar pagado"
                          className="inline"
                          submitClassName="rounded-sm border border-ink/20 px-2.5 py-1 text-xs hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50"
                        >
                          <input type="hidden" name="paymentLinkId" value={row.paymentLink.id} />
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Estados de cuenta (#3)">
        <ActionForm action={generateStatementFormAction} submitLabel="Generar">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              <span className="text-ink/70">Propietario</span>
              <select name="ownerId" className={fieldClass}>
                {owners.map((owner) => (
                  <option key={owner.ownerId} value={owner.ownerId}>
                    {owner.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className="text-ink/70">Período (YYYY-MM)</span>
              <input name="period" defaultValue={lastMonth()} className={fieldClass} />
            </label>
          </div>
          <p className="text-xs text-ink/50">
            Volver a generar el mismo período es seguro: libera lo que ya facturó y lo vuelve a
            calcular, así diez corridas dan el mismo número.
          </p>
        </ActionForm>

        {statements.length === 0 ? (
          <EmptyState>Todavía no se generó ninguno.</EmptyState>
        ) : (
          <TableWrap>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Período</th>
                  <th className={th}>Propietario</th>
                  <th className={th}>Bruto</th>
                  <th className={th}>Comisión</th>
                  <th className={th}>Gastos</th>
                  <th className={th}>Neto</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {statements.map((row) => (
                  <tr key={row.statement.id}>
                    <td className={`${td} font-medium`}>{row.statement.period}</td>
                    <td className={td}>{row.ownerName}</td>
                    <td className={`${td} tabular-nums`}>{formatMoney(row.statement.grossTotal, row.statement.currency)}</td>
                    <td className={`${td} tabular-nums`}>{formatMoney(row.statement.commissionTotal, row.statement.currency)}</td>
                    <td className={`${td} tabular-nums`}>{formatMoney(row.statement.expensesTotal, row.statement.currency)}</td>
                    <td className={`${td} tabular-nums font-medium`}>{formatMoney(row.statement.netTotal, row.statement.currency)}</td>
                    <td className={td}>
                      <a
                        href={`/api/estados/${row.statement.id}.html`}
                        target="_blank"
                        rel="noopener"
                        className="font-medium text-accent hover:underline"
                      >
                        ver →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Extras (#10)">
          {extras.length === 0 ? (
            <EmptyState>Sin extras cargados.</EmptyState>
          ) : (
            <ul className="divide-y divide-ink/8 text-sm">
              {extras.map((extra) => (
                <li key={extra.id} className="py-2">
                  <span className="font-medium">{extra.name}</span> — {formatMoney(extra.price)} ·{" "}
                  {extra.scope === "vertical" ? `toda la vertical ${extra.vertical}` : "una publicación"}
                  {extra.isActive ? "" : " · inactivo"}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Códigos promocionales (#18)">
          {promos.length === 0 ? (
            <EmptyState>Sin códigos cargados.</EmptyState>
          ) : (
            <ul className="divide-y divide-ink/8 text-sm">
              {promos.map((promo) => (
                <li key={promo.id} className="py-2">
                  <code className="rounded-sm bg-ink/[0.05] px-1.5 py-0.5">{promo.code}</code> —{" "}
                  {promo.discountType === "percent" ? `${promo.discountValue}%` : formatMoney(promo.discountValue)}{" "}
                  · usos {promo.usedCount}
                  {promo.maxUses ? `/${promo.maxUses}` : ""}
                  {promo.validUntil ? ` · hasta ${promo.validUntil.toISOString().slice(0, 10)}` : ""}
                  {promo.isActive ? "" : " · inactivo"}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <p className="text-xs text-ink/50">
        Alta y edición de extras y códigos: §10 Backlog. El descuento se aplica sólo sobre el
        total base, nunca sobre los extras.
      </p>
    </div>
  );
}
