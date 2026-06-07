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
- reads and writes provider data through **`@relayfile/relay-helpers`** clients (`linearClient().comment(...)`, `slackClient().post(...)`, `githubClient().mergePullRequest(...)`, or the generic `relayClient(provider)` / `providerClient(provider)`) — catalog-backed, no hardcoded paths. The raw `@agentworkforce/runtime` VFS helpers (`readJsonFile` / `writeJsonFile`) stay the lower-level fallback. There are **no** per-provider clients on `ctx` (no `ctx.github` / `ctx.linear`)
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

> **Scope warning:** `"slack": {}` only works in this example because `agent.ts`
> below also declares a **slack trigger** — cloud mounts an integration's
> relayfile paths from triggers and from `scope`, nothing else. An integration
> that the handler only **writes** through (e.g. Slack notifications with no slack
> trigger) MUST declare a non-empty `scope`
> (e.g. `"slack": { "scope": { "paths": "/slack/channels/**" } }`) or every
> client write is a silent no-op. `scope: {}` is discarded by persona-kit, and
> scope values must be strings. Full rules: the `writing-agent-personas` skill, §1.

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

### Provider reads and writes — use `@relayfile/relay-helpers`

There are **no** `ctx.<provider>` clients. The ergonomic way to talk to a
provider is **`@relayfile/relay-helpers`** — opt-in factory clients whose paths
come from the adapter catalog (so they can't drift from the adapter). Add
`@relayfile/relay-helpers` to the persona's `package.json`, then:

```ts
import { linearClient, slackClient, githubClient } from '@relayfile/relay-helpers';

const linear = linearClient();                   // binds the mount root once (RELAYFILE_MOUNT_ROOT)
const issue = await linear.getIssue(issueId);    // read
await linear.comment(issueId, ':rocket: done');  // write

await githubClient().comment({ owner, repo, number }, 'LGTM');
await githubClient().mergePullRequest({ owner, repo, number, method: 'squash' });
await slackClient().post('#eng', 'shipped');
await slackClient().dm(userId, 'heads up');
```

A write is a draft file the Relayfile writeback worker turns into the real
provider call (with retry/durability) — handlers never hold a token or call a
provider REST API directly.

Every provider in the catalog has a named client (`notionClient`, `jiraClient`,
`gitlabClient`, …). When a provider has no bespoke method for what you need, use
the generic resource access — `providerClient('notion').pages.write({ databaseId }, {...})`
— or `relayClient('linear').write('issues', {}, {...})` when you need the raw
writeback **receipt** (e.g. the created issue's URL/id).

**Lower-level escape hatch.** For reads that are *not* catalog writeback
resources (e.g. a github PR's record JSON, a provider's `_index.json`), drop to
the generic VFS helpers from `@agentworkforce/runtime`.

**Never assume a record path — the mount self-describes its layout.** The
relayfile adapter publishes a guide per provider at `/<provider>/LAYOUT.md`
(e.g. `/github/LAYOUT.md`) and an `_index.json` at each level. Its first rule is
literally *"always run `ls` before constructing a path"*, because record
directory names are **not guessable**: a GitHub PR is
`pulls/<number>__<slug>/meta.json` (number + sanitized title slug), **not**
`pulls/<number>/meta.json`. Read `LAYOUT.md`, walk the `_index.json` files, and
`ls`/inspect a directory before reading from it:

```ts
import { readJsonFile, resolveMountRoot } from '@agentworkforce/runtime';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const root = resolveMountRoot({});
// LAYOUT.md + _index.json are the source of truth — read them, don't hardcode.
const pullsDir = path.join(root, 'github', 'repos', owner, repo, 'pulls');
const entry = (await readdir(pullsDir)).find((d) => d.startsWith(`${prNumber}__`));
if (!entry) throw new Error(`PR #${prNumber} not found under ${pullsDir}`);
const meta = await readJsonFile(
  { relayfileMountRoot: root }, 'github', 'getPr',
  `/github/repos/${owner}/${repo}/pulls/${entry}/meta.json`
);
```

> **Scope it in.** `LAYOUT.md` lives at `/github/LAYOUT.md` — a sibling of
> `repos/`, **not** under it. A scope like `/github/repos/<owner>/**` does NOT
> mount the guide; use `/github/**` (or otherwise include `/github/LAYOUT.md`)
> if the handler should read it.

When unsure of a resource or path, prefer the in-mount `LAYOUT.md` / `_index.json`
(runtime truth), then the catalog (`@relayfile/adapter-core/writeback-paths`) or
the adapter's `resources.ts` — never guess a filename.

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
- reaching for `ctx.github` / `ctx.linear` / etc. — those per-provider clients no longer exist; use `@relayfile/relay-helpers` (or the runtime VFS helpers)
- hardcoding `/<provider>/...` mount paths in the handler when a `@relayfile/relay-helpers` client already resolves them from the catalog
- invoking external commands (`curl`, `gh`, provider SDKs) for provider reads/writes that relay-helpers / the VFS helpers already cover via Relayfile draft writes
- assuming all provider payload fields exist without validation

## Deploying: lead the human from local login to a live cloud agent

Authoring isn't finished at the files — **drive the deploy end to end** with the
`agentworkforce` CLI. Run every non-interactive step yourself, hand the human
only the steps that genuinely need a browser, and narrate what each command
printed so they always know the state.

**What you (the agent) can do vs. what the human must do**

- **Human-only (interactive browser):** `agentworkforce login` (OAuth sign-in)
  and the per-provider **connect** popups during deploy. You can't complete a
  browser OAuth flow — ask the human to run the command / finish the popup, then
  continue.
- **You run:** the dry-run, the deploy itself (once the human is logged in),
  `deployments list`, reading the printed deployment URL/status, and `destroy`.
  (If your environment can't run the CLI at all, hand the human the exact
  commands below in order and tell them what each should print.)

**Runbook**

1. **Check auth.** If `~/.agentworkforce/active.json` is missing (or a CLI call
   401s), the human isn't logged in. Ask them to run `agentworkforce login` — it
   opens the browser to `https://agentrelay.com`, they pick a workspace, and it
   writes the pointer — then wait for them to confirm before continuing.
   `--workspace <id-or-slug>` skips the picker.

2. **Dry-run — you run this.** Validate before any side effects:

   ```bash
   agentworkforce deploy ./path/to/persona --mode cloud --dry-run
   ```

   Fix any preflight error (missing `onEvent`, wrong shape, an integration the
   `agent.ts` listens on but `persona.json` doesn't declare) and re-run until clean.

3. **Deploy — you run this; the human completes any connect popups.**

   ```bash
   agentworkforce deploy ./path/to/persona --mode cloud --on-exists update
   ```

   - It bundles `persona.json` + `agent.ts` and, for each provider in
     `persona.json.integrations` that isn't connected yet, opens a connect flow —
     relay that to the human and wait for them to finish before continuing.
   - `--on-exists update` redeploys over an existing persona of the same id.
     **Gotcha:** the default is `cancel`, a silent no-op — if a deploy "did
     nothing", you wanted `--on-exists update`.
   - `--reconnect <provider>` forces a fresh connect; `--no-connect` fails
     instead of prompting (use only when everything's already connected);
     `--input key=value` overrides a declared input; `--detach` backgrounds the runner.

4. **Confirm it's live — you run this.** Capture the deployment URL/status the
   deploy printed, then:

   ```bash
   agentworkforce deployments list       # what's running in the workspace
   ```

   Report back to the human: **the deployment link**, which triggers/schedules
   registered, and which integrations are connected. Tear down with
   `agentworkforce destroy ./path/to/persona` when needed.

Triggers/schedules/watch declared in `defineAgent(...)` register at deploy time,
so every integration the agent listens on must be connected — an unconnected
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
4. then **drive the deploy** per "Deploying" above — don't stop at the files.
   Run the dry-run and deploy yourself; ask the human to run `agentworkforce
   login` and to finish each integration-connect popup; and finish by reporting
   the live deployment link, the registered triggers/schedules, and the
   connected integrations.
