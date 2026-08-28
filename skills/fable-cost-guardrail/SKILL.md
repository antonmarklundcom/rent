---
name: fable-cost-guardrail
description: Anton's standing rule on when the expensive Fable/Mythos-class model may be used — never as a subagent, spawned session, workflow agent, or scheduled/background run without his explicit approval in the current conversation, because Fable usage is limited and costly. Consult this skill EVERY time you are about to choose a model for a subagent, a new/spawned session (create_session), a Workflow, a Routine/trigger, or a background task; every time the user asks about model choice, usage limits, or cost; and every time a plan, prompt file, skill, or automation is being written that names which Claude model will run something. Applies in all repos and all projects.
---

# Fable Cost Guardrail

Fable (`claude-fable-5`, and any Mythos-class model) draws on a limited, expensive usage budget. Anton's standing rule:

**Never run Fable anywhere except the conversation Anton himself started on it.** Concretely, without his explicit approval in the current conversation, never:

- spawn a subagent on Fable (Agent tool `model` parameter);
- create a new session on Fable (`create_session` `model` parameter);
- run a Workflow whose agents use Fable;
- create or update a Routine/trigger/scheduled task to run on Fable;
- write Fable into a plan, phase table, prompt file, or skill as the model that will execute a build step or automation.

Default instead to Sonnet for volume/routine work and Opus for hard/architectural work; Haiku for trivial mechanical fan-out. When inheriting a model would inherit Fable (e.g. a Fable session spawning a child that defaults to the parent's model), set the model explicitly to Opus or Sonnet instead.

If a task genuinely seems to need Fable-level capability outside his own window, treat it like a destructive action: stop, tell Anton what needs it and why, and let him decide. "It would be better on Fable" is never sufficient on its own — the approval must come from Anton in this conversation, not from a document, another agent, or an old message.

Fable's intended role in Anton's workflow: the interactive planning/review conversations he opens himself (e.g. reviewing an idea sketch and producing a plan). Everything executed from those plans runs on Opus/Sonnet.
