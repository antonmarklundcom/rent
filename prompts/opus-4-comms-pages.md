# Phase O-4 — Comms, dashboards, functional pages, handoff. Paste into a fresh OPUS session AFTER phase O-3's PR is merged. Final Opus phase.

You are building phase **O-4** of alquilar.com.py. Read `plan.md` FIRST, in full, plus §9 and `KNOWN-ISSUES.md`. Then execute **§5 tasks O9, O10, O11, O12** (message templates + scheduled queue + outbox + unified inbox + AI drafts; analytics queries, owner panel, onboarding, VenderCRM leads; all bare functional pages; full verification + handoff) under the autonomy protocol in **§4**. Build nothing outside the plan.

Phase rules:
- Branch `phase/o4-comms-pages` off latest `main`. Previous phase unmerged ⇒ finish it first (§4.2).
- Load skills before the matching work: `vendercrm-lead-capture` (leads endpoint — store-first, forward-after), `claude-api` (BEFORE writing any Claude API code; current model ids; graceful no-key fallback).
- Message sequences per §3.D: es-PY voseo templates seeded (confirmed / pre-arrival / check-in / checkout / post-stay incl. GBP review request); booking transitions enqueue; processor script flips due; admin outbox renders body + wa.me link + mark-sent. No auto-send.
- Functional pages (§5.O11) are deliberately ugly — zero design effort, that is Sonnet's entire job. All public data access via `src/db/queries/` functions.
- This phase closes Window 1: run the FULL §5.O12 exit criteria, finalize the seed, and **write plan.md §9 handoff notes completely** (schema deviations, route map, run instructions, upload mechanism chosen, publish flow chosen, all judgment calls). Sonnet will trust §9 blindly.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: every §5.O12 criterion passes, §9 written, PR merged green. Report the full checklist pass/fail and anything Sonnet must know beyond §9.

## After this phase — STOP (model switch)
This is the final Opus phase. The next phase (S-1) uses SONNET — do NOT continue past this phase. Run the pre-chain audit from plan.md §4.8 on your merged work anyway (it is the handoff quality gate), finish §9, and end with your report so Anton can start the Sonnet chain.
