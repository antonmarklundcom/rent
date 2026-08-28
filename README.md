# alquilar.com.py

Two-vertical rental operations platform for Paraguay: **Alojamientos** (casas,
departamentos, habitaciones) and **Autos**. See [`plan.md`](./plan.md) — it is
the single source of truth for scope, phases and decisions.

Stack: Next.js 15 (App Router, TypeScript, Tailwind) · Drizzle ORM · MySQL ·
iron-session + bcrypt · next-intl (`es` default, `en` under `/en`).

## Local setup

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL + SESSION_SECRET at minimum
npm run db:migrate            # apply drizzle/ migrations
npm run seed                  # idempotent demo data (safe to re-run)
npm run verify                # foundation checks — auth, roles, scoping, schema
npm run dev
```

`.env` is read by Next.js automatically and by the `scripts/` jobs via
`dotenv/config` — tsx does **not** auto-load it, which is why every script
imports `dotenv/config` on its first line.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push the schema straight to a dev database |
| `npm run seed` | Idempotent seed (plan §5.O12) |
| `npm run verify` | Everything below — logic checks, then the database checks |
| `npm run verify:logic` | `scripts/verify-logic.ts` — pure calculators, **no database needed** |
| `npm run verify:core` | `scripts/verify-core.ts` — auth, roles, scoping, booking, iCal, money |
| `npm run sync:ical` | Import every active iCal source (#2) — idempotent, cron-ready |
| `npm run statements` | Generate monthly owner statements (#3) — idempotent, cron-ready |

### Cron jobs

| Command | Suggested schedule |
|---|---|
| `npm run sync:ical` | hourly |
| `npm run statements` | monthly, on the 1st (defaults to the previous month) |

Both accept arguments: `npm run sync:ical -- 12` syncs only source 12;
`npm run statements -- 2026-07 3` regenerates July 2026 for owner 3. Re-running
either is always safe.

## Public endpoints added in phase O-2

| Route | What it serves |
|---|---|
| `/api/ical/<token>.ics` | Per-listing availability feed for Airbnb/Booking/Google. The token is the credential; the feed carries no guest data. |
| `/api/estados/<id>.html` | Owner statement as HTML. Admins see all; an owner sees only their own. |

## Seed logins

Password for every seeded account: `Alquilar2026!`
(the super_admin's comes from `SEED_SUPER_ADMIN_PASSWORD`).

| Role | Email | Notes |
|---|---|---|
| `super_admin` | `admin@alquilar.com.py` | from `SEED_SUPER_ADMIN_EMAIL` |
| `admin` | `ops@alquilar.com.py` | day-to-day ops |
| `owner` | `marta@example.com` | owns a **casa and an auto** — dual vertical |
| `owner` | `rodrigo@example.com` | second owner, used to prove scoping |
| `cleaner` | `sofia.limpieza@example.com` | **cannot log in** — magic links only |

Cleaner task pages live at `/tarea/<magic_token>`; the seed creates the tokens
`seedtoken-limpieza-0001` (ready) and `seedtoken-limpieza-0002` (needed).

## Layout

```
src/app/[locale]/      routes — Spanish names, /en prefix for English
src/components/        shared UI (ugly by design until Window 2)
src/db/schema.ts       the complete schema — never retrofitted
src/db/queries/        every Drizzle query (Window 2 consumes, never writes)
src/lib/auth-core.ts   credentials + role gate, no Next.js dependency
src/lib/auth.ts        cookie/session wrapper around auth-core
src/lib/scope.ts       owner scoping — used by every owner-facing query
src/lib/dates.ts       half-open [start, end) ranges — THE overlap predicate
src/lib/pricing.ts     price, extras, promos, commission — pure, no database
src/lib/booking-state.ts  booking state machine + which states hold the calendar
src/lib/ical.ts        iCal parsing and generation — pure, no network
messages/              es + en dictionaries
scripts/               idempotent jobs (migrate, seed, verify)
```
