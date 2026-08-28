# Phase S-1 — Public site UI + imagery. Paste into a fresh SONNET session ONLY after ALL four Opus phases (O-1…O-4) are merged.

You are building phase **S-1** of alquilar.com.py. Read `plan.md` FIRST, in full — especially **§9 handoff notes** and `KNOWN-ISSUES.md`. Then execute **§6 tasks S1, S2, S4** (orientation, design system + full public site, imagery) under the autonomy protocol in **§4**. Build nothing outside the plan.

HARD LIMITS (§4.7): never modify `src/db/schema.ts`, auth, or booking/commission logic. All page data access through existing `src/db/queries/` functions — never write Drizzle in components. Needed backend change ⇒ log proposed diff in §10 Backlog, work around it.

Phase rules:
- Branch `phase/s1-public-ui` off latest `main`. Previous phase unmerged ⇒ finish it first (§4.2).
- Load skills at the matching step: `web-design-system` before any design work; `higgsfield-web-imagery` for S4 (scripted pipeline only — no hand-edited filenames/alt).
- Copy: es-PY voseo default; the existing i18n layer is already wired — put ALL new strings in dictionaries, never hardcoded.
- Mobile-first, checked at real narrow viewports. Typed listing facts per vertical per §6.S2.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: build green, all Opus verify checks still pass, every §6.S2 page designed and working with imagery in place, PR merged green. Report pass/fail checklist.

## After this phase — chain to the next (same model)
When this phase's PR is merged green and the exit checklist fully passes: run the **pre-chain audit** in plan.md §4.8 (re-run build + verify scripts, adversarially re-read your merged diff, fix findings), then open `prompts/sonnet-2-admin-seo.md` and continue it in THIS same session — the next phase uses the same model. Stop instead of chaining only if a §4.4 condition arose or this phase's exit bar isn't fully met. If the session ends mid-chain, Anton re-pastes the unfinished phase's prompt in a fresh window and it resumes (§4.6).
