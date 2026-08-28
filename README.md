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
| `npm run verify:core` | `scripts/verify-core.ts` — auth, roles, scoping, booking, iCal, money, operations |
| `npm run sync:ical` | Import every active iCal source (#2) — idempotent, cron-ready |
| `npm run statements` | Generate monthly owner statements (#3) — idempotent, cron-ready |
| `npm run messages` | Flip due scheduled messages (#4) — idempotent, cron-ready (`-- --dry` reports without writing) |

### Cron jobs

| Command | Suggested schedule |
|---|---|
| `npm run sync:ical` | hourly |
| `npm run statements` | monthly, on the 1st (defaults to the previous month) |
| `npm run messages` | every 15 minutes |

Both accept arguments: `npm run sync:ical -- 12` syncs only source 12;
`npm run statements -- 2026-07 3` regenerates July 2026 for owner 3. Re-running
either is always safe.

## Public endpoints

| Route | What it serves |
|---|---|
| `/api/ical/<token>.ics` | Per-listing availability feed for Airbnb/Booking/Google. The token is the credential; the feed carries no guest data. |
| `/api/estados/<id>.html` | Owner statement as HTML. Admins see all; an owner sees only their own. |
| `/api/uploads/<folder>/<file>` | Photos attached to cleaning tasks, tickets, inspections and renter documents. The random filename is the credential (see `KNOWN-ISSUES.md`). |
| `POST /api/leads` | Public lead capture. Stores the lead first, then offers it to VenderCRM. Accepts JSON or a form post; `website` is a honeypot. Always answers `{ok:true}` once stored. |

## Operations screens (phase O-3)

| Route | Who | What |
|---|---|---|
| `/tarea/<token>` | cleaner, no login | Checklist, photo upload, `needed → in_progress → ready` |
| `/admin/limpieza` | admin | Day roster, assignment, jobs per cleaner, low stock |
| `/admin/mantenimiento` | admin | Tickets (a cost creates its expense) and expenses |
| `/admin/flota` | admin | Vehicle reminders due soon, damage log, document queue |
| `/admin/reservas/<id>` | admin | Renter documents + gate, handover inspections, deposit, payment links, message sequence |

Photo uploads are written to `UPLOAD_DIR` (default `.uploads/`, git-ignored) and
served back through `/api/uploads/...`. Point it outside the Git working tree in
production, or a deploy will wipe it.

## Public pages (phase O-4)

| Route | What |
|---|---|
| `/` | Both verticals, featured listings, location links |
| `/alojamientos` · `/autos` | Browse with GET filters (`ubicacion`, `tipo`, `huespedes`, `dormitorios`, `asientos`, `min`, `max`, `orden`) |
| `/publicacion/<slug>` | Detail: typed facts, occupied dates, extras, cancellation policy, WhatsApp CTA, booking-request form |

Only `published` listings resolve on the public side — the check lives in
`browseListings` / `getPublicListing`, not in the pages.

## Panel and admin screens (phase O-4)

| Route | Who | What |
|---|---|---|
| `/panel` | owner, admin | Calendar, upcoming bookings, earnings, listings, blocked dates (#15), statements, onboarding |
| `/panel/publicaciones/<id>` | owner, admin | Listing editor, info base (what the AI draft is grounded in), iCal import/export (#2) |
| `/admin` | admin | Today's backlog and the map of every screen |
| `/admin/mensajes` | admin | Outbox: rendered body, wa.me link, mark-sent (#4, #11) |
| `/admin/inbox` | admin | Unified inbox with the inline AI-draft button (#20) |
| `/admin/analitica` | admin | Occupancy, revenue, fleet utilisation, sources, expense ratio (#12) |
| `/admin/propietarios` | admin | Owner onboarding pipeline (#19) |
| `/admin/leads` | admin | Leads and their CRM forward status |
| `/admin/plantillas` | admin | Message templates and when each one fires |
| `/admin/dinero` | admin | Payment links (#8), statement generation (#3), the extras (#10) and promo-code (#18) catalogues |
| `/admin/publicaciones` · `/admin/reservas` · `/admin/usuarios` | admin | Entity lists |

**Nothing sends a message on its own** (plan §1.5). The engine decides what to
say and when it is due; a person taps the wa.me link and marks it sent.

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

Booking `ALQ-SEED08` is a car rental left as an `inquiry` with an unverified
licence — open `/admin/reservas/<its id>` to see the #16 document gate refuse a
confirmation, and the logged admin override that gets past it.

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
src/lib/cleaning.ts    turnover checklist + cleaning status machine — pure
src/lib/documents.ts   the renter-document gate — pure
src/lib/reminders.ts   fleet reminder thresholds — pure
src/lib/uploads.ts     photo storage (server) over uploads-core.ts (pure)
src/lib/messaging.ts   message schedule anchors, rendering, wa.me links — pure
src/lib/ai-draft.ts    the Claude call behind the draft button (server only)
src/lib/vendercrm.ts   VenderCRM forwarding — holds the API key, server only
messages/              es + en dictionaries
scripts/               idempotent jobs (migrate, seed, verify)
```
