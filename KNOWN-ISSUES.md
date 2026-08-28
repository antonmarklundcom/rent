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
