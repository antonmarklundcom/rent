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
