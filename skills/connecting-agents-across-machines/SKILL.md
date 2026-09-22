---
name: connecting-agents-across-machines
description: "Use when agents running on two or more machines (laptops, desktops, Mac minis, servers) need to talk to each other or when you want to spawn an agent onto another machine with Agent Relay. Covers putting every machine on one shared workspace, starting a node per machine, messaging across machines, targeted spawns, and verifying the link agent-to-agent. No Relay Cloud sandbox required. Verified on agent-relay 12.4.1."
---

# Connecting Agents Across Machines

Agent Relay coordinates agents through a **workspace**. Agents on different
machines that share the same workspace can use the same DMs, channels, threads
and inbox, no matter which machine they run on. Each machine runs its own
**node** (a local broker). The node connects to the workspace and hosts the
agents on that machine.

```
 Machine A                          Machine B
 ┌──────────────────────┐           ┌──────────────────────┐
 │ agent-relay node up  │           │ agent-relay node up  │
 │  ├─ Lead (claude)    │           │  ├─ Worker (codex)   │
 │  └─ Reviewer         │           │  └─ Tester           │
 └──────────┬───────────┘           └──────────┬───────────┘
            └──────── same workspace key ──────┘
                 (messages, channels, spawns)
```

You don't need a Relay Cloud sandbox for this. Your own machines are the
nodes.

> Verified end to end on `agent-relay` 12.4.1 between a MacBook and a Mac
> mini: a Codex agent on the mini sent a DM to a Claude agent on the laptop,
> and the reply came back. Everything below is the exact sequence that
> worked.

Run every command from the **same project directory** on each machine.
`workspace create` / `join` pin the workspace to that directory
(`.agentworkforce/relay/workspace-key.json`), and `node up` reads that pin.

## Setup (once)

### 1. Create the workspace on one machine

On **machine A**:

```bash
npm install -g agent-relay
agent-relay workspace create my-team --reveal-secrets
```

The output includes a `workspaceKey`. Treat it like a password. Send it to
machine B over a secure channel such as a password manager or an encrypted
DM, not a public chat, ticket or repo.

### 2. Join the same workspace on every other machine

On **machine B**, and on any further machines:

```bash
npm install -g agent-relay
agent-relay workspace join my-team <workspaceKey>
```

> **Do not skip this step.** If `node up` runs on a machine with no workspace
> configured, it can silently create a **new** workspace. Both nodes then look
> healthy but can't see each other. Run `join` first on every machine after
> the first.

### 3. Start a node on each machine

Give each machine a distinct, stable name:

```bash
# machine A
agent-relay node up --background --broker-name laptop-a
# machine B
agent-relay node up --background --broker-name mini-b
```

Every AI CLI you want to run on a machine (`claude`, `codex`, …) must be
installed **and logged in on that machine**. Relay starts the CLI but can't
log in for it. An expired login shows up as an agent that starts and then
does nothing.

Stop a node with `agent-relay node down`, not by killing the process. A
killed node can leave its name reserved.

## Verify the link

From either machine:

```bash
agent-relay workspace list        # both machines should show the same active workspace
agent-relay fleet nodes           # both node names listed, status "online"
agent-relay fleet agent list      # agents across every reachable node
```

To prove messaging works end to end, put one agent on each machine and have
the remote one write to the local one. Run both commands from machine A:

```bash
agent-relay fleet spawn claude --node laptop-a --name Receiver --no-confirm \
  --task "Wait for a DM from Sender. Write its exact text to ./received.txt, reply 'got it', and stop."

agent-relay fleet spawn codex --node mini-b --name Sender --no-confirm \
  --task "Run 'hostname', then DM Receiver exactly: hello from <hostname output>. Wait for the reply and stop."
```

Within a couple of minutes, `received.txt` on machine A should contain
`hello from <machine B's hostname>`. Clean up:

```bash
agent-relay fleet release Sender
agent-relay fleet release Receiver
```

> **Confirm a spawn by checking the target machine, not by the CLI's exit
> code.** A targeted spawn can print `spawn_failed` or `spawn_unconfirmed`
> even though the agent launched fine. Before retrying, run
> `agent-relay node agent list` **on the target machine**. If the agent is
> there with `"ready": true`, it's running. A blind retry can start a
> duplicate. `--no-confirm` skips the wait and returns once the node accepts
> the spawn.

## Everyday use

**Spawn onto a specific machine**, for example when that machine has the repo,
GPU or credentials the job needs:

```bash
agent-relay fleet spawn codex --node mini-b --name Builder \
  --task "Run the test suite in ~/code/app and report failures to Lead" \
  --cwd ~/code/app
```

`--cwd` is a path **on the target machine**. Each machine uses its own
checkout, and nothing is copied between machines.

**Let Relay pick a machine**: use `--auto-place` instead of `--node`.

**Release an agent**: `agent-relay fleet release <name>`.

**From inside an agent** (Relay MCP tools): agents message each other by name
with `message_dm_send` / `message_post` whichever machine they run on.
`spawn` takes a `target_node` to choose the machine.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Nodes are up but can't see each other's agents | The machines are on different workspaces, often because `node up` ran before `workspace join` | Run `agent-relay workspace list` on both machines. Run `workspace join` with the same key, then `node down` and `node up` |
| `fleet nodes` doesn't list a machine | The node is on another workspace, or isn't running | Check `workspace list` and `node status` on that machine. `fleet nodes --all` also shows hidden or offline records |
| Spawn reports `spawn_failed` / `spawn_unconfirmed` | The launch confirmation didn't arrive, but the agent often did start | Run `agent-relay node agent list` on the target machine before retrying |
| Agent starts but never acts or replies | Its CLI isn't logged in on that machine (e.g. `401 OAuth access token has been revoked`) | Log in to that CLI on the target machine (`claude /login`, `codex login`), or spawn a different CLI |
| `message` CLI commands say `requires agentToken` | The `message` commands act as a registered agent | Test messaging agent to agent as shown above, or use the Relay MCP tools from inside an agent |
| `Invalid API key` | The CLI is using a different active workspace than you expect | Run `agent-relay workspace switch my-team` and retry |
| Node shows online but spawns never land on it | The node advertises no spawn capability for that CLI (e.g. only `claude`, not `codex`) | Install and log in to that CLI on the target machine, then restart the node |
| Agent spawned on B can't find files | `--cwd` points to a path that exists only on A | Use a path that exists on the target machine |

## Related skills

- `orchestrating-agent-relay`: running and monitoring a team from one lead
- `using-agent-relay`: messaging, channels and inbox from inside an agent
- `multi-host-live-mount`: sharing one **file** tree (Relayfile) across machines
