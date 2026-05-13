# Agent Workforce Skills

Skills, slash commands, and a Claude Code plugin for building multi-agent systems with Agent Relay.

Package metadata lives in [prpm.json](prpm.json). The repo currently publishes `agent-workforce-skills` version `1.0.5`.

## Published Skills

| Skill | Version | Description |
|-------|---------|-------------|
| [choosing-swarm-patterns](skills/choosing-swarm-patterns/SKILL.md) | 1.1.2 | Pick the right Agent Relay orchestration pattern across the 10 core swarm patterns plus specialized patterns. |
| [writing-agent-relay-workflows](skills/writing-agent-relay-workflows/SKILL.md) | 1.6.6 | Build multi-agent workflows with WorkflowBuilder, DAG dependencies, verification gates, channels, and chat-native coordination recipes. |
| [setting-up-relayfile](skills/setting-up-relayfile/SKILL.md) | 1.1.0 | Set up Relayfile mounts and writeback for provider files through local filesystem access. |
| [using-agent-relay](skills/using-agent-relay/SKILL.md) | 1.2.0 | Coordinate agents in real time with Relaycast messaging, channels, threads, reactions, search, and webhooks. |
| [running-headless-orchestrator](skills/running-headless-orchestrator/SKILL.md) | 1.0.4 | Self-bootstrap Agent Relay infrastructure and manage worker agents without human intervention. |
| [relay-80-100-workflow](skills/relay-80-100-workflow/SKILL.md) | 1.0.4 | Author workflows that close the 80-to-100 validation gap with repair-aware test, verify, and commit gates. |

## Source-Only Skill

| Skill | Description |
|-------|-------------|
| [agent-relay-orchestrator](skills/openclaw-orchestrator/SKILL.md) | Run headless orchestration sessions via Agent Relay, including channels, teams, lifecycle management, and Claude/Codex/Gemini/Pi/Droid workers. |

## Slash Commands

| Command | Version | Description |
|---------|---------|-------------|
| [/create-workflow](commands/create-workflow.md) | 1.0.0 | Scaffold a model-agnostic Agent Relay workflow using the workflow and swarm-pattern skills. |
| [/spawn](commands/spawn.md) | 1.0.0 | Bootstrap the broker and spawn a worker for `claude`, `codex`, `opencode`, `droid`, `gemini`, or `pi`. |

## Claude Relay Plugin

[plugins/claude-relay-plugin](plugins/claude-relay-plugin) contains the `agent-relay` Claude Code plugin, currently version `0.1.0`.

It provides:

- Relaycast MCP tools for messaging, channels, inboxes, reactions, and related coordination primitives.
- Lifecycle hooks for session setup, inbox polling, stop guards, subagent bootstrap, permission allowlisting, and context compaction.
- A `relay-worker` agent definition for Claude Code subagents.
- Plugin skills for coordinated teams, fan-out work, and sequential pipelines.

Install from the Claude Code plugin marketplace:

```bash
/plugin marketplace add Agentworkforce/relay
```

Then allow relay MCP tools for background workers from your project root:

```bash
bash .claude-plugin/setup.sh
```

## Install Packages

Install an individual skill or slash command with `prpm` using the scoped package name: `@agent-relay/${skillName}`.

```bash
npx prpm install @agent-relay/choosing-swarm-patterns
npx prpm install @agent-relay/writing-agent-relay-workflows
npx prpm install @agent-relay/setting-up-relayfile
npx prpm install @agent-relay/using-agent-relay
npx prpm install @agent-relay/running-headless-orchestrator
npx prpm install @agent-relay/relay-80-100-workflow
npx prpm install @agent-relay/create-workflow
npx prpm install @agent-relay/spawn
```

Or install directly from this GitHub repo with `skills`:

```bash
npx skills add https://github.com/agentworkforce/skills --skill choosing-swarm-patterns
npx skills add https://github.com/agentworkforce/skills --skill writing-agent-relay-workflows
npx skills add https://github.com/agentworkforce/skills --skill setting-up-relayfile
npx skills add https://github.com/agentworkforce/skills --skill using-agent-relay
npx skills add https://github.com/agentworkforce/skills --skill running-headless-orchestrator
npx skills add https://github.com/agentworkforce/skills --skill relay-80-100-workflow
npx skills add https://github.com/agentworkforce/skills --skill agent-relay-orchestrator
```

Install the `agent-relay-starter` collection with `prpm` when you want the core workflow authoring stack in multiple CLI tools:

```bash
npx prpm install collections/agent-relay-starter --as codex,claude
```

This collection includes:

- `@agent-relay/choosing-swarm-patterns`
- `@agent-relay/writing-agent-relay-workflows`
- `@agent-workforce/trail-snippet`
- optional `@agent-relay/relay-80-100-workflow`

See the [prpm docs](https://docs.prpm.dev/) for collection installs and CLI target options.

## Repository Layout

```text
skills/                         # Standalone skills
commands/                       # Slash commands
plugins/claude-relay-plugin/    # Claude Code plugin, hooks, worker agent, and plugin skills
workflows/                      # Maintenance and audit workflows
prpm.json                       # Package manifest
```

## Links

- [Agent Relay](https://agentrelay.dev)
- [Agent Relay on prpm](https://prpm.dev/orgs?name=Agent+Relay)
- [Skills on skills.sh](https://skills.sh/agentworkforce/skills)
