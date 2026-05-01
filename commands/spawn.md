---
description: Bootstrap the agent-relay broker and spawn a worker on the chosen harness using the orchestrator skill
argument-hint: <harness> [--model MODEL] [--task TASK]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Spawn a Relay Worker

Bootstrap the agent-relay broker (if not already running) and spawn a worker on `$1`. The orchestrator skill handles infrastructure, channel setup, and lifecycle so this command "just works" once invoked.

**Harness:** `$1` (claude | codex | opencode | droid | gemini | pi)
**Args:** $ARGUMENTS

## Instructions

1. **Load the orchestrator skill.** Read the `running-headless-orchestrator` skill (installed via `npx prpm install @agent-relay/running-headless-orchestrator`, or read `skills/running-headless-orchestrator/SKILL.md` in this repo). All broker startup, workspace key handling, channel creation, and spawn semantics come from that skill — do not improvise.

2. **Parse arguments from `$ARGUMENTS`:**
   - Required positional: `$1` — the harness (`claude`, `codex`, `opencode`, `droid`, `gemini`, `pi`).
   - Optional `--model <name>` — model override passed to the harness. If omitted, use the harness's default.
   - Optional `--task "<text>"` — the task prompt for the spawned worker. If omitted, prompt the user for the task before spawning.

3. **Bootstrap the broker (idempotent).** Per the orchestrator skill:
   - Run `agent-relay status` first. If broker is up, skip startup.
   - If down, ensure a workspace key is available (`$RELAYCAST_WORKSPACE_KEY` or prompt the user). Then `agent-relay up --workspace-key $KEY --background --no-spawn`.
   - Verify broker came up cleanly before spawning.

4. **Ensure a coordination channel exists.** Default to `#orchestrator` unless the user specified one. Create it via `mcporter call relaycast create_channel` if missing, then join it.

5. **Spawn the worker.** Construct the spawn command from parsed args:
   ```
   agent-relay spawn <auto-name> $1 [--model <model>] [--team orchestrator] "<task>"
   ```
   - `<auto-name>` should be unique per run (e.g., `worker-<short-uuid>`) to avoid 409 conflicts.
   - Inject the standard task-prompt template from the orchestrator skill (channel posting, inbox checks, completion event) so the worker can communicate.

6. **Report back.** Print the spawned agent name, the channel it joined, and the tail command (`agent-relay agents:logs <name>`) so the user can monitor it.

## Output Contract

- One-line confirmation: broker state, agent name, harness, model, channel.
- Monitoring commands (logs, channel messages, kill).
- If something failed (workspace key missing, harness unsupported, broker won't start), surface the exact error and the orchestrator-skill fix from its "Gotchas" table — do not silently continue.

## Constraints

- Never skip the `agent-relay-orchestrator` skill load — it documents non-obvious gotchas (droid `--cwd`, rate limits, name conflicts) that change behavior.
- Do not hardcode workspace keys in any output or file.
- Do not spawn without a task — empty-task spawns waste the agent slot.
