# alquilar.com.py — Build Plan (repo: rent)

Reviewed against Anton's plan sketch ("alquilar.com.py — Plan for Review"). This document contains (1) the review verdict on the sketch's open questions, (2) the v1 scope locked from it, and (3) the model work split: **Opus builds everything in Window 1, then Sonnet builds everything in Window 2** — two sequential sessions, no interleaving.

Rule for both windows: **do no work outside this plan.** Anything out of scope goes into section 7 (Backlog), not into the codebase.

---

## 1. Review of the plan sketch

The sketch is solid: keyword research is real, the domain reasoning (alquilar vs alquiler = same search intent) is correct, subfolders-not-subdomains is the right SEO call, and the shared booking/calendar/messaging engine forked only where verticals differ is the right architecture instinct. Two decisions were flagged as blocking; recommended resolutions below so the build can start. Override here if disagreed — everything downstream assumes these.

**Q1 — Marketplace-broker (a) vs management-tool (b):** go with the sketch's own lean, **(b)-lite**. Ship the owner/management side (listings, calendar, WhatsApp-first comms, info knowledge base, owner reports) with public listing pages that capture leads/booking requests — but no payment escrow, no reviews/trust infrastructure, no transaction brokering in v1. This defers the legal/liability question (sketch §6.3) instead of being blocked by it, and the public pages still harvest the SEO demand. Growing toward (a) later is additive (payments + reviews on top of the same bookings table), not a rewrite.

**Q2 — Vertical sequencing:** **alojamientos first, autos second — but both in the same build**, because the engine is shared. Reasons: alojamientos has the lower-competition organic entry (sketch §3); the car-intermediary legal question is unresolved and only bites the autos vertical; and (b)-lite management fits stay-hosts (Airbnb owners wanting backend help) most naturally. "Second" here means: the schema, routes, and admin support both verticals from day one (retrofitting a second vertical into a single-vertical schema is the expensive path), but public autos pages launch as a lightweight lead-capture vertical (browse + "consultá por WhatsApp") rather than the full booking flow, until legal input lands.

**Q3 — Legal (car liability):** not a build task. Stays open; tracked in Backlog. The (b)-lite + autos-as-lead-capture decision above means nothing in v1 depends on it.

**Q4 — Defensive domains (alquileres.com.py, rentar.com.py):** business decision, not build work. Backlog. Cheap insurance; recommendation is register both if available.

**Q5 — Portfolio cannibalization:** low risk vs propia (long-term sales/rental vs short-term stays + cars are different intents); worth a one-time check against the residency-services property for content overlap. Backlog.

**rent.com.py:** v1 treatment is a 301 redirect to `alquilar.com.py/autos` plus one English landing page targeting "rent car paraguay / asuncion" living on alquilar.com.py. A separate English microsite is out of scope.

---

## 2. Locked v1 scope

- One domain, two verticals as subfolders: `/alojamientos` and `/autos`.
- Shared engine: `owners` → `listings` (type: `stay | car`) → type-specific detail tables → `bookings` → `messages` (channel-agnostic) → per-listing `info_items` knowledge base.
- Owner dashboard: calendar, upcoming bookings, earnings summary.
- Auto-generated monthly owner reports (earnings/occupancy) delivered via WhatsApp link or email.
- WhatsApp-first renter/guest communication, leads into VenderCRM (existing lead-capture pattern).
- AI-drafted reply suggestions to common questions, grounded in the listing's `info_items` (admin/owner approves before sending — no auto-send in v1).
- Admin panel: internal team manages both verticals, all owners, all bookings from one place.
- SEO structure: city/barrio landing pages per vertical ("cerca de mi" pattern), es-PY voseo copy, one English car-rental landing page.
- Stack: Next.js 15 (App Router, TS, Tailwind) + Drizzle + MySQL on Hostinger managed Node.js, per `nodejs-mysql-hostinger-stack` + `nextjs-deploy-hostinger`.

**Explicitly out of v1** (from the sketch, confirmed): Airbnb/channel-manager integration, payment escrow, insurance/trust infrastructure, reviews, renter accounts (renters interact via public pages + WhatsApp; only owners and staff log in), autos online booking flow (lead-capture only until legal is resolved).

---

## 3. Model split strategy

Two sequential windows, each model completing ALL its work before the other starts:

- **Window 1 — Opus: the hard, constraining half.** Scaffold, full two-vertical schema, auth/roles, booking/calendar engine, messaging + VenderCRM wiring, AI reply drafting, owner dashboard logic, admin CRUD, bare functional pages. Ends with an ugly-but-correct app, green build, seeded, every flow provable locally.
- **Window 2 — Sonnet: the volume-and-polish half.** All public UI/design, barrio/city landing pages, SEO, imagery, es-PY copy, owner-dashboard and admin polish, reports formatting, deployment to Hostinger, live smoke test.

Opus goes first because its outputs (schema, query layer, route map, auth) constrain everything Sonnet does; the reverse order would force rework. The only interface between windows is section 6 (handoff notes) + the code itself. Sonnet must not modify schema or auth — needed changes get logged in Backlog and worked around.

---

## 4. Window 1 — Opus tasks (in order)

### O1. Scaffold
- `create-next-app` (App Router, TS, Tailwind); `drizzle-orm`, `mysql2`, `drizzle-kit`, `tsx`.
- `drizzle.config.ts`; `src/db/index.ts` single pool, `connectionLimit: 8`, `timezone: "Z"`.
- `.env.example` committed with a comment per var (DB, session secret, VenderCRM tenant key, Anthropic API key for reply drafting). Never commit `.env`.
- `scripts/` for idempotent seed/one-off jobs (`onDuplicateKeyUpdate` on unique slug/code).

### O2. Schema — the load-bearing decision, made once
- `users`: id, email, bcrypt hash, `role` enum `admin | staff | owner` from day one.
- `owners`: profile + payout/contact details, linked to `users`.
- `listings`: id, unique `slug`, `vertical` enum `stay | car`, title, description, price + pricing unit (`per_night | per_day | per_month`), currency (Gs. default), `location_id`, lat/lng nullable, `status` enum `draft | published | paused`, `published_at`, `owner_id`, `updated_by`/`updated_at` audit pair.
- `stay_details` (1:1): property type, bedrooms, bathrooms, max guests, m², amenities JSON.
- `car_details` (1:1): make, model, year, transmission, fuel, seats, mileage terms, insurance terms.
- `listing_images`: listing_id, url, sort, alt.
- `locations`: slug, name, parent_id (city → barrio) — drives filters and SEO landing pages.
- `bookings`: listing_id, guest name/phone, date range (or pickup/return datetimes), status enum `inquiry | confirmed | active | completed | cancelled`, price snapshot, source (`web | whatsapp | manual`), notes. Serves both verticals; autos rows will start life as `inquiry` (lead-capture posture).
- `messages`: booking_id nullable, listing_id, direction, channel enum `whatsapp | web`, body, created_at — channel-agnostic per the sketch.
- `info_items`: listing_id, question/label, answer — the per-listing knowledge base feeding AI drafts.
- `leads`: mirror of the VenderCRM forward (store-first, forward-after flag).

### O3. Auth + roles
- Hand-rolled sessions (`iron-session` + bcrypt); no OAuth in v1.
- `requireRole(session, allowed)` helper; every mutating server action/API route checks role **server-side**.
- Owners are strictly owner-scoped: every non-admin/staff query filters `owner_id = session.user.id`.

### O4. Booking/calendar engine
- Availability computation per listing (confirmed/active bookings block dates); overlap-rejection on create/confirm — enforced in the data layer, in one place.
- Booking state transitions with validation (`inquiry → confirmed → active → completed`, cancel from any pre-completed state).
- Earnings/occupancy aggregation queries (feeds dashboard + monthly reports).

### O5. Public data layer
- Published-only listing queries: filter by vertical, location, price, capacity/specs; paginated. All in `src/db/queries/` — Sonnet's pages call functions, never write Drizzle directly.
- Slug detail lookup; availability lookup for the stay booking-request form.

### O6. Messaging, leads, AI drafts
- `POST /api/leads`: validate → store → forward to VenderCRM (per `vendercrm-lead-capture`); CRM failure never loses the lead. Booking requests create a `bookings` row (`inquiry`) + lead.
- Message log CRUD (staff/owner record WhatsApp exchanges against a booking; channel field ready for future WhatsApp API integration — the integration itself is Backlog).
- AI reply drafting: server action that takes an inbound question + the listing's `info_items` and returns a suggested reply (Claude API, per `claude-api` skill conventions); human approves/edits — no auto-send.

### O7. Owner dashboard + admin (functional, undesigned)
- `/panel` (owner): calendar view data, upcoming bookings, earnings summary, own listings CRUD (draft → publish request or direct publish — decide in-window, document in §6), `info_items` editor.
- `/admin` (staff/admin): all listings both verticals, all bookings, all owners, all leads/messages, user management (admin only). One route per entity, shared table component, one form component for create+edit. No generic CMS abstraction.
- Image upload for listings (choose mechanism in-window; document in §6).
- Monthly owner report generation: a `scripts/report-monthly.ts` producing the per-owner summary (data + plain rendering; Sonnet formats it) — cron wiring is Backlog.

### O8. Bare functional pages
- Unstyled but working: home, `/alojamientos` + `/autos` browse with filters, listing detail with booking-request/lead form, owner login + panel, admin. Enough to prove every flow end-to-end; zero design effort.

### O9. Exit criteria — Window 1 done when:
- `npm run build` green.
- Seed script: 1 admin, 1 staff, 2 owners, ~8 stay + ~6 car listings across ≥3 locations, sample bookings in various states.
- Provable locally: owner login → edit own listing only; admin sees all; publish → appears publicly; booking request → `inquiry` + lead stored (+ CRM forward attempted); overlap rejected; AI draft returns grounded answer; report script outputs correct numbers.
- Section 6 handoff notes written. Commit + push.

---

## 5. Window 2 — Sonnet tasks (in order)

### S1. Read handoff
- Read §6 + skim `src/db/schema.ts` and `src/db/queries/`. **Do not change schema, auth, or booking-engine logic** — log needed changes in Backlog and work around.

### S2. Design system + public UI
- Apply `web-design-system`; mobile-first (PY traffic is heavily mobile).
- Pages: home (dual-vertical hero, featured listings, location links), `/alojamientos` and `/autos` browse + filter UI, listing detail (gallery, key facts per vertical, availability, WhatsApp CTA + booking-request form), location landing pages `/[vertical]/[city]` and `/[vertical]/[city]/[barrio]`, English `/en/rent-car-paraguay` landing page, about/contact, 404.
- Listing card per vertical (stay: price/night, guests, beds, barrio; car: price/day, make/model/year, transmission).

### S3. Imagery
- Fill declared image slots via `higgsfield-web-imagery` pipeline (scripted fetch/convert/place; no hand-edited filenames/alt).

### S4. SEO + content
- es-PY voseo copy sitewide ("alquilá tu auto…"); per-route metadata, OG images, `sitemap.xml` (including all location pages), `robots.txt`, JSON-LD (`Product`/`Vehicle` for cars, `LodgingBusiness`/`Accommodation` for stays), canonicals on filtered views.
- Location landing pages target the "cerca de mi" / named-location patterns from the keyword research (alquileres, alquiler de departamentos/casas, alquiler de autos asunción…).

### S5. Owner dashboard + admin polish
- Style `/panel` and `/admin`: calendar rendering, earnings cards, empty states, toasts, form validation messages. Format the monthly owner report (clean WhatsApp-shareable/email HTML rendering of O7's data).

### S6. Deploy
- Follow `nextjs-deploy-hostinger` §1 (Git deploy) + §6a (MySQL init, Remote MySQL whitelist, tsx `.env` gotcha). Env vars from `.env.example`. Migrations + seed on production DB.
- Domain wiring: alquilar.com.py primary; rent.com.py → 301 to `/autos` (English landing page reachable).
- Live smoke test: browse both verticals, detail, booking request → lead in VenderCRM, owner login owner-scoped, admin login, report script against prod data.

### S7. Exit criteria — Window 2 done when:
- Live on alquilar.com.py, build green, real-viewport mobile check, Lighthouse sanity pass, rent.com.py redirect verified, Backlog updated with everything deferred.

---

## 6. Handoff notes (Opus writes this at end of Window 1)

_Empty until Window 1 completes. Must cover: final schema summary + any deviations from §O2, route map, local run instructions (env, seed), image-upload mechanism chosen, owner publish flow chosen (direct vs approval), anything else Sonnet must not break._

---

## 7. Backlog (append here instead of scope-creeping)

- Legal input on car-rental intermediary liability in PY → unlocks full autos booking flow (sketch §6.3)
- Defensive domain registrations: alquileres.com.py, rentar.com.py (business task)
- Portfolio overlap check vs residency-services content (sketch §6.5)
- WhatsApp Business API integration (v1 logs messages manually)
- Cron wiring for monthly reports (v1: run script manually)
- Airbnb/channel-manager via paid PMS (deferred per sketch until a paying customer needs it)
- Payments/escrow, reviews/trust — the move from model (b) to (a)
- Renter accounts / saved searches
- Map-based search UI (lat/lng columns exist)
