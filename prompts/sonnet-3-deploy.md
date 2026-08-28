# Phase S-3 — Deploy & live smoke test. Paste into a fresh SONNET session AFTER phase S-2's PR is merged. Final phase.

You are building phase **S-3** of alquilar.com.py. Read `plan.md` FIRST, in full, plus §9 and `KNOWN-ISSUES.md`. Then execute **§6 tasks S6, S7** (Hostinger deployment, domain wiring, cron documentation, full live smoke test) under the autonomy protocol in **§4**. Build nothing outside the plan.

HARD LIMITS (§4.7) still apply.

Phase rules:
- Branch `phase/s3-deploy` off latest `main`. Previous phase unmerged ⇒ finish it first (§4.2).
- Load `nextjs-deploy-hostinger` and follow its §1 and §6a EXACTLY — Remote MySQL whitelist, tsx-doesn't-autoload-.env, and the env-var traps in it are real and pre-paid. Env values come from Anton per plan §7; a missing value follows §4.5 (degrade gracefully, document) — but deploy access and DATABASE_URL are genuine blockers worth stopping for per §4.4a.
- Migrations + seed against production DB. Domains: alquilar.com.py primary; rent.com.py → 301 to `/autos` at the Hostinger domain level (middleware fallback if needed) — rent.com.py must NOT consume a second Node slot (§1.3).
- Cron (`sync-ical` hourly / `process-messages` 15min / `generate-statements` monthly): configure if possible from the session; otherwise write exact setup steps for Anton in `KNOWN-ISSUES.md` — do not stop for this (§6.S6).
- Run the FULL §6.S7 live smoke test and record every result.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: live site green, smoke test recorded, redirect verified, Lighthouse sanity pass, `KNOWN-ISSUES.md` + §10 Backlog final, PR merged green. Report: live URLs, full checklist pass/fail, and an exact numbered list of anything Anton must do manually (DNS, env, cron).
