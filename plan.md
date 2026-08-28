# alquilar.com.py — Build Plan (repo: rent)

Two-vertical rental operations platform for Paraguay: **Alojamientos** (short-term stays: casas, departamentos) and **Autos** (vehicle rental). The company operates as middleman/manager for owners — model "(b)-lite": management tool + public lead/booking-capture pages, no payment escrow or marketplace brokering in v1.

**Build format:** two model windows split into **7 phases = 7 prompts = 7 PRs**. **Opus builds phases O-1…O-4 first (entire backend/foundation), then Sonnet builds phases S-1…S-3 (entire frontend/polish/deploy).** Each phase is one fresh session, one prompt file from `prompts/`, and ends with a green build and a **merged PR** before the next phase starts — so a failed phase can never take down more than itself. No phase does work outside this plan — anything extra goes to §10 Backlog.

| Phase | Model | Prompt file | Covers (plan §) |
|---|---|---|---|
| O-1 Foundation | Opus | `prompts/opus-1-foundation.md` | §5 O1–O3 (+ i18n scaffold) |
| O-2 Booking & money | Opus | `prompts/opus-2-booking-money.md` | §5 O4, O5, O7 |
| O-3 Operations & autos | Opus | `prompts/opus-3-operations.md` | §5 O6, O8 |
| O-4 Comms, dashboards, pages | Opus | `prompts/opus-4-comms-pages.md` | §5 O9–O12 + §9 handoff |
| S-1 Public site UI | Sonnet | `prompts/sonnet-1-public-ui.md` | §6 S1, S2, S4 |
| S-2 Panels, SEO, i18n polish | Sonnet | `prompts/sonnet-2-admin-seo.md` | §6 S3, S5 |
| S-3 Deploy & smoke test | Sonnet | `prompts/sonnet-3-deploy.md` | §6 S6, S7 |

---

## 1. Decisions already made (do not re-litigate in build sessions)

1. **Model (b)-lite**: management tool with public pages capturing leads/booking requests. No escrow, no reviews marketplace, no renter accounts. Growing to full marketplace later is additive.
2. **Alojamientos is the lead vertical**; autos ships in the same build but its public side is lead-capture only (browse + WhatsApp/booking inquiry, no online car booking confirmation) until car-liability legal input lands.
3. **One domain, subfolders, ONE Node app**: `alquilar.com.py/alojamientos` + `/autos`. rent.com.py does NOT get its own Hostinger Node slot — it 301-redirects to `alquilar.com.py/autos`, configured at the Hostinger domain level (fallback: Next.js middleware 301 on host header). One English landing page (`/en/rent-car-paraguay`) targets tourist search.
3b. **Language convention**: public URLs and all UI copy in Spanish (es-PY, voseo) as default; code, database identifiers, and role names in English (`bookings`, `super_admin`) — except domain terms that ARE Spanish enum values (`casa`, `departamento`). All user-visible strings go through an i18n layer (next-intl: `es` default with no URL prefix, English under `/en/...`) so languages can be swapped/added without touching logic. v1 ships es fully + en for the public site.
4. **Stack**: Next.js 15 (App Router, TypeScript, Tailwind) + Drizzle ORM + MySQL on Hostinger managed Node.js, per `nodejs-mysql-hostinger-stack` + `nextjs-deploy-hostinger` skills. Sessions: iron-session + bcrypt (no OAuth). Leads → VenderCRM per `vendercrm-lead-capture`.
5. **Out of v1 permanently** (Backlog): Airbnb API/paid PMS, payment escrow, public reviews, renter accounts, WhatsApp Business API auto-send (v1 = wa.me links + copy-paste + manual logging).

---

## 2. Roles & object model (the two structural anchors)

### Roles — `users.role` enum, exactly these four values

| Role | Access |
|---|---|
| `super_admin` | Everything, including user management, commission rates, deleting data, settings. Only role that can create admins. |
| `admin` | Day-to-day ops: all listings, bookings, cleaning/maintenance, messages, reports across both verticals. Cannot manage users or global settings. |
| `owner` | Sees and manages **only rows where `owner_id = self`**: own listings, own bookings/calendar, own earnings/statements, own info-base. Whether they are a "property owner", "car owner", or both is determined by the listings they own — no separate role needed, one account can own both a departamento and an auto. |
| `cleaner` | No dashboard login. Cleaners/staff-on-the-ground get **magic-link task pages** (tokenized URL per task, mobile-first) — zero login friction. A `users` row with role `cleaner` exists only to identify/assign them. |

Every mutating server action/API route calls `requireRole()` server-side; every owner-facing query filters `owner_id` unless role is admin/super_admin. UI hiding is never the security boundary.

### Objects — one shared `listings` table + typed detail tables

- `listings`: id, unique `slug`, `vertical` enum `stay | car`, title, description, price + `price_unit` enum `per_night | per_day | per_month`, currency (PYG default), `location_id`, lat/lng nullable, `status` enum `draft | published | paused`, `published_at`, `owner_id`, `commission_pct` (falls back to owner default), `cancellation_policy` enum `flexible | moderate | strict`, `updated_by`/`updated_at`.
- `stay_details` (1:1 with a stay listing): `property_type` enum **`casa | departamento | habitacion | otro`**, bedrooms, bathrooms, max_guests, area_m2, amenities JSON.
- `car_details` (1:1 with a car listing): `vehicle_type` enum **`auto | camioneta | suv | moto | otro`**, make, model, year, transmission, fuel, seats, plate (private), daily_km_limit, insurance_terms text.

So yes: casa/departamento and cars/vehicles are first-class typed database objects, and everything downstream (bookings, cleaning, inspections, expenses, reports) hangs off `listings.id` regardless of vertical.

---

## 3. Feature set v1 (core + all 20 approved extras)

Core engine: listings CRUD, availability calendar, bookings with state machine, WhatsApp-first messaging log, per-listing info knowledge base with AI-drafted replies (human-approved), owner dashboard, admin panel, SEO location pages, VenderCRM lead forwarding.

Approved extras, grouped by the chain they build on (numbers = the agreed idea list):

**A. Ground operations** — #1 Cleaning & turnover (checkout auto-creates task; magic-link mobile cleaner page; photo checklist; `needed → in_progress → ready`; stay not guest-ready until clean done) · #6 Maintenance ticketing (issues w/ photos, assignment, cost per listing) · #7 Per-listing expense tracking (cleaning/supplies/repairs; feeds net owner reports + business P&L per listing) · #13 Staff scheduling + cleaner job counts (day roster; completed-jobs count per cleaner for payroll) · #17 Inventory & supplies (per-property stock, low-stock alerts tied to cleaning tasks).

**B. Calendar & revenue** — #2 iCal sync (import Airbnb/Booking iCal URLs per listing + export our own feed; cron-able sync script; conflicts block dates) · #3 Commission & owner billing (per-booking commission calc, monthly owner statements = gross − commission − expenses; statement PDF/HTML; FacturaPY-compatible data) · #8 Payment links for deposits (Bancard/QR link stored per booking, status `pending | paid | expired`; manual mark-paid in v1 — no gateway integration, just link + status tracking) · #10 Upsells/extras (per-listing or per-vertical extras: late checkout, transfer, silla de bebé, GPS; picked at booking, priced into totals) · #18 Promo codes + cancellation policies (code with % or fixed discount, validity window, usage cap; policy enum shown at booking).

**C. Autos protection** — #5 Handover/inspection module (pickup + return records: photos, odometer, fuel level, notes, damage flag, guest confirmation) · #9 Security deposit tracking (held/returned/deducted per booking; deductions link to inspection/maintenance records) · #14 Fleet care & document expiry (per-vehicle reminders: service by date/km, insurance, registration/habilitación expiry; admin alert list) · #16 Guest/renter ID verification (document upload — cédula/passport/license — attached to booking, status `pending | verified | rejected`).

**D. Communication & growth** — #4 Automated message sequences (templates + scheduled queue keyed to booking events: confirmed, pre-arrival T-1d, check-in day, checkout day, post-stay; v1 delivery = admin "due now" outbox with one-tap wa.me send + mark-sent) · #11 Review requests → Google (post-checkout scheduled message with the GBP review link; feeds local-pack strategy) · #19 Owner onboarding pipeline (checklist per new owner: contract, photos, info-base filled, iCal connected, first listing published; status visible in admin) · #20 Unified inbox (all message threads across listings/bookings in one admin view, AI-draft button inline).

**E. Insight & control** — #12 Business analytics dashboard (occupancy %, revenue/listing, fleet utilization, top barrios, booking sources, expense ratios — admin-only) · #15 Owner blocked dates (owner blocks own-use dates from panel; blocks behave like bookings in availability).

---

## 4. Autonomy protocol (applies to BOTH windows — copied into both prompts)

1. **Work until 100% of your phase's exit criteria pass.** Do not stop early, do not ask permission for in-plan work.
2. **Git flow — one PR per phase**: create a fresh branch off latest `main` named `phase/<phase-id>` (e.g. `phase/o2-booking-money`), commit in meaningful chunks, push, **create the PR yourself, subscribe to it, and merge it when CI/build is green.** Fix red CI yourself — a red build is your work, always. Never start a phase's work on top of an unmerged previous phase; if the previous phase's PR is unmerged, finishing it comes first.
2b. **Phase exit bar (every phase, in addition to its own criteria)**: `npm run build` green, seed/verify scripts still pass, nothing from earlier phases broken. Each phase leaves `main` in a state the next phase can build on blindly.
3. **Minor, non-blocking issues** (cosmetic bugs, edge cases, nice-to-haves): do NOT stop or ask — log them in `KNOWN-ISSUES.md` with enough detail to fix later, and keep building.
4. **Stop and ask Anton ONLY when** (a) a missing credential/external account blocks progress (DB URL, VenderCRM key, Anthropic key, Hostinger/domain access) and no documented fallback exists, or (b) a decision would create a **bad foundation** — schema shape, auth model, money/commission calculation, booking-conflict logic — where guessing wrong forces a future rewrite. Everything else: pick the reasonable option, write the choice + reasoning into `plan.md` §9 handoff notes, continue.
5. **Missing env values never block the build**: `.env.example` documents everything; code must degrade gracefully (e.g. CRM forward marked `pending` if key absent, AI drafting returns a "configure ANTHROPIC_API_KEY" notice). Local dev uses a seeded local/remote MySQL per the deploy skill.
6. **Resumability**: if the session ends incomplete for any reason, re-running the same prompt must continue, not restart — so before building anything, check what already exists on the branch and continue from the first unmet exit criterion.
7. **Sonnet hard limits (Window 2)**: never modify `src/db/schema.ts`, auth, or booking/commission logic. If a change there seems required, log it in §10 Backlog with a proposed diff and work around it.
8. **Phase handoff — fresh session per phase (AFK mode, preferred)**: a phase is handed off ONLY when four gates pass — (a) its PR is merged green, (b) its exit checklist fully passes, (c) the **pre-handoff audit** is done: re-run build + all verify scripts/tests and re-read your own merged diff adversarially (what would a reviewer reject? what edge case is untested?), fixing findings before handoff — a defect merged now silently poisons every later phase and this is the last cheap moment to catch it; this audit is part of the phase, not overhead — and (d) your §4.9 build-log entry is committed. Then **spawn the NEXT phase as a NEW session** using the claude-code-remote `create_session` tool: inherit the environment, set `model` per the phase table (`claude-opus-5` or `claude-sonnet-5` — this also crosses the Opus→Sonnet switch automatically), `prompt` exactly `Read prompts/<next-file>.md in this repo and execute it.`, and inherit the permission mode (NEVER `plan` — a plan-mode child stalls forever with nobody watching). Spawned sessions and subagents use ONLY the models in the phase table (Opus/Sonnet) — never `claude-fable-5`/Mythos-class models, whose usage is limited and reserved for Anton's own planning conversations; needing Fable is a §4.4 stop-and-ask. Then end your session with your phase report. Fresh sessions keep context minimal (cheaper, faster, cache-friendly) and a usage/context death mid-build costs one phase restart, never a multi-phase reload. **Fallbacks**: if `create_session` is unavailable (e.g. local CLI), continue the next phase in THIS window when it uses the same model; at a model switch, stop and report so Anton starts the next window. **Never hand off** while a §4.4 stop-condition is open or any gate is unmet. If a session dies mid-phase, re-running that phase's prompt in a fresh window resumes safely (§4.6).
9. **Build log (plan.md §9)**: before merging, EVERY phase appends a short dated entry to §9: phase id + PR link, what now exists (routes, tables touched, scripts, key files), decisions/deviations made, and where the next phase should look first. A fresh session orients from plan.md + §9 + `KNOWN-ISSUES.md` ONLY — this log is what makes fresh-session handoffs cheap, so keep entries tight (5–10 lines) and current. Phase O-4 additionally completes the full Window-1 handoff in §9.

---

## 5. Window 1 — OPUS (foundation: schema, logic, functional-but-ugly)

Runs as four phases/PRs (see table in the header): O-1 = O1–O3, O-2 = O4+O5+O7, O-3 = O6+O8, O-4 = O9–O12. Order matters — later steps depend on earlier ones. Exception to phase order within Window 1: the FULL schema (O2) is written in phase O-1 even though most tables are used by later phases — schema is never retrofitted.

### O1. Scaffold
`create-next-app` (App Router, TS, Tailwind); add `drizzle-orm mysql2 drizzle-kit tsx iron-session bcryptjs zod next-intl`. Set up i18n per §1.3b from day one: `es` default (no URL prefix, Spanish public route names like `/alojamientos`, `/autos`, `/panel`), `en` under `/en/...`; all user-visible strings via translation dictionaries even in the ugly functional pages (adding i18n later means touching every page — do it now). `drizzle.config.ts`; `src/db/index.ts` single pool `connectionLimit: 8`, `timezone: "Z"`. Commit `.env.example` documenting every var (DATABASE_URL, SESSION_SECRET, VENDERCRM_API_URL/KEY, ANTHROPIC_API_KEY, NEXT_PUBLIC_SITE_URL, GBP_REVIEW_LINK). `scripts/` for idempotent jobs (`onDuplicateKeyUpdate` on unique keys).

### O2. Full schema — ALL tables now, nothing retrofitted later
§2 tables (users, owners, listings, stay_details, car_details, listing_images, locations) plus, per §3:
- `bookings`: listing_id, guest name/phone/email, start/end (dates for stays, datetimes for cars), status `inquiry | confirmed | active | completed | cancelled`, price snapshot, extras total, discount, source `web | whatsapp | manual`, promo_code_id nullable, notes.
- `availability_blocks`: listing_id, range, reason `owner_use | maintenance | external_ical`, source ref (#15, #2).
- `ical_sources`: listing_id, url, label, last_synced_at, last_status; listings get an `ical_export_token` (#2).
- `cleaning_tasks`: listing_id, booking_id nullable, status `needed | in_progress | ready`, assigned_user_id, due_by, magic token, checklist JSON, completed_at (#1, #13).
- `task_photos`: polymorphic (cleaning task / maintenance ticket / inspection), url, caption (#1, #5, #6).
- `maintenance_tickets`: listing_id, reported_by, description, status `open | in_progress | done`, assigned_user_id, cost nullable (#6).
- `expenses`: listing_id, category `cleaning | supplies | repair | fuel | other`, amount, date, maintenance_ticket_id nullable, created_by (#7).
- `supplies` + `supply_levels`: item, listing_id, qty, low_threshold (#17).
- `inspections`: booking_id, type `pickup | return`, odometer, fuel_level, notes, damage_flag, confirmed_by_guest bool (#5).
- `deposits`: booking_id, amount, status `held | returned | deducted`, deduction_amount, deduction_reason, linked inspection/ticket ids (#9).
- `vehicle_reminders`: listing_id (car), type `service | insurance | registration`, due_date, due_km nullable, status `upcoming | due | done` (#14).
- `booking_documents`: booking_id, type `cedula | passport | license | other`, file url, status `pending | verified | rejected` (#16).
- `extras` + `booking_extras`: name, price, vertical or listing scope; join with qty (#10).
- `promo_codes`: code, discount type/value, valid range, max_uses, used_count (#18).
- `payment_links`: booking_id, provider label, url/reference, amount, status `pending | paid | expired`, marked_paid_by (#8).
- `message_templates` + `scheduled_messages`: template key/body with placeholders; queue rows keyed to booking events with send_after, status `scheduled | due | sent | cancelled` (#4, #11 — review request is just another template/event).
- `messages`: booking_id nullable, listing_id, direction, channel `whatsapp | web`, body, created_at (#20 inbox reads this).
- `info_items`: listing_id, question, answer (AI-draft grounding).
- `owner_statements`: owner_id, period, gross, commission, expenses, net, generated_at, html/pdf ref (#3).
- `owner_onboarding` + `onboarding_steps`: checklist state per owner (#19).
- `leads`: VenderCRM mirror w/ forwarded flag.
- `activity_log`: entity, entity_id, action, user_id, timestamp — money/legal-adjacent mutations write here.

### O3. Auth + roles
iron-session + bcrypt login; `requireRole(session, allowed)`; owner scoping helper used by every owner query; magic-link token auth for cleaner task pages. Seed super_admin from env on first run.

### O4. Booking + availability engine (single source of truth)
Availability = confirmed/active bookings + availability_blocks (incl. iCal-imported). Overlap rejection enforced in the data layer in ONE function used by web requests, admin manual bookings, and iCal import alike. State machine with validated transitions. Price calc = base × units + extras − promo discount; snapshot stored on the booking. **This engine and the commission math are "bad foundation" territory — get them right, test them.**

### O5. iCal sync (#2)
`scripts/sync-ical.ts`: fetch each `ical_sources` URL, upsert `availability_blocks` (source `external_ical`), remove stale ones; runnable manually and cron-ready. Export route `/api/ical/[token].ics` serving our confirmed bookings + blocks. Unit-test date parsing (all-day vs datetime, TZ).

### O6. Ops engine (#1, #6, #7, #13, #17)
Booking completed/checkout ⇒ auto-create cleaning task. Magic-link mobile task page: checklist, photo upload, status advance; listing not bookable-ready until `ready` (stays). Maintenance tickets CRUD + photo + cost ⇒ auto-create linked expense. Day-roster query (tasks by assignee/date) + completed-jobs-per-cleaner count. Supplies decrement hook on task completion + low-stock query.

### O7. Money engine (#3, #8, #9, #10, #18)
Commission calc per completed booking (listing override → owner default). Monthly statement generator `scripts/generate-statements.ts` (gross − commission − expenses = net; idempotent per owner+period; plain HTML render — Sonnet styles it). Payment-link records + manual mark-paid. Deposits lifecycle linked to inspections/tickets. Extras + promo validation inside the O4 price calc.

### O8. Autos protection (#5, #14, #16)
Inspection forms (pickup/return) with photos, odometer, fuel; damage flag can open a maintenance ticket + deposit deduction. Vehicle reminders CRUD + "due soon" admin query. Booking document upload + verification status gate (car booking can't confirm while docs `pending` — admin can override, logged).

### O9. Comms engine (#4, #11, #20 + AI drafts)
Seeded es-PY (voseo) `message_templates` incl. review-request. Booking transitions enqueue `scheduled_messages`; `scripts/process-messages.ts` flips due rows; admin outbox lists due messages with rendered body + wa.me deep link + mark-sent. Unified inbox query (latest thread per booking/listing). AI draft server action: inbound question + listing `info_items` → suggested reply via Claude API (per `claude-api` skill; use current model ids; graceful no-key fallback). Human approves; no auto-send.

### O10. Dashboards + CRM (#12, #15, #19)
Analytics queries: occupancy %, revenue per listing, fleet utilization, top locations, booking sources, expense ratio (data layer + minimal admin page; Sonnet designs it). Owner panel: calendar data, upcoming bookings, earnings, own-listing CRUD, info-base editor, block-dates action, statements list. Onboarding checklist CRUD. `POST /api/leads` store-first → VenderCRM forward (booking inquiries also create leads).

### O11. Functional pages (zero design effort)
Unstyled but working: home, `/alojamientos` + `/autos` browse w/ filters, listing detail w/ availability + booking-request/lead form, owner login + panel, admin (one route per entity, shared table + form components), cleaner task page. Public queries live in `src/db/queries/` — Sonnet never writes Drizzle.

### O12. Verification + exit criteria (Window 1 done when ALL pass)
- `npm run build` green; a `scripts/verify-core.ts` (or test suite) proving: overlap rejection (incl. iCal block), price calc w/ extras+promo, commission math, statement idempotency, role scoping (owner A cannot read/mutate owner B), cleaning task auto-creation, deposit deduction flow.
- Seed: 1 super_admin, 1 admin, 2 owners (one with a casa + an auto — proving dual ownership), 1 cleaner, ~8 stays + ~6 cars across ≥3 locations w/ barrios, bookings in all states, sample tasks/tickets/expenses/templates.
- Every §3 feature reachable end-to-end through the ugly UI.
- §9 handoff notes written; `KNOWN-ISSUES.md` current; PR created and merged green per §4.

---

## 6. Window 2 — SONNET (all UI, SEO, content, imagery, deploy)

Runs as three phases/PRs (see table in the header): S-1 = S1+S2+S4, S-2 = S3+S5, S-3 = S6+S7. Hard limits from §4.7 apply to every Sonnet phase.

### S1. Orientation
Read §9 handoff + `KNOWN-ISSUES.md`, skim schema + `src/db/queries/`. Fix Window-1 known issues only if UI-layer; else leave logged.

### S2. Design system + public site
`web-design-system` conventions, mobile-first (PY traffic is mobile-heavy). Home (dual-vertical hero, featured, location links) · browse pages w/ filter UI per vertical · listing detail (gallery, typed key facts — casa/depto: dormitorios/baños/huéspedes/m²; auto: marca/modelo/año/caja/combustible —, availability calendar, extras picker, WhatsApp CTA + booking-request form, cancellation policy display) · location landing pages `/[vertical]/[ciudad]` + `/[vertical]/[ciudad]/[barrio]` · `/en/rent-car-paraguay` · about/contact · 404.

### S3. Panel + admin + cleaner UI polish
Owner panel: calendar rendering, earnings cards, statements list, block-dates UX, onboarding progress. Admin: all entities styled, analytics dashboard (use `dataviz` skill), unified inbox w/ AI-draft button, outbox w/ wa.me one-tap, due-reminders list, low-stock list. Cleaner magic-link page: big touch targets, camera-friendly photo upload, offline-tolerant basics. Style the owner statement HTML (WhatsApp-shareable/email-ready).

### S4. Imagery
`higgsfield-web-imagery` pipeline for all declared slots (scripted fetch/convert/place; no hand-edited filenames/alt).

### S5. SEO + content + i18n completion
es-PY voseo copy sitewide ("alquilá tu auto…") as default locale; fill the `en` dictionary for the full public site and add a visible language switcher (per §1.3b — no logic changes, dictionaries only). Per-route metadata, OG images, hreflang pairs, sitemap incl. all location pages, robots, JSON-LD (stays: `LodgingBusiness`/`Accommodation`; cars: `Product`/`Vehicle`), canonicals on filtered views. Target keyword-research patterns: "alquileres cerca de mi", "alquiler de departamentos/casas", "alquiler de autos asunción", English "rent car paraguay/asuncion".

### S6. Deploy
`nextjs-deploy-hostinger` §1 + §6a (Git deploy, MySQL init, Remote MySQL whitelist, tsx `.env` gotcha). Env from `.env.example`; migrations + seed on prod DB. Domains: alquilar.com.py primary; rent.com.py → 301 `/autos`. Document cron setup for `sync-ical` / `process-messages` / `generate-statements` (hourly / 15min / monthly) — if Hostinger cron can't be configured from the session, write exact instructions for Anton in `KNOWN-ISSUES.md` instead of stopping.

### S7. Exit criteria (Window 2 done when ALL pass)
Live site green build; real-viewport mobile check; Lighthouse sanity pass; live smoke test (browse both verticals, detail, booking request → lead stored + CRM attempted, owner login scoped, admin login, cleaner magic link, statement render); redirect verified; `KNOWN-ISSUES.md` + §10 Backlog updated; PR created and merged green per §4.

---

## 7. What Anton provides (the ONLY expected human inputs)

Have these ready so neither window stalls: Hostinger MySQL `DATABASE_URL` (+ Remote MySQL whitelist), VenderCRM tenant API key + endpoint URL, `ANTHROPIC_API_KEY`, Hostinger deploy access (Git integration on the account) and domain/DNS control for alquilar.com.py + rent.com.py, GBP review link (can come later — env var). Missing values follow §4.5 (build continues, feature degrades gracefully).

## 8. Still open (business, not build — parked in Backlog)
Car-intermediary legal input (unlocks full autos online booking) · defensive domains alquileres.com.py / rentar.com.py · portfolio overlap check vs residency-services content.

## 9. Build log & handoff (every phase appends before merging — see §4.9)
_Each phase adds a dated entry: phase id + PR, what now exists, decisions/deviations, where the next phase looks first. Phase O-4 additionally writes the full Window-1 handoff: schema deviations from §5.O2 + why, route map, local run instructions, image-upload mechanism chosen, owner publish flow chosen, judgment calls made under §4.4, anything Sonnet must not break._

### Phase O-1 — Foundation (O1–O3) — merged as PR #2

**2026-08-28 — O-1 merged.** Next.js 15 + Drizzle + MySQL app scaffolded with
next-intl (es default, en under `/en`); the complete 33-table schema from §5.O2
is in `src/db/schema.ts` and migrated; auth is iron-session + bcrypt with a
four-role gate, owner scoping and cleaner magic links. `scripts/seed.ts` and
`scripts/verify-core.ts` (33 checks) both pass, and `npm run build` succeeds
with no environment set. Next phase (O-2) should start at `src/db/schema.ts`
(`bookings`, `availability_blocks`, `extras`, `promo_codes`), `src/lib/money.ts`
and `src/db/queries/` — the booking engine has no code yet, only its tables.

**Local run**: see `README.md`. Short version: `npm install` → `cp .env.example .env` →
`npm run db:migrate` → `npm run seed` → `npm run verify` → `npm run dev`.
`scripts/` are run with tsx, which does **not** auto-load `.env`, so every script
imports `dotenv/config` on its first line.

**Route map so far** (Spanish names, `es` unprefixed, `en` under `/en`):
`/` home · `/alojamientos` + `/autos` placeholder browse · `/ingresar` login ·
`/panel` owner panel · `/admin` admin overview · `/tarea/[token]` cleaner
magic-link page. Phases O-3/O-4 add the rest per §5.O11.

**Judgment calls made under §4.4** (all in-plan; none needed Anton):

1. **Booking/block ranges are `datetime`, not mixed date/datetime.** §5.O2 says
   "dates for stays, datetimes for cars". Two range types would mean two overlap
   implementations, and §5.O4 requires exactly ONE. So `bookings.start_at/end_at`
   and `availability_blocks.start_at/end_at` are `datetime` in UTC for both
   verticals; a stay is normalised to the listing's check-in/check-out clock
   times, stored on `stay_details.check_in_time` / `check_out_time` (defaults
   14:00 / 11:00). Stay-level date semantics are therefore preserved without a
   second code path.
2. **Money is `decimal(14,2)` handled as strings** through `src/lib/money.ts`.
   mysql2 returns decimals as strings; every arithmetic step rounds to 2
   decimals. No money value is ever a bare JS float. PYG is displayed with 0
   fraction digits but stored with 2 so a USD listing needs no migration.
3. **Price and commission are snapshotted on the booking** (`unit_price`,
   `units`, `base_total`, `extras_total`, `discount_total`, `total`,
   `commission_pct`, `commission_amount`), and `booking_extras` snapshots the
   extra's name and price. Editing a listing or an extra must never rewrite
   money history.
4. **No foreign-key constraints are declared.** Relations are declared for the
   Drizzle query API only. This keeps migrations reorderable and seeds/imports
   insertable in any order on Hostinger's MySQL; integrity is enforced in the
   application layer (`src/lib/scope.ts` + the query layer). If cascades become
   necessary, add them deliberately in one migration.
5. **Auth is split in two: `src/lib/auth-core.ts` (no Next.js import) and
   `src/lib/auth.ts` (cookies/session).** This lets `scripts/verify-core.ts` and
   future cron jobs exercise the exact same credential and role-gate code the
   app uses, instead of a parallel copy.
6. **The DB pool is created lazily.** `next build` imports every route module,
   and §4.5 requires a build to succeed with no env at all — an eagerly-created
   pool turns a missing `DATABASE_URL` into a failed build. `src/db/index.ts`
   exports lazy proxies plus `getPool()`, `getDb()` and `closePool()`.
7. **Everything under `src/app/[locale]` is `force-dynamic`**, because the
   layout reads the session cookie. Logged in `KNOWN-ISSUES.md` for Window 2 to
   revisit per-route.
8. **`next-intl` locale prefixes only, no translated pathnames.** `/en/alojamientos`
   rather than `/en/stays`. §1.3b requires Spanish default URLs and English under
   `/en`, which this satisfies; translating slugs later is a routing-config
   change with no logic impact.
9. **`owners` is a separate table from `users`.** A `users` row holds identity
   and role; an `owners` row holds the commercial profile (display name, RUC,
   default commission). Sessions carry `owners.id` so every owner-scoped query
   filters without a second lookup. One owner account covers both verticals —
   the seed's owner A holds a casa *and* an auto, and `verify-core` asserts it.
10. **Two extra columns beyond §5.O2**: `listings.ical_export_token` (§5.O2 asks
    for it in prose), and `expenses.statement_id` so the O-7 statement generator
    can be idempotent by marking what it has already billed.

**Still to be decided by later phases** (§5.O2 tables exist, mechanisms do not):
image-upload mechanism, owner publish flow (direct vs admin approval).

**Anything Sonnet must not break** (§4.7 in force): `src/db/schema.ts`,
`src/lib/auth-core.ts`, `src/lib/auth.ts`, `src/lib/session.ts`,
`src/lib/scope.ts`, `src/lib/money.ts`, and `scripts/`. All Drizzle stays in
`src/db/queries/`.

### Phase O-2 — Booking & money engine (O4, O5, O7) — merged as [PR #3](https://github.com/antonmarklundcom/rent/pull/3)

**2026-08-28 — O-2 merged.** The booking/availability engine, iCal sync and the
money engine now exist. **One** overlap function
(`src/db/queries/availability.ts` → `findConflicts` / `assertAvailable`) serves
web requests, admin manual bookings, owner blocked dates and the iCal importer
alike; it runs under `FOR UPDATE` inside the same transaction as its insert, so
the check and the write cannot be interleaved. Price, promo, extras and
commission live in the pure `src/lib/pricing.ts`; the booking state machine in
`src/lib/booking-state.ts`; half-open ranges in `src/lib/dates.ts`; iCal
parse/generate in `src/lib/ical.ts`. Next phase (O-3) starts at
`src/db/queries/bookings.ts` (`transitionBooking` is where checkout must
auto-create a cleaning task) and `src/db/queries/deposits.ts` (`deductDeposit`
already accepts the inspection/ticket ids O-3 will supply).

**What now exists**: query layer `src/db/queries/{availability,bookings,blocks,extras,deposits,payments,statements,activity}.ts` ·
libs `src/lib/{dates,booking-state,pricing,ical,errors,statement-html}.ts` ·
actions `src/app/actions/{bookings,money}.ts` (every mutation behind
`requireRole` + owner scoping) · routes `/api/ical/[token].ics` (public, token
is the credential, no guest data in the feed) and `/api/estados/[id].html`
(admin or the owning owner) · scripts `sync-ical.ts` and
`generate-statements.ts`, both idempotent and cron-ready · tests
`scripts/verify-logic.ts` (112 checks, **no database needed**) and
`scripts/verify-booking-money.ts` (96 checks, called by `verify-core.ts`, builds
and tears down its own fixtures — including a 4-way concurrency check proving
the lock, not luck, prevents double-booking). `npm run verify` runs both:
112 + 129.

**Decisions/deviations made under §4.4** (none needed Anton):

1. **`completed` bookings occupy the calendar**, not only `confirmed | active`
   as §5.O4 words it. A finished stay physically held the listing; letting a new
   booking overlap it would corrupt occupancy/revenue analytics (§5.O10) and
   allow a back-dated double sale. The change only ever makes the engine
   stricter. `OCCUPYING_STATUSES` in `src/lib/booking-state.ts` is the one place
   it is defined.
2. **A promo discount applies to the BASE total only**, never to extras — a
   percentage code must not give away a transfer or a GPS. Clamped to the base,
   so a fixed code larger than the stay can never produce a negative total.
3. **Commission is charged on OWNER GROSS = base − discount.** Extras are the
   operator's own service revenue: they are neither paid out to the owner nor
   commissioned. Isolated in `COMMISSION_BASE()` (`src/lib/pricing.ts`) so
   revisiting it is a one-line change plus a re-generation of unbilled
   statements, not a rewrite.
4. **A promo use is claimed at booking creation and released on cancellation**,
   via a conditional `UPDATE` that cannot push `used_count` past `max_uses`.
5. **An `inquiry` does not hold dates.** A guest may always ask about occupied
   dates (it is a lead); availability is enforced at confirmation, where the
   commission rate is also re-resolved — an inquiry can sit for weeks.
6. **A statement bills a booking in the period its `end_at` falls in**, and only
   `completed` bookings. Idempotency comes from the `(owner_id, period)` unique
   key plus `expenses.statement_id`: regeneration releases its own stamps and
   re-claims them, so ten runs produce identical totals.
7. **`/api/ical/[token]` accepts the token with or without `.ics`** — calendar
   clients disagree about keeping the extension.
8. **Deposits and payment links are terminal once settled.** Re-settling raises
   `already_settled` rather than overwriting; a correction is a new record.

**Schema**: no shape change. Ten enum *types* were exported from
`src/db/schema.ts` (`PriceUnit`, `BlockReason`, …) so app code stops re-typing
literal unions — additive, no migration.

**Seed additions**: a `commission_pct` override on one listing, one (inactive)
`ical_sources` row, and commission snapshots on the seeded bookings so demo data
matches what the engine produces.

## 10. Backlog (append; never build unplanned)
- Car legal / full autos booking flow · WhatsApp Business API auto-send · payment gateway integration (v1 is link+manual status) · Airbnb PMS/channel manager · escrow/reviews/renter accounts (model (a)) · map search UI · defensive domains · GBP content loop (`gbp-optimizer`) after launch
