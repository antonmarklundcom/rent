/**
 * Phase O-1 verification (plan §5.O12 — extended by every later phase).
 *
 * Proves, against a real database: migrations apply cleanly, the seed produced
 * the documented fixture, login works per role, cleaners can never log in,
 * owner scoping holds (owner A cannot read or touch owner B), and the cleaner
 * magic link resolves.
 *
 *   npm run db:migrate && npm run seed && npm run verify
 */
import "dotenv/config";
import { and, eq, ne, sql } from "drizzle-orm";
import type { RowDataPacket } from "mysql2";
import { closePool, db, getPool } from "../src/db";
import {
  BOOKING_STATUSES,
  bookings,
  cleaningTasks,
  listings,
  owners,
  users,
} from "../src/db/schema";
import {
  assertRole,
  authenticate,
  AuthError,
  buildSessionUser,
} from "../src/lib/auth-core";
import { assertCanAccessListing, listingScope, ownedListingIds } from "../src/lib/scope";
import { resolveMagicToken } from "../src/lib/magic-link";
import { listListingsForUser } from "../src/db/queries/listings";
import { addMoney, percentOf, toMoney } from "../src/lib/money";

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function expectThrows(name: string, fn: () => Promise<unknown>, code?: string) {
  try {
    await fn();
    check(name, false, "expected an error, got none");
  } catch (error) {
    const ok =
      error instanceof AuthError && (code ? error.code === code : true);
    check(name, ok, ok ? "" : `unexpected error: ${String(error)}`);
  }
}

const SEED_PASSWORD = "Alquilar2026!";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env first.");
  }

  console.log("\nMigrations & schema");
  const [tables] = await getPool().query<RowDataPacket[]>(
    "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()",
  );
  const present = new Set(tables.map((row) => String(row.TABLE_NAME)));
  const required = [
    "users", "owners", "locations", "listings", "stay_details", "car_details",
    "listing_images", "info_items", "bookings", "booking_extras", "extras",
    "promo_codes", "availability_blocks", "ical_sources", "cleaning_tasks",
    "task_photos", "maintenance_tickets", "expenses", "supplies", "supply_levels",
    "inspections", "deposits", "vehicle_reminders", "booking_documents",
    "payment_links", "owner_statements", "message_templates", "scheduled_messages",
    "messages", "owner_onboarding", "onboarding_steps", "leads", "activity_log",
  ];
  const missing = required.filter((t) => !present.has(t));
  check(`all ${required.length} schema tables exist`, missing.length === 0, missing.join(", "));
  check(
    "drizzle migration journal applied",
    present.has("__drizzle_migrations"),
    "run `npm run db:migrate`",
  );

  console.log("\nSeed fixture");
  const roleRows = await db
    .select({ role: users.role, value: sql<number>`count(*)` })
    .from(users)
    .groupBy(users.role);
  const byRole = Object.fromEntries(roleRows.map((r) => [r.role, Number(r.value)]));
  check("1 super_admin seeded", byRole.super_admin === 1, JSON.stringify(byRole));
  check("1 admin seeded", byRole.admin === 1, JSON.stringify(byRole));
  check("2 owners seeded", byRole.owner === 2, JSON.stringify(byRole));
  check("1 cleaner seeded", byRole.cleaner === 1, JSON.stringify(byRole));

  const [ownerAUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, "marta@example.com"))
    .limit(1);
  const [ownerBUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, "rodrigo@example.com"))
    .limit(1);
  check("owner A + owner B present", Boolean(ownerAUser && ownerBUser));

  const [ownerA] = await db
    .select()
    .from(owners)
    .where(eq(owners.userId, ownerAUser!.id))
    .limit(1);
  const [ownerB] = await db
    .select()
    .from(owners)
    .where(eq(owners.userId, ownerBUser!.id))
    .limit(1);

  const ownerAVerticals = await db
    .select({ vertical: listings.vertical })
    .from(listings)
    .where(eq(listings.ownerId, ownerA!.id))
    .groupBy(listings.vertical);
  check(
    "owner A owns BOTH a stay and a car (dual ownership, one account)",
    ownerAVerticals.length === 2,
    ownerAVerticals.map((v) => v.vertical).join("/"),
  );

  const [{ value: stayCount }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(listings)
    .where(eq(listings.vertical, "stay"));
  const [{ value: carCount }] = await db
    .select({ value: sql<number>`count(*)` })
    .from(listings)
    .where(eq(listings.vertical, "car"));
  check("≥8 stays seeded", Number(stayCount) >= 8, `got ${stayCount}`);
  check("≥6 cars seeded", Number(carCount) >= 6, `got ${carCount}`);

  const bookingStatuses = await db
    .select({ status: bookings.status })
    .from(bookings)
    .groupBy(bookings.status);
  const statuses = new Set(bookingStatuses.map((r) => r.status));
  check(
    "bookings exist in all five states",
    BOOKING_STATUSES.every((s) => statuses.has(s)),
    [...statuses].join(","),
  );

  console.log("\nLogin");
  const adminUser = await authenticate("ops@alquilar.com.py", SEED_PASSWORD);
  check("admin logs in", adminUser.role === "admin");
  const ownerSession = await authenticate("marta@example.com", SEED_PASSWORD);
  check(
    "owner logs in and carries owners.id in the session",
    ownerSession.role === "owner" && ownerSession.ownerId === ownerA!.id,
  );
  await expectThrows(
    "wrong password is rejected",
    () => authenticate("marta@example.com", "not-the-password"),
    "invalid_credentials",
  );
  await expectThrows(
    "unknown email is rejected",
    () => authenticate("nobody@example.com", SEED_PASSWORD),
    "invalid_credentials",
  );
  await expectThrows(
    "cleaner can never log in (magic links only)",
    () => authenticate("sofia.limpieza@example.com", SEED_PASSWORD),
    "invalid_credentials",
  );

  console.log("\nRole gate");
  check(
    "assertRole allows an admin through an admin-only gate",
    (() => {
      try {
        assertRole(adminUser, ["super_admin", "admin"]);
        return true;
      } catch {
        return false;
      }
    })(),
  );
  check(
    "assertRole blocks an owner from an admin-only gate",
    (() => {
      try {
        assertRole(ownerSession, ["super_admin", "admin"]);
        return false;
      } catch (error) {
        return error instanceof AuthError && error.code === "forbidden";
      }
    })(),
  );
  check(
    "assertRole blocks an anonymous visitor",
    (() => {
      try {
        assertRole(null, ["owner"]);
        return false;
      } catch (error) {
        return error instanceof AuthError && error.code === "unauthenticated";
      }
    })(),
  );

  console.log("\nOwner scoping — owner A must never see owner B");
  const ownerBSession = await buildSessionUser(ownerBUser!.id);
  const aRows = await listListingsForUser(ownerSession);
  const bRows = await listListingsForUser(ownerBSession!);
  check("owner A sees only own listings", aRows.every((r) => r.ownerId === ownerA!.id));
  check("owner B sees only own listings", bRows.every((r) => r.ownerId === ownerB!.id));
  check(
    "owner A's and owner B's listing sets are disjoint",
    aRows.every((r) => !bRows.some((o) => o.id === r.id)) && aRows.length > 0 && bRows.length > 0,
  );

  const adminRows = await listListingsForUser(adminUser);
  check(
    "admin sees every listing",
    adminRows.length === aRows.length + bRows.length,
    `${adminRows.length} vs ${aRows.length}+${bRows.length}`,
  );

  const [foreignListing] = await db
    .select()
    .from(listings)
    .where(and(eq(listings.ownerId, ownerB!.id), ne(listings.ownerId, ownerA!.id)))
    .limit(1);
  await expectThrows(
    "owner A cannot access one of owner B's listings",
    () => assertCanAccessListing(ownerSession, foreignListing!.id),
    "forbidden",
  );
  check(
    "owner A can access their own listing",
    await assertCanAccessListing(ownerSession, aRows[0]!.id).then(
      () => true,
      () => false,
    ),
  );
  const scopedIds = await ownedListingIds(ownerSession);
  check(
    "ownedListingIds excludes foreign listings",
    !scopedIds.includes(foreignListing!.id) && scopedIds.length === aRows.length,
  );
  check(
    "listingScope returns an unfiltered clause for admins",
    listingScope(adminUser) === undefined,
  );

  console.log("\nCleaner magic link");
  const [task] = await db.select().from(cleaningTasks).limit(1);
  const resolved = await resolveMagicToken(task!.magicToken);
  check("valid magic token resolves to its task", resolved?.task.id === task!.id);
  check("unknown magic token resolves to null", (await resolveMagicToken("x".repeat(24))) === null);
  check("empty magic token resolves to null", (await resolveMagicToken("")) === null);

  console.log("\nMoney helpers (foundation for the O-2 commission engine)");
  check("addMoney is exact on decimal strings", addMoney("0.10", "0.20") === "0.30");
  check("percentOf computes commission", percentOf("650000.00", "20.00") === "130000.00");
  check("toMoney normalises to 2 decimals", toMoney(1234.5) === "1234.50");

  console.log(
    `\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}\n`,
  );
  if (failures) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
