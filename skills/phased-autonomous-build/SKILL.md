---
name: phased-autonomous-build
description: Plan and run a full project build as a sequence of autonomous, phased Claude Code sessions with minimal human time at the keyboard — idea sketch → reviewed plan.md → per-phase prompt files in the repo → phases grouped by model (all Opus phases first, then all Sonnet phases), one PR per phase merged green, each finished phase spawning the next phase as a fresh session with the right model. Use this skill EVERY time Anton starts planning a new app/site build, shares an idea sketch or business plan for something to build, asks to "make a plan", "review the plan", "split work between Opus and Sonnet", "build this AFK / while I'm away", "phased build", "one PR per step", or asks how to structure prompts so Claude can build a project end-to-end without supervision. Also use it when a build session says "continue with the next phase" or when converting an existing rough plan into executable phase prompts. Proven on the alquilar.com.py build (repo antonmarklundcom/rent).
---

# Phased Autonomous Build

Turn a project idea into a repo that builds itself: a reviewed `plan.md`, a `prompts/` folder with one prompt file per phase, and handoff rules so each finished phase starts the next one in a fresh session. The human's total involvement: share the idea, answer the review questions, start phase 1, and check in occasionally.

Why this shape works:
- **Phases = PRs.** Each phase is one branch, one PR, merged green before the next starts. A failure can only ever cost one phase.
- **Model-grouped, foundation-first.** All heavy-model (Opus) phases run first — schema, auth, core logic — because those decisions constrain everything. All Sonnet phases (UI, SEO, content, deploy) run after, on a stable foundation they are forbidden to change.
- **Fresh session per phase.** Each phase starts with near-zero context (plan.md + build log, not hours of history). Cheaper, cache-friendly, and a usage/context death mid-build costs one phase restart, never a multi-phase reload.
- **The repo is the memory.** plan.md, the §Build-log, and KNOWN-ISSUES.md carry ALL state between sessions. If it isn't committed, the next phase doesn't know it.

## Stage 1 — Review the idea

Input is a raw idea sketch (a markdown doc, a voice-note transcript, a chat message — rawness is fine; do NOT ask the user to have another model "improve" it first, an intermediary rewrite only loses detail).

1. Read the sketch. Identify the decisions that BLOCK a build start (business model, vertical sequencing, market, monetization) vs. ones that don't.
2. For each blocking decision, give a concrete recommendation with reasoning — the goal is that the user can reply with "yes" or short corrections, not homework.
3. Ask for the stack only if it isn't obvious; default to the user's proven stack skills (for Anton: `nodejs-mysql-hostinger-stack` + `nextjs-deploy-hostinger`, market skills for PY/SE).
4. Rank optional feature ideas numbered so the user can reply with numbers. Note which features chain together (cheaper picked as a group) and where schema must support them from day one even if UI comes later.

Wait for the user's decisions before Stage 2. Record every resolved decision in plan.md §1 as "already made — do not re-litigate".

## Stage 2 — Write plan.md

One file, repo root. Required sections (keep the numbering stable — prompts reference it):

1. **Decisions already made** — locked; build sessions never reopen these.
2. **Roles & object model** — the two structural anchors. Roles as a DB enum from day one; owner-type distinctions derived from what a user owns, not extra roles. Objects as one shared table + typed 1:1 detail tables. Code/DB identifiers in English; public URLs and copy in the market language; all UI strings through an i18n layer from the first commit.
3. **Feature scope** — core + approved extras, grouped by dependency chain.
4. **Autonomy protocol** — see below; copied conceptually into every prompt.
5. **Model-A phases** (usually Opus) — full task detail per phase. The COMPLETE schema is written in phase 1 even though later phases use most tables: schema is never retrofitted.
6. **Model-B phases** (usually Sonnet) — with hard limits: no schema/auth/core-logic changes; page data access only through the query layer phase A built.
7. **Human-inputs checklist** — every credential/access only the user can provide, and which phase first needs it.
8. **Open business questions** — parked, not build work.
9. **Build log & handoff** — starts empty; every phase appends before merging.
10. **Backlog** — where scope creep goes to wait.

Include a phase table in the header: phase id, model, prompt file, plan sections covered. Phase count scales with project size (a small site might be 2+2; alquilar was 4 Opus + 3 Sonnet). Right-size phases to what one session can finish comfortably — a phase that needs two sessions was two phases.

### The autonomy protocol (plan §4) — include these rules

1. Work until the phase's exit criteria all pass; never ask permission for in-plan work.
2. One PR per phase: branch `phase/<id>` off latest main; create, watch, and merge the PR when green; a red build is always the session's own work. Never start on top of an unmerged previous phase.
3. Minor non-blocking issues → `KNOWN-ISSUES.md`, keep building.
4. Stop and ask ONLY for: a missing credential with no graceful fallback, or a bad-foundation decision (schema shape, auth, money math, conflict logic) where guessing wrong forces a rewrite. Everything else: choose reasonably, record the choice in the build log, continue.
5. Missing env values never block: document in `.env.example`, degrade gracefully.
6. Every phase prompt is re-runnable: check what exists on the branch first, continue from the first unmet exit criterion.
7. Model-B hard limits (no foundation changes; workaround + Backlog note instead).
8. **Model cost guardrail** — Fable (`claude-fable-5` / Mythos-class models) is NEVER used for build phases, subagents, or spawned sessions. Phase tables only ever name Opus and Sonnet. If a session believes Fable is genuinely needed for something, it stops and asks Anton first with the reason — spawning Fable without explicit approval is treated like a destructive action, because it burns limited usage. Fable's only role in this method is the human-driven planning conversation Anton starts himself.
9. **Phase handoff** — hand off only when four gates pass: PR merged green; exit checklist passed; **pre-handoff audit** done (re-run build + verify scripts, adversarially re-read your own merged diff, fix findings — a defect merged now poisons every later phase and this is the last cheap moment to catch it); build-log entry committed. Then spawn the next phase as a NEW session via the claude-code-remote `create_session` tool: inherit environment and permission mode (never `plan` — an unattended plan-mode child stalls forever), set `model` per the phase table (this crosses the model switch automatically), `prompt` exactly `Read prompts/<next-file>.md in this repo and execute it.` Then end with the phase report. Fallback when `create_session` is unavailable (local CLI): continue in the same window if the next phase uses the same model; stop and report at a model switch.
10. **Build log**: before merging, append a 5–10 line dated entry to plan §9 — phase id + PR, what now exists, decisions/deviations, where the next phase should look first. Fresh sessions orient from plan.md + §9 + KNOWN-ISSUES.md ONLY; this log is what keeps them cheap.
11. **Merge-stall ladder** — Claude Code Remote requires explicit human approval to merge a PR even in auto permission mode; this is a platform guardrail, not something a prompt can talk around, so plan for it instead of assuming merges are self-serve. When a phase's merge is blocked: (a) try `enable_pr_auto_merge` first — if GitHub is allowed to complete the merge itself once checks pass, that's a full unblock with no human click; (b) if that's blocked too, do NOT sit silently — immediately notify the human (push notification naming the PR and the exact single action needed) and schedule a self check-in every 30–60 minutes so that the moment the PR is merged, the phase detects it and continues its handoff automatically. A blocked merge must never end as a silent stall — that is the failure mode this rule exists to prevent. Never branch the next phase off the unmerged branch as a workaround.
12. **Grant propagation** — a spawned child session can never hold a permission grant its parent didn't have, so pass merge-related tools (`merge_pull_request`, `enable_pr_auto_merge`) in `extra_allowed_tools` on every `create_session` call, and when the human is asked to approve the first phase's merge, approve with "always allow" rather than a one-off allow — that grant then flows down the whole chain, and later phases may not need a click at all.

## Stage 3 — Write the prompt files

One file per phase in `prompts/`, named `<model>-<n>-<slug>.md` (e.g. `opus-1-foundation.md`). Keep each under ~30 lines — the detail lives in plan.md; the prompt points at sections. Skeleton:

```markdown
# Phase <ID> — <name>. Paste into a fresh <MODEL> session[, ONLY after phase <prev> is merged].

Read `plan.md` FIRST, in full — plus §9 build log and `KNOWN-ISSUES.md`. Execute plan
§<sections> under the autonomy protocol §4. Build nothing outside the plan.

[Model-B phases: repeat the hard limits here explicitly.]

Phase rules:
- Branch `phase/<id>` off latest main. Previous phase unmerged ⇒ finish it first.
- Load these skills at the matching step: <list, per phase content>.
- <3–6 phase-specific bullets: the traps, the quality bars, what NOT to spend effort on>.
- Re-runnable; minor issues → KNOWN-ISSUES.md; stop only per §4.4.

Exit: <concrete, checkable criteria — build green, named tests/verify checks, PR merged>.

## After this phase — hand off to the next (fresh session)
<The handoff rule from the autonomy protocol: four gates, create_session call with next
file + model (Opus or Sonnet only — never Fable), fallback, never-hand-off conditions.>
```

The last phase of each model group gets a model-switch footer (spawn the other model / stop-and-report fallback); the final phase gets a STOP footer with the closing report (live URLs, checklist, exact numbered manual steps for the user).

Prompts must name the exit bar concretely. "Works" is not checkable; "overlap rejection test passes, owner A cannot read owner B, statement generation is idempotent" is.

## Stage 4 — Hand back to the user

Tell the user:
1. Merge the plan PR first, so phase 1 branches from a main that contains the plan.
2. What to paste and where: fresh window, phase 1's model, permission mode set to auto-accept (spawned children can never be MORE permissive than their parent — a restrictive phase-1 session strands every later phase at permission prompts).
3. The single line to paste: `Read prompts/<phase-1-file>.md in this repo and execute it.`
4. Recovery rule: if any phase's session dies or usage runs out, re-paste that phase's prompt in a fresh window — it resumes from the first unmet criterion. Find the current phase by reading plan §9 build log.
5. The human-inputs checklist (§7) and when each item is first needed.
6. Expectation-setting: worst case is one merge-approval click per phase, delivered as a push notification rather than discovered hours later as a silent stall — approve with "always allow" the first time so the grant propagates down the chain (§4 rule 12).

## After the build

When the project is live and stable, prompt the user to create a project-specific skill (like `propia-dev`) capturing final schema, routes, known issues, and do-not-touch guardrails — this skill covers the build method; project skills carry the specifics.
