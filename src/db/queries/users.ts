/**
 * User administration (plan §2 — `super_admin` is the only role that manages
 * users, and the only one that can create another admin).
 *
 * Creating an `owner` also creates its `owners` profile row: a user with role
 * `owner` and no profile has no `owners.id` to put in the session, so every
 * owner-scoped query would refuse them (plan §9, O-1 judgment call 9).
 */
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { listings, owners, users, type UserRole } from "@/db/schema";
import { ensureOnboarding } from "@/db/queries/onboarding";
import type { Executor } from "@/db/queries/availability";
import { hashPassword } from "@/lib/auth-core";
import { DomainError } from "@/lib/errors";

export type UserRow = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  ownerId: number | null;
  listingCount: number;
};

export async function listUsers(executor: Executor = db): Promise<UserRow[]> {
  const rows = await executor
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      ownerId: owners.id,
      listingCount: sql<number>`count(${listings.id})`,
    })
    .from(users)
    .leftJoin(owners, eq(owners.userId, users.id))
    .leftJoin(listings, eq(listings.ownerId, owners.id))
    .groupBy(
      users.id,
      users.name,
      users.email,
      users.phone,
      users.role,
      users.isActive,
      users.lastLoginAt,
      owners.id,
    )
    .orderBy(asc(users.role), asc(users.name));
  return rows.map((row) => ({ ...row, listingCount: Number(row.listingCount) }));
}

export type CreateUserInput = {
  name: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  /** Required for every role except `cleaner`, who never logs in (plan §2). */
  password?: string | null;
  displayName?: string | null;
  defaultCommissionPct?: string | null;
};

export async function createUser(input: CreateUserInput): Promise<number> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new DomainError("El correo no es válido", "invalid_amount");
  }
  if (input.role !== "cleaner" && (input.password ?? "").length < 10) {
    throw new DomainError("La contraseña necesita al menos 10 caracteres", "invalid_amount");
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    throw new DomainError("Ya existe una cuenta con ese correo", "invalid_amount", { email });
  }

  return db.transaction(async (tx) => {
    await tx.insert(users).values({
      name: input.name.trim(),
      email,
      phone: input.phone?.trim() || null,
      role: input.role,
      // A cleaner has no password hash at all — `authenticate` refuses the row
      // outright, so there is nothing to guess.
      passwordHash: input.role === "cleaner" ? null : await hashPassword(input.password!),
    });
    const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!row) throw new DomainError("No se pudo crear el usuario", "not_found");

    if (input.role === "owner") {
      await tx.insert(owners).values({
        userId: row.id,
        displayName: input.displayName?.trim() || input.name.trim(),
        defaultCommissionPct: input.defaultCommissionPct ?? "20.00",
      });
      const [owner] = await tx
        .select({ id: owners.id })
        .from(owners)
        .where(eq(owners.userId, row.id))
        .limit(1);
      if (owner) await ensureOnboarding(owner.id, tx);
    }
    return row.id;
  });
}

/**
 * Deactivate rather than delete: bookings, statements and activity rows point
 * at this id, and a deleted user would leave money history with a dangling
 * author. `is_active = false` blocks login immediately (`authenticate`).
 */
export async function setUserActive(userId: number, isActive: boolean): Promise<void> {
  await db.update(users).set({ isActive }).where(eq(users.id, userId));
}

export async function setUserRole(userId: number, role: UserRole): Promise<void> {
  const [current] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!current) throw new DomainError("El usuario no existe", "not_found", { userId });
  if (role === "owner") {
    const [owner] = await db
      .select({ id: owners.id })
      .from(owners)
      .where(eq(owners.userId, userId))
      .limit(1);
    if (!owner) {
      throw new DomainError(
        "Creá el perfil de propietario primero: un owner sin perfil no puede ver nada.",
        "not_found",
        { userId },
      );
    }
  }
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function setUserPassword(userId: number, password: string): Promise<void> {
  if (password.length < 10) {
    throw new DomainError("La contraseña necesita al menos 10 caracteres", "invalid_amount");
  }
  const [current] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!current) throw new DomainError("El usuario no existe", "not_found", { userId });
  if (current.role === "cleaner") {
    throw new DomainError(
      "Los encargados de limpieza no tienen cuenta: entran por su enlace directo.",
      "invalid_transition",
      { userId },
    );
  }
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
}
