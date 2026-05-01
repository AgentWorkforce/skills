---
description: Scaffold a new agent-relay multi-agent workflow using the writing-agent-relay-workflows skill
argument-hint: [task description]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Create Agent-Relay Workflow

Scaffold a new multi-agent workflow that runs on the agent-relay broker. This command is harness-agnostic — works under Claude Code, Codex, OpenCode, Droid, Gemini, or any harness that supports markdown slash commands.

**Task:** $ARGUMENTS

## Instructions

1. **Load the skill.** Read the `writing-agent-relay-workflows` skill (installed via `prpm install @agent-relay/writing-agent-relay-workflows`, or read directly from `skills/writing-agent-relay-workflows/SKILL.md` in this repo). Do not proceed without it — the SDK surface, DAG semantics, and verify-gate patterns it documents are required.

2. **Pick the orchestration pattern.** Consult the `choosing-swarm-patterns` skill (`@agent-relay/choosing-swarm-patterns`) to select among fan-out, pipeline, hub-spoke, consensus, mesh, handoff, cascade, dag, debate, or hierarchical based on the task shape. State the chosen pattern and why in one sentence before writing code.

3. **Author the workflow.** Using the WorkflowBuilder API from the skill:
   - Define each step with explicit inputs and `{{steps.X.output}}` chaining.
   - Add a `verify` gate that fails closed on missing evidence.
   - Keep prompts model-agnostic — never hardcode a specific model name into a step's instructions.
   - Size steps so a single agent can complete them in one focused pass.

4. **Wire the team.** Define the lead + worker agents, the channel(s) they share, and the team name. Reuse names from `agent-relay agents` only after checking for collisions.

5. **Provide a runnable example.** Output one minimal end-to-end example that demonstrates feeding `$ARGUMENTS` into the workflow and shows the expected `{{steps.*.output}}` shape at each stage.

6. **Integration notes.** End with a short checklist for wiring into the existing workload-router (where the workflow file lives, how it's registered, how to dry-run, how to launch via `agent-relay`).

## Output Contract

- The workflow source file (TypeScript or YAML — match the surrounding repo convention).
- A one-paragraph summary: pattern chosen, agent roster, verify gate.
- Integration checklist (5 bullets max).

## Constraints

- Model-agnostic prompts only. No "use claude-opus" or "use gpt-5" inside step instructions.
- Verify gates must check evidence (artifacts, test results, file contents), not self-reports.
- Do not invent SDK APIs — if the skill doesn't document it, ask before adding.
