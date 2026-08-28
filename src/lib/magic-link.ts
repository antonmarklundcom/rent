import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { cleaningTasks, listings, taskPhotos } from "@/db/schema";
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

/**
 * Everything the cleaner's page renders, in one round trip.
 *
 * Note what is NOT selected: no guest name, no phone, no prices, no other
 * listing. A magic token buys exactly one task's worth of access (plan §2).
 */
export async function resolveMagicTaskView(token: string) {
  const row = await resolveMagicToken(token);
  if (!row) return null;
  const photos = await db
    .select({ id: taskPhotos.id, url: taskPhotos.url, caption: taskPhotos.caption })
    .from(taskPhotos)
    .where(
      and(eq(taskPhotos.subjectType, "cleaning_task"), eq(taskPhotos.subjectId, row.task.id)),
    )
    .orderBy(asc(taskPhotos.id));
  return { ...row, photos };
}

export function magicLinkUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/tarea/${token}`;
}
