# Phase O-3 — Operations & autos protection. Paste into a fresh OPUS session AFTER phase O-2's PR is merged.

You are building phase **O-3** of alquilar.com.py. Read `plan.md` FIRST, in full, plus §9 and `KNOWN-ISSUES.md`. Then execute **§5 tasks O6, O8** (cleaning & turnover with magic-link cleaner pages, maintenance tickets, expenses, staff roster + cleaner job counts, supplies; car inspections, vehicle reminders, booking document verification) under the autonomy protocol in **§4**. Build nothing outside the plan.

Phase rules:
- Branch `phase/o3-operations` off latest `main`. Previous phase unmerged ⇒ finish it first (§4.2).
- Key flows to wire, per §3 groups A and C: checkout auto-creates cleaning task; stay not guest-ready until task `ready`; ticket cost auto-creates expense; damage on return inspection can open ticket + deposit deduction (uses O-2's deposit lifecycle); car booking cannot confirm with docs `pending` (admin override, logged to `activity_log`).
- Cleaner magic-link pages: tokenized URL, mobile-first, checklist + photo upload + status advance, no login (§2 roles).
- Schema exists from O-1 — this phase adds logic and functional screens, not tables. Forced schema change ⇒ migration + §9 note.
- Re-runnable; minor issues → `KNOWN-ISSUES.md`; stop only per §4.4.

Exit: build green, earlier checks pass, verify additions prove: task auto-creation, magic-link auth (token grants exactly one task, nothing else), expense linkage, deduction flow, doc gate. PR merged green. Report pass/fail checklist + judgment calls (also to §9).
