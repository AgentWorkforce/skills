---
name: openclaw-orchestrator
version: 1.1.0
description: Run headless multi-agent orchestration sessions via Agent Relay. Use when spawning teams of agents, creating channels for coordination, managing agent lifecycle, and running parallel workloads across Claude/Codex/Gemini/Pi/Droid agents.
homepage: https://agentrelay.com/openclaw
metadata: { 'category': 'orchestration', 'requires': 'agent-relay' }
---

# Agent Relay Orchestrator

Run headless multi-agent sessions: start infrastructure, join a workspace, create channels, spawn teams, coordinate via messaging, and manage lifecycle.

## Prerequisites

- `agent-relay` CLI installed (`npm i -g agent-relay`)
- Agent Relay workspace key (`rk_live_...`) — get one at https://agentrelay.com/openclaw or run `agent-relay local up` to auto-create
- For Claude agents: `ANTHROPIC_API_KEY` or `claude auth login`

## Quick Reference

| Action | Command |
|--------|---------|
| Start broker | `agent-relay local up --workspace-key rk_live_KEY --no-spawn` |
| Start broker (background) | `agent-relay local up --workspace-key rk_live_KEY --background --no-spawn` |
| Check status | `agent-relay local status` |
| Spawn agent | `agent-relay local agent spawn CLI --name NAME --task "task"` |
| Spawn into a shared channel | `agent-relay local agent spawn CLI --name NAME --channels TEAM --task "task"` |
| List agents | `agent-relay local agent list` |
| View logs (debug) | `agent-relay local tail --agent NAME` |
| Send to channel (via relay) | `agent-relay message post channel 'message'` |
| Send DM (via relay) | `agent-relay message dm send AGENT 'message'` |
| Release agent | `agent-relay local agent release NAME` |
| Stop broker | `agent-relay local down` |

> Lifecycle (start/stop, spawn/release, list) is the `agent-relay local …` group.
> Messaging always goes through relay — the `agent-relay message …` group (which
> needs an agent token) or the `mcp__agent-relay__*` tools. Don't read worker
> replies off `local tail`; that's raw broker output for debugging.

## Setup Flow

### 1. Join workspace (you, the orchestrator)

```bash
npx -y @agent-relay/openclaw@latest setup rk_live_YOUR_KEY --name orchestrator
```

This registers you on the workspace and configures mcporter for channel/DM tools.

### 2. Start broker with workspace key

```bash
agent-relay local up --workspace-key rk_live_YOUR_KEY --no-spawn
```

**Critical**: Pass `--workspace-key` so spawned agents inherit the workspace connection. Without it, agents can't communicate via Agent Relay channels.

### 3. Create channels for coordination

```bash
mcporter call agent-relay create_channel name=my-project topic="Project coordination"
mcporter call agent-relay join_channel channel=my-project
```

### 4. Spawn agents

```bash
agent-relay local agent spawn claude --name architect --channels my-team --task "Your task..."
agent-relay local agent spawn claude --name developer --channels my-team --task "Your task..."
agent-relay local agent spawn claude --name tester --channels my-team --task "Your task..."
```

Agents that share a channel (`--channels my-team`) coordinate in it.

## Agent Communication

Spawned agents are registered relay participants — they message through relay's MCP tools (see the **using-agent-relay** skill).

### From spawned agents (in their task prompt)
```
# Post to channel
mcp__agent-relay__post_message(channel: "channel-name", text: "your message")

# DM another agent
mcp__agent-relay__send_dm(to: "agent-name", text: "your message")

# Check inbox
mcp__agent-relay__check_inbox()
```

### From the orchestrator (via mcporter)
```bash
mcporter call agent-relay post_message channel=my-project text="Status update"
mcporter call agent-relay list_messages channel=my-project limit=20
mcporter call agent-relay send_dm to=architect text="Review the design"
```

## Agent Types

| CLI | Use For | Notes |
|-----|---------|-------|
| `claude` | Most reliable for coding tasks | `--print --permission-mode bypassPermissions` under the hood |
| `droid` | OpenCode-based, needs PTY | Don't use `--cwd` flag (broker can't auto-accept permission prompts — see PR #570) |
| `gemini` | Google models | Use `gemini-2.5-pro` (not preview) for stability |
| `codex` | OpenAI Codex | Requires PTY |

## Task Prompt Template

Include communication instructions in every agent's task:

```
You are ROLE on the TEAM team.

## Communication
Post updates to a channel: mcp__agent-relay__post_message(channel: "channel", text: "your message")
Check for messages: mcp__agent-relay__check_inbox()
DM a teammate: mcp__agent-relay__send_dm(to: "teammate-name", text: "message")

## Your Team
- agent-a (role) — does X
- agent-b (role) — does Y

## Tasks
1. ...
2. Post progress to the channel
3. When done: openclaw system event --text 'Done: description' --mode now
```

## Monitoring

```bash
# List all agents (JSON: pid, status, uptime)
agent-relay local agent list

# Tail an agent's raw output (debug only)
agent-relay local tail --agent NAME

# Check channel conversation (via relay)
mcporter call agent-relay list_messages channel=my-project limit=20

# Check who's online (via relay)
mcporter call agent-relay list_agents status=online
```

## Lifecycle Management

```bash
# Release a stuck agent (graceful stop)
agent-relay local agent release NAME

# Release several by name
for a in architect developer tester; do agent-relay local agent release "$a"; done

# Stop everything
agent-relay local down
```

## Rate Limiting

- Add 15s gaps between sequential spawns to avoid Agent Relay 429 errors
- Use unique agent names per run (append UUID suffix) to avoid 409 conflicts
- The SDK uses `registerOrRotate` pattern: on 409, rotates the agent token

## Common Patterns

### Sequential pipeline
Spawn agent A → wait for completion → spawn agent B with A's output.

### Parallel fan-out
Spawn N agents simultaneously, each on a subtask. Monitor via channel. Collect results.

### Architect → Builder → Tester
1. Spawn architect to design
2. Architect posts to channel when done
3. Spawn builder to implement architect's design
4. Builder posts when done
5. Spawn tester to validate

### Team with shared channel
All agents join same channel, post updates, read each other's work on a shared git branch.

## Gotchas

| Issue | Fix |
|-------|-----|
| Agents can't message | Broker must have `--workspace-key` |
| Droid stuck at approval | Don't use `--cwd` with droid agents |
| Agent name conflict (409) | Use unique names or let SDK `registerOrRotate` handle it |
| Channel not found | Create it first via `mcporter call agent-relay create_channel` |
| Agent idle but no output | Check `agent-relay local tail --agent NAME` for errors |
| npx setup fails in spawned agent | Agents inherit broker's workspace — no setup needed |
| DM fails for an agent | DMs require a registered identity; broadcast to a channel with `post_message` if the recipient isn't registered |
