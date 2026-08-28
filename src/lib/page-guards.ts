import "server-only";
import { redirect } from "next/navigation";
import { isAdmin, type SessionUser } from "@/lib/auth-core";
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
