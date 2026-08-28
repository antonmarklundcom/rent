/**
 * User and owner directory reads for the admin panel (plan §5.O11).
 *
 * Read-only. Creating and editing users is `super_admin` territory (plan §2)
 * and is not part of Window 1's scope — the seed provisions the accounts and
 * §10 Backlog carries user management as a later feature. What this file gives
 * the admin screen is the answer to "who exists and what do they own".
 */
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { listings, owners, users } from "@/db/schema";
import type { Executor } from "@/db/queries/availability";

export async function listUsers(executor: Executor = db) {
  return executor
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      ownerId: owners.id,
      displayName: owners.displayName,
      defaultCommissionPct: owners.defaultCommissionPct,
    })
    .from(users)
    .leftJoin(owners, eq(owners.userId, users.id))
    .orderBy(asc(users.role), asc(users.name));
}

/** Owners with how many listings they hold — the admin owner directory. */
export async function listOwnersWithCounts(executor: Executor = db) {
  return executor
    .select({
      ownerId: owners.id,
      displayName: owners.displayName,
      ruc: owners.ruc,
      defaultCommissionPct: owners.defaultCommissionPct,
      email: users.email,
      listings: sql<number>`COUNT(${listings.id})`,
    })
    .from(owners)
    .innerJoin(users, eq(users.id, owners.userId))
    .leftJoin(listings, eq(listings.ownerId, owners.id))
    .groupBy(owners.id, owners.displayName, owners.ruc, owners.defaultCommissionPct, users.email)
    .orderBy(asc(owners.displayName));
}
