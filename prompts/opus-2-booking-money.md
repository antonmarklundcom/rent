# Phase O-2 — Booking & money engine. Paste into a fresh OPUS session AFTER phase O-1's PR is merged.

You are building phase **O-2** of alquilar.com.py. Read `plan.md` FIRST, in full, plus §9 handoff notes and `KNOWN-ISSUES.md`. Then execute **§5 tasks O4, O5, O7** (booking/availability engine, iCal sync, money engine: commission/statements/deposits/extras/promos/payment links) under the autonomy protocol in **§4**. Build nothing outside the plan.

Phase rules:
- Branch `phase/o2-booking-money` off latest `main` (which contains merged O-1). If O-1's PR is unmerged, finishing it comes first (§4.2).
- This phase is the highest-stakes logic in the project (§5.O4): ONE availability/overlap function used everywhere; booking state machine; price calc with extras + promo snapshot; commission math; idempotent statement generation. These are "bad foundation" territory — implement carefully and cover each with tests/verify-script checks (extend the O-1 verify script).
- iCal per §5.O5: import script (idempotent, cron-ready), export route, date/TZ parsing tested.
- Do not change the O-1 schema shape unless genuinely forced; if forced, migration + note in plan.md §9 with reasoning.
- Re-runnable: check what exists first; continue from the first unmet criterion.
- Minor issues → `KNOWN-ISSUES.md`, keep going. Stop only per §4.4.

Exit: build green, all O-1 checks still pass, new tests prove overlap rejection (incl. iCal blocks), price/commission math, statement idempotency, deposit lifecycle. PR merged green. Report pass/fail checklist + judgment calls (also to §9).

## After this phase — chain to the next (same model)
When this phase's PR is merged green and the exit checklist fully passes: run the **pre-chain audit** in plan.md §4.8 (re-run build + verify scripts, adversarially re-read your merged diff, fix findings), then open `prompts/opus-3-operations.md` and continue it in THIS same session — the next phase uses the same model. Stop instead of chaining only if a §4.4 condition arose or this phase's exit bar isn't fully met. If the session ends mid-chain, Anton re-pastes the unfinished phase's prompt in a fresh window and it resumes (§4.6).
