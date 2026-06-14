# Agent Workforce Skills

Skills, slash commands, and a Claude Code plugin for building multi-agent systems with Agent Relay.

Package metadata lives in [prpm.json](prpm.json). The repo currently publishes `agent-workforce-skills` version `1.1.3`.

## Published Skills

| Skill | Version | Description |
|-------|---------|-------------|
| [choosing-swarm-patterns](skills/choosing-swarm-patterns/SKILL.md) | 1.1.4 | Pick the right Agent Relay orchestration pattern across the 10 core swarm patterns plus specialized patterns. |
| [writing-agent-relay-workflows](skills/writing-agent-relay-workflows/SKILL.md) | 1.6.17 | Build multi-agent workflows with WorkflowBuilder, DAG dependencies, verification gates, review-depth review/fix loops with test hardening, channels, and chat-native coordination recipes. |
| [setting-up-relayfile](skills/setting-up-relayfile/SKILL.md) | 1.1.1 | Set up Relayfile mounts and writeback for provider files through local filesystem access. |
| [using-agent-relay](skills/using-agent-relay/SKILL.md) | 1.3.2 | Participant-side MCP reference for a **registered** relay agent (spawned worker / registered lead): messaging, channels, threads, reactions, search, inbox, actions, and worker spawn/release. Counterpart to `orchestrating-agent-relay`. |
| [orchestrating-agent-relay](skills/orchestrating-agent-relay/SKILL.md) | 2.1.2 | The canonical way to run agent-relay: self-bootstrap the broker and autonomously spawn, monitor, and coordinate a worker team without human intervention. |
| [relay-80-100-workflow](skills/relay-80-100-workflow/SKILL.md) | 1.0.8 | Author workflows that close the 80-to-100 validation gap with repair-aware test, verify, review-depth review/fix with test hardening, and commit gates. |
| [review-fix-signoff-loop](skills/review-fix-signoff-loop/SKILL.md) | 1.0.2 | Loop review, repair, validation, and fresh-context dual-agent signoff until independent reviewers both satisfy the verdict contract. |
| [trigger-autocomplete-catalog](skills/trigger-autocomplete-catalog/SKILL.md) | 1.0.0 | Enforce webhook/event trigger autocomplete coverage through KNOWN_TRIGGER_CATALOG in @relayfile/adapter-core. |
| [activity-summary](skills/activity-summary/SKILL.md) | 1.0.0 | Answer "what did I work on yesterday" questions by reading `digests/yesterday.md` first instead of crawling provider directories. |
| [daily-digest](skills/daily-digest/SKILL.md) | 1.0.0 | Authoring contract for `<mount>/digests/` files — windows, per-provider sections, adapter `digest()` exports, regeneration rules. |
| [writeback-as-files](skills/writeback-as-files/SKILL.md) | 1.0.0 | File-creation writeback contract — drop a JSON file at the canonical path and relayfile delivers the mutation, with dead-letter recovery. |
| [workspace-layout](skills/workspace-layout/SKILL.md) | 1.0.1 | Navigate a relayfile mount via root and per-provider `LAYOUT.md` files plus `by-*` alias indexes instead of `find`/`grep -r`. |
| [adding-swarm-patterns](skills/adding-swarm-patterns/SKILL.md) | 1.0.0 | Checklist for extending agent-relay with a new swarm pattern — TypeScript types, JSON schema, YAML template, and pattern/template docs. |
| [creating-cloud-persona](skills/creating-cloud-persona/SKILL.md) | 1.0.4 | Create or update a Workforce cloud persona with `persona.json`, `agent.ts`, vendored examples, and production-correctness checks. |
| [openclaw-orchestrator](skills/openclaw-orchestrator/SKILL.md) | 1.0.0 | Run headless multi-agent orchestration sessions via Agent Relay — spawn teams across Claude/Codex/Gemini/Pi/Droid, create channels, and manage agent lifecycle. |

## Slash Commands

| Command | Version | Description |
|---------|---------|-------------|
| [/create-workflow](commands/create-workflow.md) | 1.0.4 | Scaffold a model-agnostic Agent Relay workflow using the workflow and swarm-pattern skills, including selected review-depth review/fix loops with test hardening. |
| [/spawn](commands/spawn.md) | 1.0.0 | Bootstrap the broker and spawn a worker for `claude`, `codex`, `opencode`, `droid`, `gemini`, or `pi`. |
| [/review-loop](commands/review-loop.md) | 1.0.1 | Run a dual-reviewer code-review loop with repair and fresh-context signoff. |

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

Install the `relayfile-workspace` collection when you want the full Relayfile workspace primitive stack:

```bash
npx prpm install collections/relayfile-workspace --as codex,claude
```

This collection includes:

- `@agent-relay/activity-summary`
- `@agent-relay/daily-digest`
- `@agent-relay/workspace-layout`
- `@agent-relay/writeback-as-files`

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
