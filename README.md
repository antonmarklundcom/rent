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
| `npm run verify:core` | `scripts/verify-core.ts` — auth, roles, scoping, booking, iCal, money, operations, comms, analytics, leads |
| `npm run sync:ical` | Import every active iCal source (#2) — idempotent, cron-ready |
| `npm run statements` | Generate monthly owner statements (#3) — idempotent, cron-ready |
| `npm run messages` | Flip due scheduled messages into the admin outbox (#4) — idempotent, cron-ready. `-- --dry` reports without changing anything |

### Cron jobs

| Command | Suggested schedule |
|---|---|
| `npm run sync:ical` | hourly |
| `npm run messages` | every 15 minutes |
| `npm run statements` | monthly, on the 1st (defaults to the previous month) |

**Nothing sends a message to a guest.** `npm run messages` only moves a queued
message from `scheduled` to `due`, which is what puts it in the admin outbox
with a one-tap WhatsApp link. Sending is a person tapping that link (plan §1.5).

Both accept arguments: `npm run sync:ical -- 12` syncs only source 12;
`npm run statements -- 2026-07 3` regenerates July 2026 for owner 3. Re-running
either is always safe.

## Public endpoints

| Route | What it serves |
|---|---|
| `/api/ical/<token>.ics` | Per-listing availability feed for Airbnb/Booking/Google. The token is the credential; the feed carries no guest data. |
| `/api/estados/<id>.html` | Owner statement as HTML. Admins see all; an owner sees only their own. |
| `/api/uploads/<folder>/<file>` | Photos attached to cleaning tasks, tickets, inspections and renter documents. The random filename is the credential (see `KNOWN-ISSUES.md`). |
| `POST /api/leads` | Public lead capture. Stored locally first, then forwarded to VenderCRM; a CRM outage never loses a lead. Honeypot field `website`, 10 requests/minute per IP. |

## Route map

Spanish URLs, `es` unprefixed, English under `/en/...`.

### Public

| Route | What |
|---|---|
| `/` | Home — both verticals, live listings, location links |
| `/alojamientos` · `/autos` | Browse with filters (ubicación, tipo, precio, huéspedes/asientos) |
| `/alojamiento/<slug>` · `/auto/<slug>` | Listing detail: typed facts, occupied dates, booking request, enquiry form |
| `/contacto` | Contact form → lead |
| `/ingresar` | Login (owners, admins; cleaners never log in) |

`/alojamientos/<ciudad>` and `/autos/<ciudad>` are deliberately **unused** —
they are reserved for phase S-2's location landing pages, which is why listing
detail lives on the singular route.

### Owner panel

| Route | What |
|---|---|
| `/panel` | Earnings (30 days), upcoming bookings, listings, onboarding progress |
| `/panel/publicaciones` · `/panel/publicaciones/<id>` | Own-listing CRUD, info base, iCal export link |
| `/panel/calendario` | Occupied dates and owner blocked dates (#15) |
| `/panel/informacion` | Info base — what the AI draft is allowed to say |
| `/panel/estados` | Owner statements (#3) |

### Admin

| Route | What |
|---|---|
| `/admin` | Index — one link per entity, with what needs doing |
| `/admin/reservas` · `/admin/reservas/<id>` | All bookings + manual booking · one booking: state machine, extras, payments (#8), deposit (#9), documents (#16), inspections (#5), message queue |
| `/admin/publicaciones` | Every listing; publishing is admin-only |
| `/admin/precios` | Extras (#10) and promo codes (#18) |
| `/admin/mensajes` · `/admin/mensajes/<hilo>` · `/admin/mensajes/plantillas` | Outbox + unified inbox (#20) · one conversation with the AI draft box · message templates (#4, #11) |
| `/admin/consultas` | Leads and their VenderCRM forward status |
| `/admin/propietarios` | Owner onboarding checklist (#19) |
| `/admin/dinero` | Payment links and statement generation |
| `/admin/analitica` | Occupancy, revenue, fleet, locations, sources, expense ratio (#12) |
| `/admin/limpieza` · `/admin/mantenimiento` · `/admin/flota` | Cleaning roster · tickets and expenses · fleet reminders |
| `/admin/usuarios` | User management — `super_admin` only |
| `/tarea/<token>` | Cleaner task page — no login, the token is the credential |

Photo uploads are written to `UPLOAD_DIR` (default `.uploads/`, git-ignored) and
served back through `/api/uploads/...`. Point it outside the Git working tree in
production, or a deploy will wipe it.

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

The seed also queues the es-PY message sequence for the confirmed bookings and
runs the processor once, so `/admin/mensajes` has a populated outbox on a fresh
install, and `/admin/mensajes/b<id>` has a conversation to answer.

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
src/lib/messaging.ts   message sequence, template rendering, wa.me links — pure
src/lib/ai-drafts.ts   Claude API reply drafting; degrades without a key
src/lib/vendercrm.ts   lead forwarding; never throws at its caller
src/lib/site-url.ts    the public base URL, in one place
messages/              es + en dictionaries
scripts/               idempotent jobs (migrate, seed, verify)
```
