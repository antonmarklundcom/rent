# Phase O-1 — Foundation. Paste into a fresh OPUS session on this repo.

You are building phase **O-1** of alquilar.com.py. Read `plan.md` in the repo root FIRST, in full — it is the single source of truth. Then execute **§5 tasks O1, O2, O3** (scaffold + i18n, the COMPLETE schema, auth/roles) under the autonomy protocol in **§4**. Build nothing outside the plan.

Phase rules:
- Branch `phase/o1-foundation` off latest `main`. One PR for this phase; create it, subscribe, fix anything red, merge when green (§4.2). Do not start any O4+ work.
- Write the FULL schema from §5.O2 now — every table, even ones later phases use. Schema is never retrofitted (§4 / §5 header).
- i18n from day one per §1.3b: Spanish URLs/copy default, English under `/en`, code identifiers in English.
- Load skills: `nodejs-mysql-hostinger-stack` before scaffolding.
- Seed script per §5.O12's seed spec (users of all four roles incl. a dual casa+auto owner) — write it now so every later phase can verify against it. Include a minimal verify script proving login, role scoping (owner A cannot see owner B), and migrations apply cleanly.
- Re-runnable: check what exists on the branch first; continue from the first unmet criterion.
- Minor issues → `KNOWN-ISSUES.md`, keep going. Stop only per §4.4 (missing credential with no fallback, or bad-foundation decision).

Exit: `npm run build` green, migrations + seed + verify pass, `.env.example` complete, PR merged green. Report a pass/fail checklist and any judgment calls (also record them in plan.md §9).
