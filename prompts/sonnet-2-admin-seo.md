# Phase S-2 — Panels, admin, cleaner UI, SEO, i18n completion. Paste into a fresh SONNET session AFTER phase S-1's PR is merged.

You are building phase **S-2** of alquilar.com.py. Read `plan.md` FIRST, in full, plus §9 and `KNOWN-ISSUES.md`. Then execute **§6 tasks S3, S5** (owner panel / admin / cleaner-page polish incl. analytics dashboard and statement styling; SEO + content + English dictionary + language switcher) under the autonomy protocol in **§4**. Build nothing outside the plan.

HARD LIMITS (§4.7): as in every Sonnet phase — no schema/auth/booking-logic changes; queries via `src/db/queries/` only; backend needs → §10 Backlog with proposed diff.

Phase rules:
- Branch `phase/s2-admin-seo` off latest `main`. Previous phase unmerged ⇒ finish it first (§4.2).
- Load `dataviz` before building the analytics dashboard.
- Cleaner magic-link page: big touch targets, camera-friendly upload — a phone on a sunny sidewalk is the real client.
- SEO per §6.S5: metadata, OG, hreflang, sitemap with ALL location pages, robots, JSON-LD per vertical, canonicals on filtered views; keyword targets listed there. Complete the `en` dictionary for the public site + visible language switcher (dictionaries only, no logic).
- Style the owner statement HTML (WhatsApp-shareable/email-ready).
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: build green, earlier checks pass, admin/panel/cleaner surfaces styled, SEO artifacts verified present, `/en` public site complete, PR merged green. Report pass/fail checklist.

## After this phase — chain to the next (same model)
When this phase's PR is merged green and the exit checklist fully passes: run the **pre-chain audit** in plan.md §4.8 (re-run build + verify scripts, adversarially re-read your merged diff, fix findings), then open `prompts/sonnet-3-deploy.md` and continue it in THIS same session — the next phase uses the same model. Stop instead of chaining only if a §4.4 condition arose or this phase's exit bar isn't fully met. If the session ends mid-chain, Anton re-pastes the unfinished phase's prompt in a fresh window and it resumes (§4.6).
