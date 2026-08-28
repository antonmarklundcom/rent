/**
 * Money helpers. mysql2 hands `decimal` columns back as strings; every amount
 * in this codebase stays a string at rest and is only turned into a number
 * inside these helpers, which round to 2 decimals at each step. Never do
 * arithmetic on money with bare JS floats.
 */
export function toNumber(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  const n = typeof amount === "number" ? amount : Number.parseFloat(amount);
  return Number.isFinite(n) ? n : 0;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Canonical string form for a decimal(14,2) column. */
export function toMoney(n: number | string): string {
  return round2(toNumber(n)).toFixed(2);
}

export function addMoney(...amounts: (string | number)[]): string {
  return toMoney(amounts.reduce<number>((sum, a) => sum + toNumber(a), 0));
}

export function multiplyMoney(amount: string | number, factor: number): string {
  return toMoney(toNumber(amount) * factor);
}

/** `percentOf("100.00", "20.00") === "20.00"` */
export function percentOf(amount: string | number, pct: string | number): string {
  return toMoney((toNumber(amount) * toNumber(pct)) / 100);
}

const FORMATTERS = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: string | number, currency = "PYG"): string {
  const key = currency;
  let fmt = FORMATTERS.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat("es-PY", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "PYG" ? 0 : 2,
    });
    FORMATTERS.set(key, fmt);
  }
  return fmt.format(toNumber(amount));
}
