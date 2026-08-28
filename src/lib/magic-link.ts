import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cleaningTasks, listings } from "@/db/schema";
import { randomToken } from "@/lib/tokens";

/**
 * Cleaner access (plan §2): no login at all. A cleaning task carries an opaque
 * token; the tokenized URL IS the credential, so the token is the only thing
 * that may be checked — never a role, never a cookie.
 */
export function newMagicToken(): string {
  return randomToken(24);
}

export type CleanerTaskView = Awaited<ReturnType<typeof resolveMagicToken>>;

export async function resolveMagicToken(token: string) {
  if (!token || token.length < 16) return null;
  const [row] = await db
    .select({
      task: cleaningTasks,
      listingTitle: listings.title,
      listingVertical: listings.vertical,
    })
    .from(cleaningTasks)
    .innerJoin(listings, eq(listings.id, cleaningTasks.listingId))
    .where(eq(cleaningTasks.magicToken, token))
    .limit(1);
  return row ?? null;
}

export function magicLinkUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/tarea/${token}`;
}
