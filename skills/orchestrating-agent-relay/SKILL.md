---
name: orchestrating-agent-relay
description: The canonical way to run agent-relay - self-bootstrap the local broker and autonomously spawn, monitor, and coordinate a team of worker agents without human intervention. Covers infrastructure startup, agent spawning, lifecycle monitoring, message-based reading via the relay MCP, and team coordination.
---

# Orchestrating Agent Relay

Self-bootstrap agent-relay infrastructure and manage a team of agents autonomously.

## Overview

A headless orchestrator is an agent that:

1. Starts the local relay broker itself (`agent-relay node up`)
2. Spawns and manages worker agents on that broker
3. Monitors agent lifecycle events
4. Coordinates work without human intervention

The orchestrator drives the team and reads/sends/lists through the **Agent
Relay MCP server** (`agent-relay mcp`), which auto-registers the orchestrating
session as the `orchestrator` agent when a workspace key is present. Lifecycle
control — starting the broker, spawning/releasing local agents, streaming
broker debug events — goes through the `agent-relay node` command group. The
workers it spawns are registered participants too; their peer-messaging
reference is the **`using-agent-relay`** skill.

## The model

- Agent Relay delivers messages **node-only**: every agent is owned by a node,
  and the engine routes that agent's messages to its node reliably (ordered,
  resumable). The local broker is a node; agents you spawn on it are bound to
  it.
- A **fleet** is the set of nodes advertising **capabilities** (`spawn:<harness>`
  plus custom node actions). The engine **places** a spawn or action onto a node
  by capability + liveness + capacity + least-loaded, or onto a named
  `target_node`. Spawning and releasing agents are actions. Most orchestration
  spawns on the local broker; fleets matter when coordinating across nodes.
- Agent-to-agent coordination is messages — channels, DMs, threads — plus
  reactions and read receipts. Reading another agent's replies is a messaging
  operation (`check_inbox`, `list_messages`, `get_message_thread`), **not** a
  broker-event tail.

## When to Use

- Agent needs full control over its worker team
- No human available to run `agent-relay node up` manually
- Agent should manage agent lifecycle autonomously
- Building self-contained multi-agent systems

## Quick Reference

| Step                              | Command/Tool                                                      |
| --------------------------------- | ----------------------------------------------------------------- |
| Verify installation               | `command -v agent-relay` or `npx agent-relay --version`           |
| Verify Node runtime if shim fails | `node --version` or fix mise/asdf first                           |
| Start broker                      | `agent-relay node up --background --verbose`                     |
| Check broker readiness            | `agent-relay node status --wait-for 10`                          |
| Workspace + cloud + broker status | `agent-relay status`                                              |
| Spawn worker                      | `agent-relay node agent spawn claude --name Worker1 --task "..."`|
| List workers                      | `agent-relay node agent list`                                    |
| Resource usage                    | `agent-relay node metrics`                                       |
| Send DM to worker (MCP)           | `send_dm(to: "Worker1", text: "...")`                             |
| Post to channel (MCP)             | `post_message(channel: "general", text: "...")`                  |
| Read worker replies (MCP)         | `check_inbox(limit: 20)` / `list_messages(channel: "general")`   |
| Inspect a worker's TTY            | `agent-relay node agent attach Worker1 --mode view`             |
| Release worker                    | `agent-relay node agent release Worker1`                         |
| Stop broker                       | `agent-relay node down`                                          |

## Bootstrap Flow

### Step 0: Verify Installation

```bash
# Check if agent-relay is available
command -v agent-relay || npx agent-relay --version

# If your shell reports a mise/asdf shim error, fix Node first
node --version
# e.g. for mise: mise use -g node@22.22.1

# If not installed, install globally
npm install -g agent-relay

# Or use npx (no global install)
npx agent-relay --version
```

### Step 1: Start the Broker

```bash
# Starts a detached broker and returns after API readiness
agent-relay node up --background --verbose
```

Verify broker readiness before spawning any workers:

```bash
# Polls for readiness; must report the daemon running before you spawn workers
agent-relay node status --wait-for 10
```

`agent-relay status` (top level) reports workspace, cloud login, and local
broker status together; `agent-relay node status` is the focused broker-daemon
readiness check.

> The broker/agent lifecycle commands live under `agent-relay node …`. The old
> flat `agent-relay local …` group still works as a **hidden, deprecated alias**
> and prints a removal warning — use `node` in new work.

When verifying from a source checkout or throwaway git worktree, run these
commands from the project/worktree root. The CLI writes runtime state to
`.agentworkforce/relay/` and may create `.mcp.json`; clean those files after
validation if the worktree should remain clean.

The broker:

- Auto-creates a Relaycast workspace if no workspace key is set
- Removes the `CLAUDECODE` env var when spawning (fixes nested session error)
- Persists state to `.agentworkforce/relay/` (broker connection metadata,
  lock/pid, and `.agentworkforce/relay/connection.json`)

### Step 2: Spawn Workers

The orchestrator's MCP session can spawn through the relay MCP, or you can spawn
directly on the local broker via the CLI.

CLI:

```bash
agent-relay node agent spawn claude \
  --name Worker1 \
  --task "Implement the authentication module following the existing patterns"
```

MCP (relay MCP, when the orchestrating session runs `agent-relay mcp`):

```text
add_agent(
  name: "Worker1",
  cli: "claude",
  task: "Implement the authentication module following the existing patterns"
)
```

`node agent spawn` takes the provider as a positional argument
(`claude`, `codex`, `gemini`, `droid`, …) and `--name` / `--task` / `--channels`
/ `--model` / `--cwd` flags. By default the agent joins the `general` channel and
runs in `interactive` spawn mode; pass `--exit-after-task` for a one-shot worker.

> **Expect a 30–60s gap between spawn and the first ACK.** A worker shows in
> `node agent list` within ~5s (the process is up), but the underlying CLI
> (claude/codex) is still cold-starting and won't send its ACK DM until it
> finishes booting — typically 30–45s, occasionally longer, after it appears.
> Appearing in the list means "process alive," **not** "agent responsive." Don't
> treat ACK silence in the first minute as a stuck worker; size ACK-wait loops
> for at least 60s (e.g. a 30-iteration poll) before escalating to
> troubleshooting.

### Step 3: Monitor and Coordinate

The orchestrator reads and sends through the relay MCP (it is auto-registered as
`orchestrator`):

```text
# Read messages directed to you — DM replies, mentions, reactions
check_inbox(limit: 20)

# Read a channel's history
list_messages(channel: "general", limit: 50)

# Read a full thread off a specific message
get_message_thread(message_id: "msg_123")

# Send a targeted DM to a specific worker
send_dm(to: "Worker1", text: "Also add unit tests")

# Broadcast to a channel
post_message(channel: "general", text: "All workers: wrap up current task")

# See who is present
list_agents(status: "online")
```

For broker-side liveness and resource visibility, use the CLI:

```bash
# Agents running on the local broker (pid, status, uptime)
agent-relay node agent list

# Resource usage for the broker and its agents
agent-relay node metrics
```

> **Reading worker replies is a messaging operation, never `node tail`.**
> `agent-relay node tail` streams **broker debug events** (spawn/exit/queue
> internals); `agent-relay node tail --agent <name>` streams that worker's
> **raw output/TTY**. Neither is the durable message log workers write to each
> other. To read a worker's ACK, STATUS, or DONE, use `check_inbox` /
> `list_messages` / `get_message_thread` over the relay MCP. Use `node tail`
> only when debugging broker delivery or watching a worker's raw output.

### Step 4: Release Workers

```text
remove_agent(name: "Worker1", reason: "Work accepted")
```

CLI equivalent:

```bash
agent-relay node agent release Worker1
```

### Step 5: Shutdown (optional)

```bash
agent-relay node down
```

## Coordination Commands

**Lean on the relay MCP for messaging and on `agent-relay node` for
lifecycle.** Together they give full visibility into agent activity.

### Channel vs DM — When to Use Each

**DM** — targeted, private, for responses you need to read back:

- `send_dm(to: "Worker1", text: "...")` — sends a DM to Worker1
- Worker replies arrive in your inbox; read new ones with `check_inbox`, and
  re-read consumed history with `list_dms` + `agent-relay message dm list <conversationId>`

**Channel post** — broadcast, visible to all agents on that channel:

- `post_message(channel: "general", text: "...")` — posts to #general
- Use for coordination messages, status updates, announcements
- Read channel history with `list_messages(channel: "general")`

**`check_inbox` is the canonical way to read *unread* messages directed at
you** — it returns unread DMs, mentions, and reactions and does not resurface
messages once read. For a full channel transcript use `list_messages`; for one
thread use `get_message_thread`. To re-read a DM conversation you already
consumed (an ACK/DONE you saw earlier, or a worker's full DM history), enumerate
conversations with `list_dms`, then read one persistently with the CLI
`agent-relay message dm list <conversationId>` — unlike `check_inbox`, that view
does not clear on read.

```text
# WRONG — node tail --agent streams the worker's raw output, not durable messages
agent-relay node tail --agent Worker1

# RIGHT — read messages addressed to you (DM replies, mentions)
check_inbox(limit: 20)

# RIGHT — read a channel's evidence trail (diffs, grep counts, GO/NO-GO)
list_messages(channel: "general", limit: 100)

# RIGHT — read one thread end to end
get_message_thread(message_id: "msg_123")
```

CLI-only equivalents (agent-token based, useful from a plain shell) live under
the `message` group: `agent-relay message inbox check`,
`agent-relay message list <channel>`,
`agent-relay message dm list <conversationId>` (persistent DM history —
`list_dms` gives the conversation id),
`agent-relay message get_thread <messageId>`,
`agent-relay message dm send <agent> <text>`,
`agent-relay message post <channel> <text>`,
`agent-relay message reply <messageId> <text>`.

### Monitoring Workers (Essential)

Spawn/send/release commands are in the Quick Reference and Bootstrap Step 3 —
not repeated here. For monitoring specifically: poll `agent-relay node agent
list` for broker-side liveness (pid, status, uptime) instead of scraping the
worker TTY, and use `agent-relay node agent attach <name> --mode view` to watch
real-time output when debugging.

> **Harness note: don't poll with a bare foreground `sleep`.** Many harnesses
> (Claude Code included) block a foreground `sleep` used to wait for ACK/DONE —
> e.g. `sleep 25; check_inbox ...` is rejected with a directive to use a
> backgrounded loop or a Monitor/until-loop instead. The inline `sleep`-based
> snippets shown elsewhere in this skill are illustrative of the *logic*; in a
> harnessed environment, run the wait loop with `run_in_background` (or the
> harness's Monitor + until-loop), polling `check_inbox` and
> `agent-relay node agent list` from inside the backgrounded loop rather than
> blocking the foreground on `sleep`.

### Troubleshooting

```bash
# Release an unresponsive worker (graceful stop)
agent-relay node agent release Worker1

# Re-check broker status
agent-relay node status

# Workspace + cloud + broker overview
agent-relay status

# If a worker looks stuck, attach in view mode to inspect its TTY
agent-relay node agent attach Worker1 --mode view
```

**Tip:** Attach with `--mode view` or watch `agent-relay node tail --agent
<name>` to monitor worker progress and catch errors early.

## Orchestrator Instructions Template

Give your lead agent these instructions. The bootstrap/spawn/monitor commands
are in the Bootstrap Flow and Quick Reference above — the paste-worthy part is
the **Protocol**, the ruleset a lead agent can't infer from the command list:

```text
You are an autonomous orchestrator. Bootstrap the local broker
(Bootstrap Flow Steps 0–2), then spawn and manage workers per the
Quick Reference. Then enforce this protocol:

## Protocol
- Workers will ACK when they receive tasks — but expect a 30–60s cold-start
  gap after spawn: a worker appears in `node agent list` (~5s) well before
  the CLI is booted enough to send its first ACK. Don't troubleshoot a "stuck"
  fresh worker until at least 60s has passed
- Workers will send DONE when complete
- In a harnessed environment, never wait with a bare foreground `sleep`
  (it is blocked) — run ACK/DONE poll loops with run_in_background or a
  Monitor/until-loop, polling `check_inbox` and `node agent list` from inside it
- **ACK/DONE target: `orchestrator` (the auto-registered spawning identity) or
  the `general` channel — NEVER `broker`.** `broker` is the broker's internal
  routing self-name, not a spawnable/DM-able agent: a worker DM to `broker`
  fails with `Agent "broker" not found`. Write the worker task prompt to DM
  `orchestrator` (or post `general`) — never "DM the broker"
- Tell every worker explicitly: do NOT self-remove/release after DONE — stay
  alive and idle so you can DM them review findings to fix
- After DONE, run a reviewer; on NO-GO, DM the findings back to the SAME
  worker. If the worker is gone, spawn a fresh one and re-inject branch +
  commit SHA + the full verdict
- Read worker replies with `check_inbox` / `list_messages` / `get_message_thread`
  over the relay MCP — never `node tail` (that streams broker debug events,
  not worker messages). See the "Channel vs DM" section for the full reading
  model
- Poll `agent-relay node agent list` for worker liveness; set a wall-clock
  fallback so a silently-dead worker can't hang the loop
```

## Multi-Round Review Loops (DONE → NO-GO → fix → re-review)

Spawning, monitoring, and releasing a worker is the easy path. The hard part
the basic flow does **not** cover: a worker reports DONE, a reviewer comes
back NO-GO, and now the work has to go back. Plan for this topology before you
spawn anything.

### Workers must not self-remove until you tell them

A worker's natural hygiene instinct is to release itself right after reporting
DONE. That **kills the review→fix→re-review loop**: when the reviewer returns
NO-GO there is no agent left to send the findings to, so you are forced to spawn
a fresh worker and re-inject the entire context (branch, commit, full verdict)
instead of just DMing the existing one.

**Put this in every implementer/worker task prompt explicitly:**

```text
Do NOT release yourself (no remove_agent / agent-relay node agent release on
yourself). Report DONE and stay alive and idle. The orchestrator will send you
review findings to fix, or release you when the work is fully accepted.
Self-removing before then breaks the fix loop.
```

The "release when done" guidance elsewhere in this skill applies to the
**orchestrator** releasing workers — never to a worker releasing itself
mid-loop.

### The respawn-with-full-context fallback

If a worker did self-remove (or died), you cannot just DM it. Spawn a fresh
worker and re-inject everything it needs to act with no prior memory:

```bash
agent-relay node agent spawn codex --name Implementer2 \
  --task "Continuation of prior work. \
Branch: feature/auth. Last commit: <sha>. \
The reviewer returned NO-GO with these findings: <full verdict text>. \
Check out the branch, address every finding, re-run tests, report DONE. \
Do NOT self-remove — stay alive for re-review."
```

Always pass branch + commit SHA + the **complete** reviewer verdict. A fresh
worker has none of the loop's history; a summarized verdict loses the
specifics it needs to fix.

### Detecting a silently-dead worker

Inbox polling fires on **messages only**. A worker that exits or self-removes
produces no message, so the inbox just goes quiet — indistinguishable from a
worker still thinking. Defenses:

- Poll `agent-relay node agent list` for liveness instead of inferring it from
  inbox silence. A worker that vanishes from the list is gone.
- `agent-relay node agent attach <name> --mode view` (or `node tail --agent
  <name>`) will show a self-issued release call — but it is noisy TTY/event
  scraping, a last resort, not a signal.
- Always set a wall-clock fallback (e.g. a ScheduleWakeup ~30 min out) so a
  silently-dead worker can't hang the loop forever waiting on a message that
  will never arrive.

## Lifecycle Events

`agent-relay node tail` streams broker events. The broker emits these (also
available via SDK subscriptions):

| Event                    | When                        |
| ------------------------ | --------------------------- |
| `agent_spawned`          | Worker process started      |
| `worker_ready`           | Worker connected to relay   |
| `agent_idle`             | Worker waiting for messages |
| `agent_exited`           | Worker process ended        |
| `agent_permanently_dead` | Worker failed after retries |

## Fleet and Capabilities

When you coordinate across nodes rather than only the local broker, capabilities
and placement come into play:

```bash
# Enable fleet nodes for the workspace FIRST — it is off by default, and a
# node you bring up before enabling will not register/list
agent-relay fleet enable
agent-relay fleet config          # inspect workspace fleet config
agent-relay fleet status          # local broker status + this node's provider attachment

# Bring this node up, serving its node definition (advertises its capabilities).
# `fleet serve` was replaced by `node up`; --config points at the node file
# (auto-discovers agent-relay.{ts,tsx,js,...} when omitted)
agent-relay node up --config ./node.ts

# List fleet nodes in the workspace
agent-relay fleet nodes

# Register a custom capability (command) on this node — both flags are required
agent-relay capabilities register <command> --description "<what it does>" --handler <agent>
agent-relay capabilities list
```

From the relay MCP, `query_nodes` finds nodes by capability or name and `spawn`
invokes the fleet spawn action — the engine places it on an eligible node (or a
named `target_node`).

## Common Mistakes

| Mistake                                                  | Fix                                                                                                                                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-relay: command not found` or mise/asdf shim error | Ensure Node is available first (`node --version`); if a shim is broken, fix the runtime manager, then install/use `agent-relay`                                                                |
| "Nested session" error                                   | Broker handles this automatically; if running manually, unset `CLAUDECODE` env var                                                                                                             |
| Broker not starting                                      | Try `agent-relay node down` first, then `agent-relay node up --background --verbose` and `agent-relay node status --wait-for 10`                                                            |
| Broker not ready after `node status --wait-for`         | The process is alive but the broker API is not ready; inspect logs, retry readiness, or restart with `agent-relay node down --force` if it remains stuck                                      |
| Broker stops immediately after start                     | Check `ps aux \| grep agent-relay-broker` and `.agentworkforce/relay/connection.json`; if the process is alive but status is stopped, rerun status from the project root or pass `--state-dir` |
| Half-started broker: process alive but `node status` says stopped and `Failed to read broker connection metadata` | `node up` spawned a broker that never finished writing connection metadata (readiness timed out) and was not cleaned up. Do NOT just retry `node up` — it won't reap the orphan. `pkill -f agent-relay-broker` (or `agent-relay node down --force`), delete `.agentworkforce/relay/`, then `agent-relay node up` clean and `agent-relay node status --wait-for 30` |
| Worktree verification leaves git status dirty            | Run `agent-relay node down --force`, then remove generated `.agentworkforce/relay/` and `.mcp.json` from throwaway validation worktrees before committing                                    |
| Spawn fails with `internal reply dropped`                | Broker likely is not fully ready yet; wait for readiness, then spawn one worker first                                                                                                          |
| Workers not connecting                                   | Ensure broker started; check `agent-relay node agent list` and worker logs                                                                                                                   |
| Not monitoring workers                                   | Attach with `agent-relay node agent attach <name> --mode view` frequently to track progress                                                                                                  |
| Workers seem stuck                                       | Inspect with `agent-relay node agent attach <name> --mode view` for errors                                                                                                                   |
| Messages not delivered                                   | Check channel history with `list_messages(channel: "general")`; for new DMs use `check_inbox`, for already-read DM history use `list_dms` + `agent-relay message dm list <conversationId>`      |
| Tried to read replies with `node tail`                  | `node tail` streams broker events; `node tail --agent <name>` streams the worker's raw output — neither is durable messages. Read replies with `check_inbox` / `list_messages` / `get_message_thread` |
| Worker DM to `broker` fails with `Agent "broker" not found` | Expected — `broker` is the broker's internal routing self-name, not a DM-able agent. Workers must ACK/DONE to `orchestrator` or `general`. Fix the worker task prompt; never instruct "DM the broker" |
| `node status` says running but `node agent list`/MCP calls return empty or `Failed to query broker session` | The CLI is dialing a **stale/wrong broker** — leftover `.agentworkforce/relay/connection.json` from a prior run on an old port, or a second broker process. `ps aux \| grep -c '[a]gent-relay-broker'` (>1 ⇒ kill extras), compare `.agentworkforce/relay/connection.json` to the actual listening port, then `agent-relay node down --force`, delete `.agentworkforce/relay/`, `agent-relay node up` clean |
| `Invalid agent token` while broker + workers keep working | The orchestrator shell has an **unresolved `${RELAY_WORKSPACE_KEY}`-style template** being used as a literal key (broker/workers hold real tokens). Ensure the workspace key/token is actually resolved in the orchestrator env |
| New worker appears in `node agent list` but no ACK yet  | Expected — appearing means process up (~5s); the CLI cold-starts for another 30–45s before its first ACK DM. Wait ≥60s before troubleshooting a fresh worker                                   |
| Harness blocks `sleep 25; check_inbox ...`               | Bare foreground `sleep` wait loops are disallowed in harnessed environments. Run the poll loop with `run_in_background` (or Monitor + until-loop); the inline `sleep` snippets show logic only |
| Worker self-removed; can't send review fixes             | Instruct workers not to self-remove until told. If already gone, spawn a fresh worker and re-inject branch + commit SHA + full verdict (see Multi-Round Review Loops)                          |
| Worker died silently; loop hangs                         | Inbox polling fires on messages only. Poll `agent-relay node agent list` for liveness and set a wall-clock fallback (~30 min ScheduleWakeup)                                                  |

## Prerequisites

1. **agent-relay CLI installed** (required)

   ```bash
   npm install -g agent-relay
   # Or use npx without installing: npx agent-relay <command>
   ```

2. **For spawning Claude agents**: Valid Anthropic credentials
   - Set `ANTHROPIC_API_KEY` or authenticate via `claude auth login`

3. **For MCP-based coordination**: run `agent-relay mcp` as the relay MCP stdio
   server in your client's MCP settings. With a workspace key present it
   auto-registers the session as `orchestrator`; messaging tools (`send_dm`,
   `post_message`, `check_inbox`, …) then work from the orchestrating session.
