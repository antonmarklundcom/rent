import { randomBytes } from "crypto";

/** URL-safe opaque token used for cleaner magic links and iCal export URLs. */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** Human-quotable booking reference, e.g. `ALQ-7F3K9Q`. */
export function bookingReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const raw = randomBytes(6);
  for (const byte of raw) out += alphabet[byte % alphabet.length];
  return `ALQ-${out}`;
}

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 190);
}
