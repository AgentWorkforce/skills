# Agent Workforce Skills

Skills, slash commands, and a Claude Code plugin for building multi-agent systems with Agent Relay.

Package metadata lives in [prpm.json](prpm.json). The repo currently publishes `agent-workforce-skills` version `1.0.10`.

## Published Skills

| Skill | Version | Description |
|-------|---------|-------------|
| [choosing-swarm-patterns](skills/choosing-swarm-patterns/SKILL.md) | 1.1.3 | Pick the right Agent Relay orchestration pattern across the 10 core swarm patterns plus specialized patterns. |
| [writing-agent-relay-workflows](skills/writing-agent-relay-workflows/SKILL.md) | 1.6.12 | Build multi-agent workflows with WorkflowBuilder, DAG dependencies, verification gates, mandatory Claude-then-Codex review/fix loops with test hardening, channels, and chat-native coordination recipes. |
| [setting-up-relayfile](skills/setting-up-relayfile/SKILL.md) | 1.1.0 | Set up Relayfile mounts and writeback for provider files through local filesystem access. |
| [using-agent-relay](skills/using-agent-relay/SKILL.md) | 1.2.0 | Coordinate agents in real time with Relaycast messaging, channels, threads, reactions, search, and webhooks. |
| [running-headless-orchestrator](skills/running-headless-orchestrator/SKILL.md) | 1.0.5 | Self-bootstrap Agent Relay infrastructure and manage worker agents without human intervention. |
| [relay-80-100-workflow](skills/relay-80-100-workflow/SKILL.md) | 1.0.7 | Author workflows that close the 80-to-100 validation gap with repair-aware test, verify, mandatory Claude-then-Codex review/fix with test hardening, and commit gates. |
| [review-fix-signoff-loop](skills/review-fix-signoff-loop/SKILL.md) | 1.0.2 | Loop review, repair, validation, and fresh-context dual-agent signoff until independent reviewers both satisfy the verdict contract. |

## Slash Commands

| Command | Version | Description |
|---------|---------|-------------|
| [/create-workflow](commands/create-workflow.md) | 1.0.2 | Scaffold a model-agnostic Agent Relay workflow using the workflow and swarm-pattern skills, including mandatory Claude-then-Codex review/fix loops with test hardening. |
| [/spawn](commands/spawn.md) | 1.0.0 | Bootstrap the broker and spawn a worker for `claude`, `codex`, `opencode`, `droid`, `gemini`, or `pi`. |

## Claude Relay Plugin

Install the [`agent-relay`](plugins/claude-relay-plugin) Claude Code plugin from the marketplace:

```bash
/plugin marketplace add Agentworkforce/relay
```

## Install Packages

Install an individual skill or slash command with `prpm` using the scoped package name: `@agent-relay/${skillName}`.

```bash
npx prpm install @agent-relay/choosing-swarm-patterns
```

Or install directly from this GitHub repo with `skills`:

```bash
npx skills add https://github.com/agentworkforce/skills --skill choosing-swarm-patterns
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
- optional `@agent-relay/review-fix-signoff-loop`

See [prpm.dev](https://prpm.dev/) and the [prpm docs](https://docs.prpm.dev/) for collection installs and CLI target options.

## Repository Layout

```text
skills/                         # Standalone skills
commands/                       # Slash commands
plugins/claude-relay-plugin/    # Claude Code plugin, hooks, worker agent, and plugin skills
workflows/                      # Maintenance and audit workflows
prpm.json                       # Package manifest
```

## Links

- [Agent Relay](https://agentrelay.com)
- [Agent Relay on prpm](https://prpm.dev/orgs?name=Agent+Relay)
- [Skills on skills.sh](https://skills.sh/agentworkforce/skills)
