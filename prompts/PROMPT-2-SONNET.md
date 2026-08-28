# Window 2 prompt — paste into a fresh SONNET session on this repo, ONLY after Window 1's PR is merged

You are building Window 2 (all UI, SEO, content, imagery, and deployment) of alquilar.com.py.

Read `plan.md` in the repo root FIRST, in full — especially **§9 Handoff notes** (written by Window 1) and `KNOWN-ISSUES.md`. Then execute **§6 (Window 2 — SONNET)** tasks S1→S7 in order, under the autonomy protocol in **§4**. Do not build anything not in the plan — extras go to §10 Backlog.

HARD LIMITS (plan.md §4.7): never modify `src/db/schema.ts`, auth code, or the booking/availability/commission logic. If a change there seems necessary, log a proposed diff in §10 Backlog and work around it in the UI layer. All data access on pages goes through the existing functions in `src/db/queries/` — never write Drizzle in page/component code.

Key rules (full versions in plan.md §4 — read them there):

- Work autonomously until every exit criterion in §6.S7 passes, including the LIVE deployment. Do not stop to ask about in-plan work.
- Before writing any code, check what already exists on the branch and continue from the first unmet exit criterion (this prompt must be safely re-runnable).
- Load and follow these skills at the matching step: `web-design-system` conventions before S2, `dataviz` before the analytics dashboard in S3, `higgsfield-web-imagery` for S4, `nextjs-deploy-hostinger` for S6 (follow its §1 and §6a exactly — the gotchas in it are real and pre-paid).
- All public copy is es-PY with voseo ("alquilá", "reservá"); the one English page is `/en/rent-car-paraguay`. Mobile-first everywhere — check real narrow viewports, not just desktop devtools defaults.
- Minor non-blocking issues: log in `KNOWN-ISSUES.md`, keep going. Stop and ask Anton ONLY for missing credentials/access with no fallback (Hostinger deploy access, DNS) — see §4.4. If cron jobs can't be configured from the session, write exact setup instructions in `KNOWN-ISSUES.md` instead of stopping (§6.S6).

When done:
1. Run the full live smoke test in §6.S7 and record results.
2. Update `KNOWN-ISSUES.md` and plan.md §10 Backlog with everything deferred.
3. Commit, push, create the PR, subscribe to it, fix anything red, and **merge it when green** (§4.2).
4. Report: exit-criteria checklist with pass/fail, live URLs, cron setup status, and anything Anton must do manually (DNS, env vars, cron) with exact steps.
