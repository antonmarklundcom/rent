/**
 * Auth primitives with NO Next.js dependency, so scripts (`scripts/verify-core.ts`,
 * cron jobs) can exercise exactly the same code paths the app uses.
 * Cookie/session handling lives in `src/lib/auth.ts`, which wraps this.
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { owners, users, type UserRole } from "@/db/schema";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: "unauthenticated" | "forbidden" | "invalid_credentials",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  /** `owners.id` for role `owner` — what every owner-scoped query filters on. */
  ownerId?: number;
};

export const BCRYPT_ROUNDS = 10;
export const ADMIN_ROLES = ["super_admin", "admin"] as const;

/** Cost-matched dummy hash so a missing user takes the same time as a wrong password. */
const DUMMY_HASH = "$2a$10$C6UzMDM.H6dfI/f/IKcEe.7Nn.pV5cDp2xk8Bc9K3sB7GJ7d1QfFy";

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function isAdmin(user: Pick<SessionUser, "role">): boolean {
  return user.role === "super_admin" || user.role === "admin";
}

/**
 * The single server-side permission gate (plan §2). Hiding a button is a UX
 * nicety; this is the security boundary.
 */
export function assertRole(
  user: SessionUser | null | undefined,
  allowed: readonly UserRole[],
): asserts user is SessionUser {
  if (!user) throw new AuthError("Iniciá sesión para continuar", "unauthenticated");
  if (!allowed.includes(user.role)) {
    throw new AuthError("No tenés permiso para esta acción", "forbidden");
  }
}

/** Session payload for a user row; owners carry their `owners.id`. */
export async function buildSessionUser(userId: number): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      ownerId: owners.id,
    })
    .from(users)
    .leftJoin(owners, eq(owners.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row || !row.isActive) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    ownerId: row.ownerId ?? undefined,
  };
}

/**
 * Verify credentials. Cleaners have no password hash and can never log in
 * (plan §2) — they only ever reach work through magic links.
 */
export async function authenticate(
  email: string,
  password: string,
): Promise<SessionUser> {
  const normalised = email.trim().toLowerCase();
  const [row] = await db.select().from(users).where(eq(users.email, normalised)).limit(1);

  const invalid = new AuthError("Email o contraseña incorrectos", "invalid_credentials");
  if (!row || !row.isActive || !row.passwordHash || row.role === "cleaner") {
    await bcrypt.compare(password, DUMMY_HASH);
    throw invalid;
  }
  if (!(await verifyPassword(password, row.passwordHash))) throw invalid;

  const sessionUser = await buildSessionUser(row.id);
  if (!sessionUser) throw invalid;
  return sessionUser;
}

export async function touchLastLogin(userId: number): Promise<void> {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}
