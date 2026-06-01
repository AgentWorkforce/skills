---
description: Scaffold a new agent-relay multi-agent workflow using the writing-agent-relay-workflows skill
argument-hint: [task description]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Create Agent-Relay Workflow

Scaffold a new multi-agent workflow that runs on the agent-relay broker. This command is harness-agnostic — works under Claude Code, Codex, OpenCode, Droid, Gemini, or any harness that supports markdown slash commands.

**Task:** $ARGUMENTS

## Instructions

1. **Load the skill.** Read the `writing-agent-relay-workflows` skill. After installation with `npx prpm install @agent-relay/writing-agent-relay-workflows`, look in the harness-managed skill locations first: `.claude/skills/writing-agent-relay-workflows/SKILL.md` or `.agents/skills/writing-agent-relay-workflows/SKILL.md`. When developing inside this repo, the same source lives at `skills/writing-agent-relay-workflows/SKILL.md`. Do not proceed without it — the SDK surface, DAG semantics, and verify-gate patterns it documents are required.

2. **Pick the orchestration pattern.** Consult the `choosing-swarm-patterns` skill. After installation with `npx prpm install @agent-relay/choosing-swarm-patterns`, look in `.claude/skills/choosing-swarm-patterns/SKILL.md` or `.agents/skills/choosing-swarm-patterns/SKILL.md`; in this repo, read `skills/choosing-swarm-patterns/SKILL.md`. Use it to select among fan-out, pipeline, hub-spoke, consensus, mesh, handoff, cascade, dag, debate, or hierarchical based on the task shape. State the chosen pattern and why in one sentence before writing code.

3. **Author the workflow.** Using the WorkflowBuilder API from the skill:
   - Define each step with explicit inputs and `{{steps.X.output}}` chaining.
   - Add a `verify` gate that fails closed on missing evidence.
   - Add the selected review-depth fresh-eyes path: `light` uses Claude review -> fix; `standard` adds final Claude review -> final fix; `deep` adds the full Codex review/fix/final-review/final-fix path after the Claude path. Default to `deep` when the task is ambiguous, production, security, billing, destructive, or broad multi-file work.
   - Make final acceptance depend on `final-review-pass-gate`, final hard validation, scoped diff evidence, and regression gates for the selected review-depth path. Never let light or standard skip deterministic proof.
   - Keep prompts model-agnostic — never hardcode a specific model name into a step's instructions.
   - Size steps so a single agent can complete them in one focused pass.

4. **Wire the team.** Define the lead + worker agents, the channel(s) they share, and the team name. Reuse names from `agent-relay agents` only after checking for collisions.

5. **Provide a runnable example.** Output one minimal end-to-end example that demonstrates feeding `$ARGUMENTS` into the workflow and shows the expected `{{steps.*.output}}` shape at each stage.

6. **Verify the `agent-relay` CLI is available.** Before recommending any dry-run or launch command, confirm the runtime that will execute the workflow is installed:
   ```bash
   command -v agent-relay || npx agent-relay --version
   ```
   If neither resolves, note that it must be installed (`npm install -g agent-relay`, or invoke via `npx agent-relay …`) and surface that in the integration notes rather than assuming it is present.

7. **Integration notes.** End with a short checklist for wiring into the existing workload-router (where the workflow file lives, how it's registered, how to dry-run, how to launch via `agent-relay`).

## Output Contract

- The workflow source file (TypeScript or YAML — match the surrounding repo convention).
- A one-paragraph summary: pattern chosen, agent roster, verify gate, selected review depth, and review/fix path.
- Integration checklist (5 bullets max).

## Constraints

- Model-agnostic prompts only. No "use claude-opus" or "use gpt-5" inside step instructions.
- Verify gates must check evidence (artifacts, test results, file contents), not self-reports.
- Review fix steps must harden fixes with appropriate tests, fixtures, assertions, or deterministic proof commands whenever the finding is testable.
- Final acceptance, commit, PR creation, or handoff must depend on the selected review-depth path plus final deterministic gates, not directly on implementation or an informal lead review.
- Do not invent SDK APIs — if the skill doesn't document it, ask before adding.
