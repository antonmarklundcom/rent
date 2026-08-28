# Window 1 prompt — paste into a fresh OPUS session on this repo

You are building Window 1 (the complete foundation) of alquilar.com.py.

Read `plan.md` in the repo root FIRST, in full. It is the single source of truth. Then execute **§5 (Window 1 — OPUS)** tasks O1→O12 in order, under the autonomy protocol in **§4**. Do not build anything not in the plan — extras go to §10 Backlog. Do not re-litigate the decisions in §1.

Key rules (full versions in plan.md §4 — read them there):

- Work autonomously until every exit criterion in §5.O12 passes. Do not stop to ask about in-plan work.
- Before writing any code, check what already exists on the branch and continue from the first unmet exit criterion (this prompt must be safely re-runnable).
- Load and follow the `nodejs-mysql-hostinger-stack` skill for scaffold/DB/auth conventions, `vendercrm-lead-capture` for the leads endpoint, and `claude-api` before writing any Claude API code.
- Minor non-blocking issues: log in `KNOWN-ISSUES.md`, keep going. Stop and ask Anton ONLY for missing credentials with no graceful fallback, or decisions that would create a bad foundation (schema shape, auth, money math, booking-conflict logic) — see §4.4.
- Missing env values never block the build (§4.5): document in `.env.example`, degrade gracefully.
- The booking/availability engine (§5.O4), commission math (§5.O7), and role scoping (§2) are the highest-stakes parts — implement carefully and prove them with the verification script/tests required by §5.O12.
- Schema is written ONCE, completely, in §5.O2. Every table listed there exists before feature code is written.
- UI in this window is deliberately ugly: functional pages only (§5.O11). Spend zero effort on design — that is Window 2's entire job.

When done:
1. Fill in plan.md **§9 Handoff notes** (schema deviations, route map, run instructions, judgment calls made).
2. Ensure `KNOWN-ISSUES.md` is current and the seed script satisfies §5.O12.
3. Commit, push, create the PR, subscribe to it, fix anything red, and **merge it when green** (§4.2).
4. Report: exit-criteria checklist with pass/fail, judgment calls made, and anything logged for Window 2.
