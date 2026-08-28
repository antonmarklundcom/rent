/**
 * Plain HTML render of an owner statement (#3, plan §5.O7).
 *
 * Deliberately unstyled beyond a handful of inline rules: Window 2 (Sonnet)
 * restyles this into something WhatsApp-shareable and email-ready (plan §6.S3).
 * Self-contained — no CSS file, no fonts, no JS — so it survives being saved,
 * printed, or pasted into an email body.
 */
import type { StatementDetail } from "@/db/queries/statements";
import { formatMoney } from "@/lib/money";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function periodLabel(period: string): string {
  const [year, month] = period.split("-");
  const index = Number(month) - 1;
  return `${MONTHS_ES[index] ?? month} ${year}`;
}

function shortDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The statement as one standalone HTML document. */
export function renderStatementHtml(detail: StatementDetail): string {
  const { statement, owner, bookingLines, expenseLines } = detail;
  const currency = statement.currency;
  const money = (amount: string) => escapeHtml(formatMoney(amount, currency));

  const bookingRows =
    bookingLines.length === 0
      ? `<tr><td colspan="5">Sin reservas completadas en el período.</td></tr>`
      : bookingLines
          .map(
            (line) => `<tr>
  <td>${escapeHtml(line.reference)}</td>
  <td>${escapeHtml(line.listingTitle)}<br><small>${escapeHtml(line.guestName)}</small></td>
  <td>${shortDate(line.startAt)} → ${shortDate(line.endAt)}</td>
  <td class="num">${money(line.gross)}</td>
  <td class="num">− ${money(line.commission)} <small>(${escapeHtml(line.commissionPct)}%)</small></td>
</tr>`,
          )
          .join("\n");

  const expenseRows =
    expenseLines.length === 0
      ? `<tr><td colspan="4">Sin gastos en el período.</td></tr>`
      : expenseLines
          .map(
            (line) => `<tr>
  <td>${escapeHtml(line.incurredOn)}</td>
  <td>${escapeHtml(line.listingTitle)}</td>
  <td>${escapeHtml(line.description ?? line.category)}</td>
  <td class="num">− ${money(line.amount)}</td>
</tr>`,
          )
          .join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Estado de cuenta ${escapeHtml(periodLabel(statement.period))} — ${escapeHtml(owner.displayName)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 46rem; padding: 1.5rem; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
  th, td { border-bottom: 1px solid #ddd; padding: .4rem .3rem; text-align: left; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .totals td { border: none; padding: .25rem .3rem; }
  .totals .net { font-weight: 700; border-top: 2px solid #333; }
  small { color: #666; }
</style>
</head>
<body>
<h1>Estado de cuenta</h1>
<p>
  <strong>${escapeHtml(owner.displayName)}</strong><br>
  ${owner.ruc ? `RUC ${escapeHtml(owner.ruc)}<br>` : ""}
  ${owner.email ? `${escapeHtml(owner.email)}<br>` : ""}
  Período: <strong>${escapeHtml(periodLabel(statement.period))}</strong><br>
  Generado: ${shortDate(statement.generatedAt)}
</p>

<h2>Reservas completadas (${bookingLines.length})</h2>
<table>
  <thead><tr><th>Ref.</th><th>Publicación / huésped</th><th>Fechas</th><th class="num">Bruto</th><th class="num">Comisión</th></tr></thead>
  <tbody>
${bookingRows}
  </tbody>
</table>

<h2>Gastos (${expenseLines.length})</h2>
<table>
  <thead><tr><th>Fecha</th><th>Publicación</th><th>Detalle</th><th class="num">Monto</th></tr></thead>
  <tbody>
${expenseRows}
  </tbody>
</table>

<table class="totals">
  <tr><td>Bruto</td><td class="num">${money(statement.grossTotal)}</td></tr>
  <tr><td>Comisión</td><td class="num">− ${money(statement.commissionTotal)}</td></tr>
  <tr><td>Gastos</td><td class="num">− ${money(statement.expensesTotal)}</td></tr>
  <tr class="net"><td>Neto a liquidar</td><td class="num">${money(statement.netTotal)}</td></tr>
</table>

<p><small>alquilar.com.py — documento generado automáticamente. Ante cualquier diferencia, escribinos antes de la liquidación.</small></p>
</body>
</html>
`;
}
