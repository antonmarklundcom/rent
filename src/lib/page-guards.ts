import "server-only";
import { redirect } from "next/navigation";
import { isAdmin, type SessionUser } from "@/lib/auth-core";
import { assertCanAccessListing } from "@/lib/scope";
import { getSessionUser } from "@/lib/session";

/**
 * Page-level redirects for the ugly O-3 screens.
 *
 * This is NAVIGATION, not the security boundary — every mutation behind these
 * pages calls `requireRole` in its own server action (plan §2). A page guard
 * only decides what is worth rendering.
 */
export async function requireAdminPage(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/ingresar");
  if (!isAdmin(user)) redirect("/");
  return user;
}

/**
 * The owner panel. Admins are allowed in too — they have to be able to see
 * what an owner sees when something is wrong (the queries scope by role, not
 * by route).
 */
export async function requirePanelPage(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/ingresar");
  if (user.role === "cleaner") redirect("/");
  return user;
}

/**
 * Resolve a listing id a panel page was given, refusing anything the user does
 * not own.
 *
 * A page that reads `?publicacion=<id>` straight from the query string would
 * happily render another owner's calendar or info base, because the READ
 * queries take an id rather than a session. This is the guard that stops that,
 * and every panel page that accepts a listing id calls it.
 */
export async function resolvePanelListingId(
  user: SessionUser,
  requested: string | undefined,
  ownListings: { id: number }[],
): Promise<number | undefined> {
  const fallback = ownListings[0]?.id;
  if (!requested) return fallback;
  const id = Number(requested);
  if (!Number.isSafeInteger(id) || id <= 0) return fallback;
  try {
    await assertCanAccessListing(user, id);
    return id;
  } catch {
    // Not theirs — fall back to their own first listing rather than 500 or leak.
    return fallback;
  }
}
