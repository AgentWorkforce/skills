---
name: using-agent-relay
description: Use when you are a registered relay agent (a spawned worker, or a lead that called register_agent) coordinating with peers in real time over Agent Relay MCP tools - messaging, channels, threads, reactions, and search. This is the participant-side reference; the counterpart for driving a team from outside is orchestrating-agent-relay.
---

# Using Agent Relay (registered participant)

Real-time agent-to-agent messaging via Agent Relay MCP tools, for an agent
that **is a registered participant** in a relay team.

> **Which skill do you want?**
>
> - **You were spawned into a team, or you called `register_agent`** → you
>   are a registered agent. This skill (MCP tools below) is for you.
> - **You are the spawning orchestrator** (you ran `agent-relay local up` /
>   `agent-relay local agent spawn` and are driving a worker team from outside) →
>   you reach the team through relay too, but as a registered identity. The
>   messaging / `list_agents` MCP tools reject unregistered callers with
>   `Not registered. Call register_agent first.` Use the
>   **`orchestrating-agent-relay`** skill — it covers registering for a token and
>   the `agent-relay local …` lifecycle commands.

## MCP Tools Overview

Tool names are flat snake_case. Claude addresses them as
`mcp__agent-relay__<tool>`; other CLIs (via mcporter) address them as
`agent-relay.<tool>`.

### Messaging

| Tool (Claude / Other CLIs)                                          | Description                              |
| ------------------------------------------------------------------- | ---------------------------------------- |
| `mcp__agent-relay__send_dm` / `agent-relay.send_dm`                 | Send a direct message to an agent        |
| `mcp__agent-relay__send_group_dm` / `agent-relay.send_group_dm`     | Send a group DM to multiple agents       |
| `mcp__agent-relay__post_message` / `agent-relay.post_message`       | Post a message to a channel              |
| `mcp__agent-relay__reply_to_thread` / `agent-relay.reply_to_thread` | Reply to a thread in a channel           |
| `mcp__agent-relay__check_inbox` / `agent-relay.check_inbox`         | Check your inbox for new messages        |
| `mcp__agent-relay__list_dms` / `agent-relay.list_dms`               | Get direct message history with an agent |
| `mcp__agent-relay__list_messages` / `agent-relay.list_messages`     | Get messages from a channel              |
| `mcp__agent-relay__get_message_thread` / `agent-relay.get_message_thread` | Get a thread's messages            |
| `mcp__agent-relay__search_messages` / `agent-relay.search_messages` | Search messages across channels          |
| `mcp__agent-relay__mark_message_read` / `agent-relay.mark_message_read` | Mark a message as read               |
| `mcp__agent-relay__get_message_readers` / `agent-relay.get_message_readers` | See who has read a message      |

### Agents

| Tool (Claude / Other CLIs)                                    | Description                   |
| ------------------------------------------------------------- | ----------------------------- |
| `mcp__agent-relay__add_agent` / `agent-relay.add_agent`       | Spawn/add a new agent         |
| `mcp__agent-relay__remove_agent` / `agent-relay.remove_agent` | Release/remove an agent       |
| `mcp__agent-relay__list_agents` / `agent-relay.list_agents`   | List all online agents        |
| `mcp__agent-relay__register_agent` / `agent-relay.register_agent` | Register yourself as an agent |

### Channels

| Tool (Claude / Other CLIs)                                          | Description                  |
| ------------------------------------------------------------------- | ---------------------------- |
| `mcp__agent-relay__create_channel` / `agent-relay.create_channel`   | Create a new channel         |
| `mcp__agent-relay__archive_channel` / `agent-relay.archive_channel` | Archive a channel            |
| `mcp__agent-relay__list_channels` / `agent-relay.list_channels`     | List all channels            |
| `mcp__agent-relay__join_channel` / `agent-relay.join_channel`       | Join a channel               |
| `mcp__agent-relay__leave_channel` / `agent-relay.leave_channel`     | Leave a channel              |
| `mcp__agent-relay__invite_to_channel` / `agent-relay.invite_to_channel` | Invite an agent to a channel |
| `mcp__agent-relay__set_channel_topic` / `agent-relay.set_channel_topic` | Set a channel's topic    |

### Reactions

| Tool (Claude / Other CLIs)                                          | Description                      |
| ------------------------------------------------------------------- | -------------------------------- |
| `mcp__agent-relay__add_reaction` / `agent-relay.add_reaction`       | Add a reaction to a message      |
| `mcp__agent-relay__remove_reaction` / `agent-relay.remove_reaction` | Remove a reaction from a message |

### Actions & Workspace

| Tool (Claude / Other CLIs)                                          | Description                     |
| ------------------------------------------------------------------- | ------------------------------- |
| `mcp__agent-relay__list_actions` / `agent-relay.list_actions`       | List available registered actions |
| `mcp__agent-relay__invoke_action` / `agent-relay.invoke_action`     | Invoke a registered action      |
| `mcp__agent-relay__create_workspace` / `agent-relay.create_workspace` | Create a new workspace        |
| `mcp__agent-relay__set_workspace_key` / `agent-relay.set_workspace_key` | Set the workspace API key   |

> Actions are registered from an SDK app (`relay.registerAction(...)`); the MCP
> server exposes each as a generated tool plus `list_actions` / `invoke_action`.
> Webhooks and event subscriptions are SDK/runtime features, not MCP tools.

## Sending Messages

### Direct Messages

```
mcp__agent-relay__send_dm(to: "Bob", text: "Can you review my code changes?")
```

### Group DMs

```
mcp__agent-relay__send_group_dm(participants: ["Alice", "Bob"], text: "Sync on auth module")
```

### Channel Messages

```
mcp__agent-relay__post_message(channel: "general", text: "The API endpoints are ready")
```

### Thread Replies

```
mcp__agent-relay__reply_to_thread(channel: "general", thread_id: "abc123", text: "Done!")
```

## Communication Protocol

**ACK immediately** - When you receive a task, acknowledge before starting work:

```
mcp__agent-relay__send_dm(to: "Lead", text: "ACK: Brief description of task received")
```

**Report completion** - When done, send a completion message:

```
mcp__agent-relay__send_dm(to: "Lead", text: "DONE: Brief summary of what was completed")
```

**Send status to your lead, NOT broadcast.**

## Receiving Messages

Messages appear as:

```
Relay message from Alice [abc123]: Content here
```

Channel messages include `[#channel]`:

```
Relay message from Alice [abc123] [#general]: Hello!
```

Reply to the channel shown, not the sender.

## Spawning & Releasing Agents

### Spawn a Worker

```
mcp__agent-relay__add_agent(name: "WorkerName", cli: "claude", task: "Task description here")
```

### CLI Options

| CLI Value  | Description                |
| ---------- | -------------------------- |
| `claude`   | Claude Code (Anthropic)    |
| `codex`    | Codex CLI (OpenAI)         |
| `gemini`   | Gemini CLI (Google)        |
| `aider`    | Aider coding assistant     |
| `goose`    | Goose AI assistant         |

### Release a Worker

```
mcp__agent-relay__remove_agent(name: "WorkerName")
```

## Channels

### Create and Join

```
mcp__agent-relay__create_channel(name: "frontend", topic: "Frontend work")
mcp__agent-relay__join_channel(channel: "frontend")
mcp__agent-relay__invite_to_channel(channel: "frontend", agent: "Bob")
```

### List and Read

```
mcp__agent-relay__list_channels()
mcp__agent-relay__list_messages(channel: "general")
```

## Reactions

```
mcp__agent-relay__add_reaction(message_id: "abc123", emoji: "thumbsup")
mcp__agent-relay__remove_reaction(message_id: "abc123", emoji: "thumbsup")
```

## Search

```
mcp__agent-relay__search_messages(query: "auth module", channel: "general")
```

## Checking Status

```
mcp__agent-relay__list_agents()    # List online agents
mcp__agent-relay__check_inbox()    # Check for unread messages
```

## CLI Commands

As a participant you coordinate through the MCP tools above. The
`agent-relay local …` CLI inspects the local broker if you need it:

```bash
agent-relay local status              # Check broker status
agent-relay local agent list          # List active agents
agent-relay local tail --agent <name> # Stream an agent's raw output (debug)
```

## Common Mistakes

| Mistake                                      | Fix                                                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Messages not sending                         | Use `check_inbox` to verify your connection                                                                                            |
| Agent not receiving                          | Use `list_agents` to confirm the agent is online                                                                                       |
| `Not registered. Call register_agent first.` | Register first (`register_agent`) — or, if you are the orchestrator, see the `orchestrating-agent-relay` skill                          |
| Wrong tool prefix                            | Claude: `mcp__agent-relay__<tool>`; other CLIs: `agent-relay.<tool>`                                                                   |
| DM vs channel confusion                      | Use `send_dm` for agents, `post_message` for channels                                                                                  |
