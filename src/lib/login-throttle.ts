/**
 * Límite de intentos de login fallidos POR CUENTA (email normalizado).
 * No usa la IP del cliente: X-Forwarded-For se puede falsificar y detrás de
 * un proxy todos comparten IP. En memoria (un solo proceso Node); los
 * registros vencidos se podan y el tamaño total está acotado.
 */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_KEYS = 10_000;

type Entry = { failures: number; resetAt: number };
const attempts = new Map<string, Entry>();

function prune(now: number): void {
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
  // Tope duro: descarta las entradas más antiguas (orden de inserción).
  while (attempts.size >= MAX_TRACKED_KEYS) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
}

export function loginKey(email: string): string {
  return email.trim().toLowerCase();
}

/** True si la cuenta superó el máximo de fallos dentro de la ventana. */
export function isLoginBlocked(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.resetAt <= now) {
    attempts.delete(key);
    return false;
  }
  return entry.failures >= LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const entry = attempts.get(key);
  if (entry && entry.resetAt > now) {
    entry.failures += 1;
    return;
  }
  prune(now);
  attempts.set(key, { failures: 1, resetAt: now + LOGIN_WINDOW_MS });
}

export function resetLoginFailures(key: string): void {
  attempts.delete(key);
}

/** Solo para pruebas. */
export function trackedLoginKeys(): number {
  return attempts.size;
}
