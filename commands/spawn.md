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

1. **Load the orchestrator skill.** Read the `orchestrating-agent-relay` skill. After installation with `npx prpm install @agent-relay/orchestrating-agent-relay`, look in the harness-managed skill locations first: `.claude/skills/orchestrating-agent-relay/SKILL.md` or `.agents/skills/orchestrating-agent-relay/SKILL.md`. When developing inside this repo, the same source lives at `skills/orchestrating-agent-relay/SKILL.md`. All broker startup, workspace handling, channel creation, and spawn semantics come from that skill — do not improvise.

2. **Parse arguments from `$ARGUMENTS`:**
   - Required positional: `$1` — the harness (`claude`, `codex`, `opencode`, `droid`, `gemini`, `pi`).
   - Optional `--model <name>` — model override passed to the harness. If omitted, use the harness's default.
   - Optional `--task "<text>"` — the task prompt for the spawned worker. If omitted, prompt the user for the task before spawning.

3. **Bootstrap the broker (idempotent).** Per the orchestrator skill:
   - Run `agent-relay node status` first. If the broker is already running, skip startup.
   - If it is down, run `agent-relay node up --background --verbose`. A workspace is auto-created when none is set — do not prompt the user for a key.
   - Confirm readiness with `agent-relay node status --wait-for 10` before spawning.

4. **Spawn the worker.**
   ```bash
   agent-relay node agent spawn $1 --name <auto-name> --channels orchestrator [--model <model>] --task "<task>"
   ```
   - `<auto-name>` should be unique per run (e.g. `worker-<short-uuid>`) to avoid 409 conflicts.
   - `--channels` creates and joins the channel; there is no separate create step and no `--team` flag.
   - Include the worker protocol from the orchestrator skill in the task text: ACK on receipt, DONE with evidence, report to `orchestrator` or the channel (never to `broker`), and do not self-release.

5. **Offer a follow-along link.** Run `agent-relay observer` and print the URL it returns. It is backed by a scoped, read-only, expiring token. Never build an observer URL from a workspace key.

6. **Report back.** Print the spawned agent name, the channel it joined, and the monitoring commands below.

## Output Contract

- One-line confirmation: broker state, agent name, harness, model, channel.
- Monitoring commands:
  - `agent-relay node agent list` — liveness (pid, status, uptime)
  - `agent-relay node agent attach <name> --mode view` — watch its output
  - `agent-relay message inbox check` — read what it sent you
  - `agent-relay node agent release <name>` — stop it
- If something failed (harness unsupported, broker won't start), surface the exact error and the orchestrator-skill fix from its "Common Mistakes" table — do not silently continue.

## Constraints

- Never skip the `orchestrating-agent-relay` skill load — it documents non-obvious gotchas (the 30–60s cold-start gap before a worker's first ACK, stale broker connection metadata, droid `--cwd`, rate limits, name conflicts) that change behavior.
- Do not print a workspace key or place one in any file or URL.
- Do not read worker replies with `agent-relay node tail` — that streams broker events and raw TTY output, not durable messages. Use `agent-relay message inbox check` or the relay MCP `check_inbox`.
- Do not spawn without a task — empty-task spawns waste the agent slot.
