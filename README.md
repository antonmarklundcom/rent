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
| `npm run verify` | `scripts/verify-core.ts` — foundation verification |

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
messages/              es + en dictionaries
scripts/               idempotent jobs (migrate, seed, verify)
```
