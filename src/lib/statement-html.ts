/**
 * Styled HTML render of an owner statement (#3, plan §5.O7, restyled §6.S3).
 *
 * A real financial document: brand header, a totals summary a viewer can read
 * at a glance on a phone (before they scroll to the line items), then the two
 * itemised tables. Self-contained — one inline `<style>` block, no external
 * CSS/fonts/JS, `Georgia`/system-ui fallbacks only (no `next/font`, this is
 * not a Next.js page) — so it survives being saved, printed, or pasted into
 * an email body untouched, and a `@media print` pass keeps a paper copy clean.
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
      ? `<tr><td colspan="5" class="empty">Sin reservas completadas en el período.</td></tr>`
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
      ? `<tr><td colspan="4" class="empty">Sin gastos en el período.</td></tr>`
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
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    margin: 0; padding: 0;
    background: #f2ede4;
    color: #2a1d14;
  }
  .sheet { max-width: 42rem; margin: 0 auto; background: #fffdfa; padding: 2rem 1.75rem 2.5rem; }
  .brand { font-size: 1.05rem; letter-spacing: .02em; }
  .brand b { color: #b4762c; }
  h1 {
    font-family: Georgia, serif; font-style: italic; font-weight: 400;
    font-size: 1.9rem; margin: .75rem 0 0; letter-spacing: -.01em;
  }
  .meta {
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: .85rem; color: #6b5c4c; margin: .35rem 0 1.5rem;
    line-height: 1.6;
  }
  .meta b { color: #2a1d14; }
  .totals-band {
    display: table; width: 100%; border-collapse: separate; border-spacing: 8px 0;
    margin: 0 0 1.75rem;
  }
  .totals-band .cell {
    display: table-cell; width: 25%;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    background: #f7f1e7; border-radius: 8px; padding: .7rem .6rem;
    text-align: left; vertical-align: top;
  }
  .totals-band .cell.net { background: #2a1d14; color: #fbf7f1; }
  .totals-band .label {
    font-size: .68rem; text-transform: uppercase; letter-spacing: .06em;
    color: #8a7a68; display: block; margin-bottom: .2rem;
  }
  .totals-band .cell.net .label { color: #d8c9b6; }
  .totals-band .value { font-family: Georgia, serif; font-size: 1.05rem; white-space: nowrap; }
  h2 {
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: .75rem; text-transform: uppercase; letter-spacing: .08em;
    color: #b4762c; font-weight: 700; margin: 1.75rem 0 .6rem;
    border-bottom: 1px solid #e6dcc9; padding-bottom: .4rem;
  }
  table.lines {
    width: 100%; border-collapse: collapse;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: .82rem;
  }
  table.lines th {
    text-align: left; font-weight: 600; color: #8a7a68;
    font-size: .7rem; text-transform: uppercase; letter-spacing: .03em;
    padding: 0 .4rem .4rem; border-bottom: 1px solid #e6dcc9;
  }
  table.lines td {
    padding: .55rem .4rem; border-bottom: 1px solid #efe8db;
    vertical-align: top;
  }
  table.lines tr:last-child td { border-bottom: none; }
  table.lines .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.lines .empty { color: #9a8c7a; font-style: italic; padding: .75rem .4rem; }
  small { color: #9a8c7a; }
  .totals {
    width: 100%; max-width: 20rem; margin: 1.5rem 0 0 auto; border-collapse: collapse;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: .88rem;
  }
  .totals td { padding: .3rem .3rem; }
  .totals .num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals .net td { font-weight: 700; font-size: 1.05rem; border-top: 2px solid #2a1d14; padding-top: .6rem; }
  .footer {
    margin-top: 2.25rem; padding-top: 1rem; border-top: 1px solid #e6dcc9;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: .72rem; color: #9a8c7a; line-height: 1.6;
  }
  @media (max-width: 480px) {
    .sheet { padding: 1.5rem 1.1rem 2rem; }
    .totals-band { display: block; }
    .totals-band .cell { display: block; width: auto; margin-bottom: 8px; }
    table.lines { font-size: .76rem; }
  }
  @media print {
    body { background: #fff; }
    .sheet { max-width: none; padding: 0; }
    .totals-band .cell.net { background: #2a1d14 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="sheet">
  <p class="brand">alquilar<b>.com.py</b></p>
  <h1>Estado de cuenta</h1>
  <p class="meta">
    <b>${escapeHtml(owner.displayName)}</b><br>
    ${owner.ruc ? `RUC ${escapeHtml(owner.ruc)}<br>` : ""}
    ${owner.email ? `${escapeHtml(owner.email)}<br>` : ""}
    Período <b>${escapeHtml(periodLabel(statement.period))}</b> · generado el ${shortDate(statement.generatedAt)}
  </p>

  <div class="totals-band">
    <div class="cell"><span class="label">Bruto</span><span class="value">${money(statement.grossTotal)}</span></div>
    <div class="cell"><span class="label">Comisión</span><span class="value">− ${money(statement.commissionTotal)}</span></div>
    <div class="cell"><span class="label">Gastos</span><span class="value">− ${money(statement.expensesTotal)}</span></div>
    <div class="cell net"><span class="label">Neto a liquidar</span><span class="value">${money(statement.netTotal)}</span></div>
  </div>

  <h2>Reservas completadas (${bookingLines.length})</h2>
  <table class="lines">
    <thead><tr><th>Ref.</th><th>Publicación / huésped</th><th>Fechas</th><th class="num">Bruto</th><th class="num">Comisión</th></tr></thead>
    <tbody>
${bookingRows}
    </tbody>
  </table>

  <h2>Gastos (${expenseLines.length})</h2>
  <table class="lines">
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

  <p class="footer">alquilar.com.py — documento generado automáticamente. Ante cualquier diferencia, escribinos antes de la liquidación.</p>
</div>
</body>
</html>
`;
}
