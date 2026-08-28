import "server-only";
import type { UserRole } from "@/db/schema";
import {
  authenticate,
  AuthError,
  assertRole,
  touchLastLogin,
  type SessionUser,
} from "@/lib/auth-core";
import { getSession, getSessionUser } from "@/lib/session";

export {
  ADMIN_ROLES,
  AuthError,
  assertRole,
  buildSessionUser,
  hashPassword,
  isAdmin,
  verifyPassword,
} from "@/lib/auth-core";
export type { SessionUser } from "@/lib/auth-core";

/** Verify credentials and write the session cookie. */
export async function login(email: string, password: string): Promise<SessionUser> {
  const user = await authenticate(email, password);
  const session = await getSession();
  session.user = user;
  await session.save();
  await touchLastLogin(user.id);
  return user;
}

export async function logout(): Promise<void> {
  const session = await getSession();
  session.destroy();
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Iniciá sesión para continuar", "unauthenticated");
  return user;
}

/** Request-scoped role gate — every mutating action/route calls this. */
export async function requireRole(allowed: readonly UserRole[]): Promise<SessionUser> {
  const user = await requireUser();
  assertRole(user, allowed);
  return user;
}
