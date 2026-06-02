---
name: creating-cloud-persona
description: Use when creating or updating a Workforce cloud persona (`persona.json` + `agent.ts`) for the current deploy/runtime shape. Covers `cloud`, `useSubscription`, `integrations`, `memory`, `onEvent`, current top-level `harness`/`model`/`systemPrompt`/`harnessSettings`, and the latest `defineAgent(...)` pattern where triggers, schedules, and watch rules are declared in `agent.ts`, not in `persona.json`. Use for requests like “create a cloud persona”, “write a deployable workforce persona”, “add integrations to a persona”, or “author the agent.ts handler for a workforce persona”.
---

# Creating Cloud Persona

Use this skill when authoring a deployable Workforce persona in the **current** shape.

## Core rule

A cloud persona is two things together:

1. `persona.json` declares **deployment metadata and runtime wiring**
2. `agent.ts` implements the **actual behavior**

Important: **triggers, schedules, and watch rules are declared in `agent.ts` via `defineAgent(...)`, while `persona.json` declares deploy/runtime config and integration connection requirements.**
The handler branches on `event.source` and `event.type` or `event.name`.

## First read

Before authoring, read these real repo examples and current types:

- `workforce/examples/review-agent/persona.json`
- `workforce/examples/review-agent/agent.ts`
- `workforce/examples/weekly-digest/persona.json`
- `workforce/examples/weekly-digest/agent.ts`
- `workforce/packages/persona-kit/src/types.ts`
- `workforce/packages/runtime/src/types.ts`

If you need exact field semantics, also inspect:

- `workforce/packages/persona-kit/schemas/persona.schema.json`
- `workforce/packages/deploy/src/preflight.ts`

## Current persona shape to follow

Prefer the **actual shipped shape**, not older plan text.

For cloud personas, expect fields like:

- `id`
- `intent`
- `tags`
- `description`
- `cloud: true`
- `useSubscription` (optional)
- `integrations` (optional, for provider connection requirements)
- `memory` (optional)
- `onEvent`
- top-level runtime fields:
  - `harness`
  - `model`
  - `systemPrompt`
  - `harnessSettings`
- optional `inputs`, `env`, `skills`, `permissions`, `mount`, `mcpServers`, `capabilities`

Do **not** author older `tiers` / `defaultTier` structures unless the repo explicitly still uses them. The latest Workforce examples use flat top-level runtime fields.

## Mental model

### `persona.json` does

- declares whether the persona is deployable
- chooses the harness/model/runtime knobs
- declares which integrations must be connected
- enables memory
- points at the handler entrypoint
- optionally declares capabilities/metadata

### `agent.ts` does

- exports `defineAgent({...})`
- declares `triggers`, `schedules`, and optionally `watch`
- receives `ctx` and `event` in `handler`
- inspects `event.source`
- inspects `event.type` or `event.name`
- reads and writes provider data through the generic VFS helpers imported from `@agentworkforce/runtime` (`readJsonFile`, `listJsonFiles`, `writeJsonFile`, plus `draftFile` / `encodeSegment` / `resolveMountRoot`) against canonical Relayfile paths like `/<provider>/...` — there are **no** per-provider clients on `ctx` (no `ctx.github` / `ctx.linear`)
- optionally calls `ctx.harness.run(...)`
- optionally uses `ctx.memory.*`
- performs the actual workflow

## Trigger model

Cloud agents currently have three practical wakeup shapes, and they are authored in `agent.ts`:

1. **Clock** via `defineAgent({ schedules: [...] })`
   - runtime event source: `cron`
   - branch on `event.source === 'cron'`
   - discriminate with `event.name`

2. **Radio** via `defineAgent({ triggers: { <provider>: [...] } })`
   - runtime event source: provider name like `github`, `linear`, `slack`, `notion`, `jira`
   - branch on `event.source`
   - then branch on `event.type`

3. **Relayfile watch** via `defineAgent({ watch: [...] })`
   - for file/path-driven proactive behavior
   - keep this for cases that are truly about Relayfile path changes, not provider event hooks

`persona.json.integrations` still matters, but for **connection/setup**, not for declaring which events fire the handler.

## Authoring rules

### 1. Prefer one `defineAgent(...)` file

Default to one `agent.ts` per persona, exporting one `defineAgent({...})` with internal branching:

- `if (event.source === 'cron') ...`
- `if (event.source === 'github' && event.type === 'pull_request.opened') ...`

Do not split into many handlers unless the behavior is truly large.

### 2. Keep wakeups declarative in `defineAgent(...)`, behavior imperative in the handler

Use `defineAgent(...)` to declare **what can wake the agent**.
Do not try to encode the workflow in `persona.json`.
The actual routing and business logic belong in `agent.ts`.

### 3. Only declare integrations the agent actually requires

If `agent.ts` never uses Slack behavior or Slack-backed writes, do not declare Slack in `persona.json` just because it might be useful later.

### 4. Schedules are named APIs

Declare schedules in `defineAgent({ schedules: [...] })`, not in `persona.json`.

Every schedule name should mean something operationally useful, because `event.name` is what the handler receives.

Good:

- `weekly`
- `daily-triage`
- `stale-pr-scan`

Bad:

- `job1`
- `schedule-a`

### 5. Memory should match the job

Examples:

- `workspace` scope for shared team/project context
- `user` scope for per-user assistant continuity
- `global` only when cross-workspace memory is truly intended

Do not enable memory by reflex if the persona is purely stateless.

### 6. `systemPrompt` should define the agent’s role, not the listener plumbing

The prompt should say what kind of agent this is and what quality bar it follows.
Do not stuff listener-routing details into the prompt when they are already in code.

## Good starter pattern

Use this shape unless there is a strong reason not to.

### persona.json

```json
{
  "id": "review-agent",
  "intent": "review",
  "tags": ["review", "github"],
  "description": "Reviews PRs, responds to mentions, and reacts to failed CI.",
  "cloud": true,
  "useSubscription": true,
  "integrations": {
    "github": {},
    "slack": {}
  },
  "memory": {
    "enabled": true,
    "scopes": ["workspace"]
  },
  "onEvent": "./agent.ts",
  "harness": "codex",
  "model": "gpt-5.4",
  "systemPrompt": "Review pull requests for correctness, regression risk, security concerns, and missing tests. Be concise and concrete.",
  "harnessSettings": {
    "reasoning": "medium",
    "timeoutSeconds": 1200,
    "sandboxMode": "workspace-write",
    "workspaceWriteNetworkAccess": true
  }
}
```

### agent.ts

```ts
import { defineAgent } from '@agentworkforce/runtime';

export default defineAgent({
  triggers: {
    github: [
      { on: 'pull_request.opened' },
      { on: 'issue_comment.created', match: '@mention' },
      { on: 'check_run.completed', where: 'conclusion=failure' }
    ],
    slack: [{ on: 'app_mention' }]
  },
  schedules: [{ name: 'daily-triage', cron: '0 9 * * 1-5', tz: 'UTC' }],
  handler: async (ctx, event) => {
    if (event.source === 'github') {
      if (event.type === 'pull_request.opened') {
        // review flow
        return;
      }
      if (event.type === 'issue_comment.created') {
        // mention reply flow
        return;
      }
      if (event.type === 'check_run.completed') {
        // failed-CI reaction flow
        return;
      }
    }

    if (event.source === 'slack' && event.type === 'app_mention') {
      // slack reply flow
      return;
    }

    if (event.source === 'cron' && event.name === 'daily-triage') {
      // scheduled flow
      return;
    }
  }
});
```

## Event-shape guidance

Use the runtime’s current event model:

- cron events: `event.source === 'cron'`, `event.name`, `event.cron`
- provider events: `event.source === '<provider>'`, `event.type`, `event.payload`

Do not invent custom event wrappers when `@agentworkforce/runtime` already provides them.

When reading provider payloads:

- treat `event.payload` as provider-normalized but still loosely typed
- write small local extractor helpers instead of spreading unsafe casts everywhere
- validate required identifiers early and fail clearly
- prefer `defineAgent({...})` + helper functions over giant inline `if` blocks

## Context usage guidance

The useful pieces on `ctx` are typically:

- `ctx.persona`
- `ctx.harness.run(...)`
- `ctx.memory.save(...)`
- `ctx.memory.recall(...)`
- `ctx.sandbox.*`
- `ctx.files.*`
- `ctx.schedule.*`
- `ctx.workflow.*`
- `ctx.log(...)`

Prefer direct typed runtime helpers over invoking external commands.

### Provider reads and writes (no per-provider clients)

There are **no** `ctx.<provider>` clients. All provider IO goes through the
generic VFS helpers exported from `@agentworkforce/runtime`, which read/write
JSON files at canonical Relayfile mount paths (`/<provider>/...`). A read is a
plain file read; a write is a draft file the Relayfile writeback worker turns
into the real provider call (with retry/durability) — so handlers never hold a
token or call a provider REST API directly.

```ts
import {
  defineAgent,
  draftFile,
  encodeSegment,
  readJsonFile,
  resolveMountRoot,
  writeJsonFile,
  type IntegrationClientOptions
} from '@agentworkforce/runtime';

// Resolve the mount root once (defaults to the RELAYFILE_MOUNT_ROOT env).
function vfsClient(): IntegrationClientOptions {
  return { relayfileMountRoot: resolveMountRoot({}) };
}

// READ: a provider record is JSON at a canonical path.
const issue = await readJsonFile(
  vfsClient(), 'linear', 'getIssue',
  `/linear/issues/${encodeSegment(issueId)}.json`
);

// WRITE: drop a draft into the resource's collection path; the writeback
// worker materializes it into the real comment.
await writeJsonFile(
  vfsClient(), 'linear', 'comment',
  `/linear/issues/${encodeSegment(issueId)}/comments/${draftFile('comment')}`,
  { body: ':rocket: done' }
);
```

Use each adapter's canonical path convention (e.g. `/github/repos/{owner}/{repo}/issues/{n}/comments`, `/slack/channels/{id}/messages`). When unsure of a path, check the adapter's `resources.ts` rather than guessing.

## When to use `ctx.harness.run(...)`

Use the harness when the persona needs real judgment or synthesis, for example:

- PR review comments
- replies to mentions
- code-fix suggestions
- summarization
- clustering and writing human-facing output

Do not use the harness for simple deterministic routing, field extraction, or formatting that plain TypeScript can do more safely.

## Inputs and env

Use `inputs` when the value is a declared runtime parameter for the persona, like:

- target repo
- topic list
- destination channel
- project code

Use `env` only for environment variables the harness process needs.
Do not put secrets into `inputs`.

## Common patterns

### Scheduled digest

Use when the agent runs on a cron schedule and writes a summary somewhere.

Persona:

- `cloud: true`
- integration connection declarations like `github` or `slack`
- optional `inputs` for topics/repos/channels

Agent:

- `defineAgent({ schedules: [...] })`
- branch on `event.source === 'cron'`
- use `event.name` to select the schedule
- fetch/search/gather
- summarize
- post or upsert
- save memory if the artifact matters later

### Integration-triggered reviewer

Use when the agent wakes on GitHub, Linear, Slack, etc.

Persona:

- `integrations.<provider>` for connection requirements
- `useSubscription: true` if the judgment should run on the user’s linked provider path
- often `memory.workspace`

Agent:

- `defineAgent({ triggers: { <provider>: [...] } })`
- branch on provider source
- branch on event type
- extract target identifiers from payload
- optionally load prior memory
- call harness for judgment/output
- write back with `writeJsonFile(...)` + `draftFile(...)` to the provider's canonical Relayfile path — a draft write the Relayfile writeback worker turns into the real provider call

### Mixed schedule + integrations agent

Fine to combine both in one cloud agent when the role is coherent.
Examples:

- responds to Slack mentions and also runs a daily cleanup
- reacts to GitHub events and runs a weekly scan

Do not combine unrelated jobs into one agent just because the runtime allows it.

## Anti-patterns

Avoid these:

- writing old `tiers`-based personas when the repo uses flat runtime fields
- putting business logic into `persona.json`
- declaring integrations that `agent.ts` never uses
- declaring `defineAgent(...).triggers`, `schedules`, or `watch` without implementing branches for them
- using `systemPrompt` as a substitute for explicit code routing
- giant unstructured handlers with no helper functions
- reaching for `ctx.github` / `ctx.linear` / etc. — those per-provider clients no longer exist; use the VFS helpers
- invoking external commands (`curl`, `gh`, provider SDKs) for provider reads/writes the VFS helpers already cover via Relayfile draft writes
- assuming all provider payload fields exist without validation

## Deploying: local login → cloud

Authoring isn't done until the human can take it from a local machine to a
running cloud agent. The full path uses the `agentworkforce` CLI:

1. **Log in.** Connects this machine to a Workforce workspace.

   ```bash
   agentworkforce login
   ```

   Opens the browser to sign in to the Agent Relay cloud (default
   `https://agentrelay.com`), lists the workspaces the account can see, and
   stores a small pointer at `~/.agentworkforce/active.json` recording the
   chosen workspace. Flags: `--workspace <id-or-slug>` (skip the picker — useful
   if `/api/v1/workspaces` 403s but you know the id), `--cloud-url <url>`.

2. **Dry-run (optional but recommended).** Validate the persona before any side
   effects:

   ```bash
   agentworkforce deploy ./path/to/persona --mode cloud --dry-run
   ```

3. **Deploy.** Bundles `persona.json` + `agent.ts`, prompts to connect each
   provider declared in `persona.json.integrations`, and launches in the active
   workspace:

   ```bash
   agentworkforce deploy ./path/to/persona --mode cloud --on-exists update
   ```

   - `--on-exists update` redeploys over an existing persona of the same id.
     **Gotcha:** the default is `cancel`, which is a silent no-op — if a deploy
     "does nothing", you almost always wanted `--on-exists update`.
   - `--no-connect` fails instead of prompting when an integration is missing
     (good for CI); `--reconnect <provider>` forces a fresh connect.
   - `--input key=value` overrides a declared persona input (repeatable).
   - `--detach` backgrounds the runner instead of streaming logs.

4. **Verify / manage.**

   ```bash
   agentworkforce deployments list      # what's running in the workspace
   agentworkforce destroy ./path/to/persona   # tear it down
   ```

Triggers/schedules/watch declared in `defineAgent(...)` are registered at
deploy time, so connect every integration the agent listens on — an unconnected
provider means its triggers never fire.

## Validation checklist

Before declaring the persona done:

1. `persona.json` matches the current schema shape used in examples
2. `cloud` personas include `onEvent`
3. `agent.ts` uses `defineAgent(...)` with at least one listener source:
   - `triggers`, or
   - `schedules`, or
   - `watch`
4. every declared trigger, schedule, or watch rule has a code path in `handler`
5. every provider named in `agent.ts` listener config is also declared in `persona.json.integrations`
6. `systemPrompt` describes the role clearly
7. harness/model/settings fit the job
8. memory config is intentional, not accidental
9. the handler uses `ctx.log(...)` or durable side effects clearly enough for debugging

## Output contract for this skill

When creating or editing a cloud persona, return:

1. the full `persona.json`
2. the full `agent.ts`
3. a short note explaining:
   - why the chosen listener declarations belong in `defineAgent(...)`
   - why the chosen deploy/runtime config belongs in `persona.json`
   - why the chosen behavior belongs in `agent.ts`
   - which current Workforce example the shape most closely follows
4. the deploy hand-off the human runs: `agentworkforce login`, then
   `agentworkforce deploy <persona> --mode cloud --on-exists update`, calling
   out which integrations they'll be prompted to connect
