# Known issues

Non-blocking issues logged per plan §4.3. Fix opportunistically; nothing here
blocks a later phase.

## From phase O-1 (foundation)

- **No ESLint config yet.** `next build` runs TypeScript checking but there is
  no lint step. Add `eslint-config-next` in a later phase if it earns its keep.
- **Everything under `src/app/[locale]` is `force-dynamic`.** The layout reads
  the session cookie, so nothing can be prerendered. Window 2 can opt purely
  public routes (home, browse, location pages) back into caching once their
  data-fetching settles — it is a per-route `export const dynamic` change, no
  logic change.
- **`/alojamientos` and `/autos` are placeholder lists.** They exist so the
  header has no dead links and so O-1 can prove the query layer end to end.
  The real browse pages with filters are phase O-4 (§5.O11) + Sonnet S-2.
- **Image uploads are not implemented.** `listing_images.url` and
  `task_photos.url` hold plain strings; the seed points them at
  `/images/placeholder-*.jpg`, which do not exist yet. The upload mechanism is
  chosen in phase O-4 (§9 handoff must record it).
- **No foreign keys are declared.** Referential integrity is enforced in
  application code only (see §9 handoff for the reasoning). If a later phase
  needs cascade deletes, add them deliberately in one migration.
- **`next-intl` `pathnames` are not used.** English URLs are `/en/alojamientos`
  rather than `/en/stays`. Translating the slugs is a routing-config change in
  Window 2 and touches no logic.

## From phase O-2 (booking & money engine)

- **Owner statements are single-currency.** `generateStatement` refuses a
  period that mixes currencies rather than summing PYG and USD into one net
  figure. v1 is PYG-only (plan §1), so this cannot fire today; a real
  multi-currency owner needs one statement per currency, which is a schema
  addition (a currency column in the unique key), not a patch.
- **`syncIcalBlocks` takes no lock.** The importer assumes one sync per source
  at a time, which is what the hourly cron does. Two overlapping runs of
  `npm run sync:ical` for the same source could both decide the same UID is
  new. Harmless (the unique key rejects the second insert), but the run would
  report an error rather than a clean no-op.
- **iCal `TZID` uses the platform's IANA database.** Feeds with a floating
  (no `Z`, no `TZID`) time are read as `America/Asuncion`. That is right for
  Paraguayan hosts and wrong for a listing whose external calendar is kept in
  another zone; a per-source timezone column would fix it if it ever bites.
- **Expired payment links are only swept on demand.** `expireOverduePaymentLinks`
  runs from an admin action, not a cron. Add it to the hourly job in phase S-3
  if the outbox ever shows stale "pending" links.
- **No optimistic-concurrency column on bookings.** Two admins editing the same
  booking's status simultaneously are serialised by the `FOR UPDATE` lock, so
  neither corrupts the row, but the second one's intent silently loses to the
  state machine (it gets `invalid_transition`, which is the correct-but-terse
  outcome).

## From phase O-3 (operations & autos protection)

- **A success message disappears when its form unmounts.** On
  `/admin/reservas/[id]`, verifying or rejecting a document replaces the two
  action buttons with "revisado", so the `ActionForm` that produced the
  confirmation unmounts and the green line is never seen — the change did
  happen and the row's new status is visible. Window 2 should hoist the
  feedback out of `ActionForm` (a toast, or state on the page) in S-3.
- **`UPLOAD_DIR` is local disk.** `src/lib/uploads.ts` writes photos to a
  directory and `/api/uploads/[...path]` serves them. That is right for a
  single Hostinger Node slot (plan §1.4) and wrong the day the app runs on two
  instances. Swapping in object storage means replacing `storeUpload` and the
  route handler; no caller knows where the bytes live. **Deploy note for S-3**:
  point `UPLOAD_DIR` at a path OUTSIDE the Git working tree, or the next deploy
  wipes it.
- **Uploaded photos are served without an authorisation check.** The URL is the
  credential — the filename carries 8 random bytes and is only ever shown to
  someone who can already see the task, ticket or inspection. Same posture as
  `/api/ical/[token]`. If renter ID documents ever need stronger handling, that
  route is the one place to gate.
- **Uploads are stored as sent — no resizing, stripping or re-encoding.** A
  cleaner's 8 MB phone photo is served back at 8 MB, with its EXIF (including
  GPS) intact. Window 2 should add a resize step, and stripping EXIF from
  renter documents is worth doing before launch.
- **One auto turnover task per booking.** `ensureTurnoverTask` treats *any*
  cleaning task carrying the booking's id as "already handled", so a booking
  that was given a mid-stay cleaning task would not get an automatic turnover
  at checkout. Nothing in the app creates such a task today; if mid-stay cleans
  become a feature, the guard needs a way to tell the two apart.
- **An open cleaning task with no due date blocks every check-in on its
  listing.** `openTasksBlockingCheckIn` treats a null `due_by` as "due now",
  which is the safe reading, but it means a stray undated task is a hard stop
  until somebody marks it ready. The roster shows it, so it is findable.
- **The guest-ready gate has no override.** A stay cannot go `confirmed →
  active` while its turnover is open; the only way through is to mark the task
  ready. That is deliberate (see plan §9), but it does mean an admin must
  record the flat as clean before checking a guest in.
- **`refreshVehicleReminders` runs per page load, not on a cron.** It only
  writes rows whose derived status changed, so it is cheap, but a fleet
  reminder never becomes `due` until somebody opens `/admin/flota` or the admin
  overview. Phase S-3 can add it to the hourly job next to `sync:ical`.
- **Photo uploads are images only.** JPG/PNG/WEBP/HEIC — a renter who sends a
  PDF of their licence cannot be filed without converting it first. Adding PDF
  means a per-folder allow-list in `src/lib/uploads.ts` (documents yes, cleaning
  photos no) plus a viewer that is not an `<img>`.
- **No rate limit on the cleaner upload.** Anyone holding a valid magic token
  can post 8 MB photos in a loop and fill `UPLOAD_DIR`. The token is per task
  and only ever handed to the assigned person, so the exposure is small, but a
  per-token cap belongs in S-3 alongside the deploy config.
- **Owners cannot see cleaning, tickets or expenses yet.** Every O-3 action is
  admin-only; the read queries already take a `listingIds` filter for the
  owner-scoped panel that phase O-4 builds (§5.O10).
