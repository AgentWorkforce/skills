---
name: creating-cloud-persona
description: Use when creating, updating, or reviewing a Workforce cloud persona (`persona.json`/`persona.ts` + `agent.ts`) for the current deploy/runtime shape. Covers `cloud`, `useSubscription`, integrations and scope mounting, inputs, memory, sandbox modes, `onEvent`, top-level runtime fields, `defineAgent(...)` triggers/schedules/watch/team-dispatcher launch, provider IO via `@relayfile/relay-helpers`, production-correctness traps, vendored examples, and deploy flow. Use for requests like “create a cloud persona”, “write a deployable workforce persona”, “add integrations to a persona”, “review a workforce persona”, or “author the agent.ts handler for a workforce persona”.
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

Before authoring, read the vendored examples and current types in this skill's
`references/` directory. They are copied from the current Workforce and agents
repos so the skill is self-contained.

Production agents:

- `references/agents/review/persona.json`
- `references/agents/review/agent.ts`
- `references/agents/repo-hygiene/persona.json`
- `references/agents/repo-hygiene/agent.ts`
- `references/agents/linear/persona.json`
- `references/agents/linear/agent.ts`
- `references/agents/hn-monitor/persona.json`
- `references/agents/hn-monitor/agent.ts`
- `references/agents/cloud-team-implementer/persona.json`
- `references/agents/cloud-team-implementer/agent.ts`
- `references/agents/cloud-team-reviewer/persona.json`
- `references/agents/cloud-team-reviewer/agent.ts`

Workforce examples:

- `references/workforce/examples/review-agent/persona.json`
- `references/workforce/examples/review-agent/agent.ts`
- `references/workforce/examples/weekly-digest/persona.json`
- `references/workforce/examples/weekly-digest/agent.ts`
- `references/workforce/examples/linear-shipper/persona.json`
- `references/workforce/examples/linear-shipper/agent.ts`
- `references/workforce/examples/notion-essay-pr/persona.json`
- `references/workforce/examples/notion-essay-pr/agent.ts`
- `references/workforce/examples/proactive-issue-resolver/persona.json`
- `references/workforce/examples/proactive-issue-resolver/agent.ts`

Current types and deploy checks:

- `references/workforce/packages/persona-kit/src/types.ts`
- `references/workforce/packages/runtime/src/types.ts`
- `references/workforce/packages/persona-kit/schemas/persona.schema.json`
- `references/workforce/packages/deploy/src/preflight.ts`
- `references/workforce/packages/deploy/src/extract-agent.ts`
- `references/workforce/packages/cli/src/deploy-command.ts`
- `references/relayfile-adapters/packages/relay-helpers/README.md`

## Current persona shape to follow

Prefer the **actual shipped shape**, not older plan text.

For cloud personas, expect fields like:

- `id`
- `intent`
- `tags`
- `description`
- `cloud: true`
- `useSubscription` (optional)
- `integrations` (optional, for provider connection requirements **and mount scope** — each integration declares both the connection and the relayfile paths it mounts; see Authoring rule 3)
- `memory` (optional; production agents use both `true` and object form)
- `onEvent`
- top-level runtime fields, when the agent uses a harness:
  - `harness`
  - `model`
  - `systemPrompt`
  - `harnessSettings`
- optional `inputs`, `env`, `sandbox`, `skills`, `permissions`, `mount`, `mcpServers`, `capabilities`

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
- declares `triggers`, `schedules`, and optionally `watch`; team-member agents
  can intentionally declare none and use `launchedBy: 'team-dispatcher'`
- receives `ctx` and `event` in `handler`
- inspects `event.source`
- inspects `event.type` or `event.name`
- reads and writes provider data through **`@relayfile/relay-helpers`** clients (`linearClient().comment(...)`, `slackClient().post(...)`, `githubClient().mergePullRequest(...)`, or the generic `relayClient(provider)` / `providerClient(provider)`) — catalog-backed, no hardcoded paths. The raw `@agentworkforce/runtime` VFS helpers (`readJsonFile` / `writeJsonFile`) stay the lower-level fallback. There are **no** per-provider clients on `ctx` (no `ctx.github` / `ctx.linear`)
- optionally calls `ctx.harness.run(...)`
- optionally calls `ctx.llm.complete(...)` for smaller synthesis
- optionally delegates to `ctx.workflow.run(...)`
- optionally uses `ctx.files.*` or `ctx.sandbox.*`
- optionally uses `ctx.memory.*`
- performs the actual workflow

## Trigger model

Cloud agents currently have four practical shapes, and wakeups are authored in
`agent.ts`:

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

4. **Team member** via `defineAgent({ launchedBy: 'team-dispatcher', handler })`
   - no direct triggers/schedules/watch
   - launched by a lead/team dispatcher to avoid duplicate subscriptions
   - see `references/agents/cloud-team-implementer/agent.ts` and
     `references/agents/cloud-team-reviewer/agent.ts`

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

### 3. Only declare integrations the agent actually requires — with a `scope`

If `agent.ts` never uses Slack behavior or Slack-backed writes, do not declare Slack in `persona.json` just because it might be useful later.

And for the integrations you *do* declare, **also declare a mount `scope`**. The
persona-kit type is
`PersonaIntegrationConfig { source?: IntegrationSource; scope?: Record<string, string> }`,
where `scope` maps a resource name to an absolute relayfile glob. An **unscoped
provider mirror is dropped** — `slack: {}` (and `scope: {}`) mounts no provider
data, so reads come back empty and writes land on unmounted disk as silent
no-ops. Scope the **concrete subpaths** the handler actually reads and writes
back to, and nothing more (a bare `/provider/**` is dropped from the mirror, same
as no scope):

```ts
integrations: {
  // Replies in-thread (writeback to /slack/channels/{id}/messages), so scope channels.
  slack: { scope: { channels: '/slack/channels/**' } },
  // Read-only Linear context — scope the concrete subpaths the handler reads.
  linear: { scope: { projects: '/linear/projects/**', issues: '/linear/issues/**' } }
}
```

The full mechanics and the labelled-mirror sub-trap are in the
production-correctness checklist below (§1).

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
    "github": { "scope": { "paths": "/github/**" } },
    "slack": { "scope": { "paths": "/slack/channels/**" } }
  },
  "memory": {
    "enabled": true,
    "scopes": ["workspace"]
  },
  "onEvent": "./agent.ts",
  "harness": "codex",
  "model": "gpt-5.5",
  "systemPrompt": "Review pull requests for correctness, regression risk, security concerns, and missing tests. Be concise and concrete.",
  "harnessSettings": {
    "reasoning": "medium",
    "timeoutSeconds": 1200,
    "sandboxMode": "workspace-write",
    "workspaceWriteNetworkAccess": true
  }
}
```

> **Scope warning — a Slack trigger does NOT cover a Slack write.** Cloud mounts
> an integration's relayfile paths from triggers and from `scope`, nothing else.
> A trigger mounts a *read* mirror at the display-labelled path
> `/slack/channels/{id}__{name}/...`, but `slackClient().post()` writes to the
> canonical bare-id path `/slack/channels/{id}/messages` — the two never
> coincide, so a slack trigger alone leaves every write a silent no-op. That is
> why this example **scopes** `slack` rather than using `"slack": {}`, even
> though `agent.ts` below declares a slack trigger. Any integration the handler
> **writes** through needs a non-empty `scope`
> (`"slack": { "scope": { "paths": "/slack/channels/**" } }`); github/linear
> writes are the exception only because their trigger and writeback paths share
> one bare-id form. `github` is still scoped here so the reviewer's **reads**
> (the PR records and `/github/LAYOUT.md` it walks beyond its trigger subtree)
> are mounted — an unscoped `"github": {}` mirror is dropped. `scope: {}` is
> discarded by persona-kit, and scope values must be strings. Full rules are in
> the production-correctness checklist below (§1).

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
- `ctx.llm.complete(...)`
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
- write back with `@relayfile/relay-helpers`; use `writeJsonFile(...)` only
  for lower-level VFS/resource cases that the helper catalog does not cover

### Mixed schedule + integrations agent

Fine to combine both in one cloud agent when the role is coherent.
Examples:

- responds to Slack mentions and also runs a daily cleanup
- reacts to GitHub events and runs a weekly scan

Do not combine unrelated jobs into one agent just because the runtime allows it.

### Team member agent

Use when the persona is launched by a team dispatcher, not directly by provider
events.

Persona:

- `cloud: true`
- usually declares integrations needed by the member's sandbox/work
- harness/model/systemPrompt/harnessSettings describe the member role
- `onEvent: "./agent.ts"`

Agent:

- `defineAgent({ launchedBy: 'team-dispatcher', handler })`
- no `triggers`, `schedules`, or `watch`
- handler should usually log and return if invoked directly
- do not subscribe team members to the same provider events as the lead, or the
  lead and every member can fire for the same issue/PR

## Production correctness checklist

These rules came from shipped Workforce/agents defects. Apply them after the basic persona shape is in place and before deploy.

## 1. THE INTEGRATION SCOPE TRAP — declared ≠ mounted

**A persona integration without a `scope` mounts nothing.** Cloud derives the
relayfile mount paths (and the relayfile token's path scope) from exactly two
sources: the agent's **triggers** and each integration's **scope**
(`cloud → packages/web/lib/proactive-runtime/persona-deploy.ts`,
`relayfilePathsFromScope`). A bare declaration like:

```ts
integrations: {
  github: {},
  slack: {}     // ← INERT: no trigger, no scope → zero /slack paths mounted
}
```

means `slackClient().post(...)` writes its draft JSON to **unmounted local
disk**, polls ~3s for a writeback receipt that can never arrive, and returns
`{channel, ts: ''}` **without throwing** (adapter-core `vfs-client`
`writeJsonFile` → `waitForReceipt` returns `undefined` on timeout). The
notification is a perfectly silent no-op — this shipped as the pr-reviewer
Slack bug (agents#40).

The same `ts: ''` signature also appears when the scope **is** set but the
mount's read-side mirror never finished bootstrapping (e.g. a file/dir path
collision aborts every sync cycle), so the writeback can't be acknowledged — and
that one additionally marks the whole cloud run FAILED on the teardown flush. If
you see `ts: ''`, rule out a stuck mirror, not just a missing scope (see
[`setting-up-relayfile` → "cloud run marked FAILED but the handler logged
`runner.handler.ok`"](../setting-up-relayfile/SKILL.md#symptom-cloud-run-marked-failed-but-the-handler-logged-runnerhandlerok)).

Why github "just works" in most personas while slack doesn't: github usually
appears in `triggers`, and trigger paths are mounted independently of scope.
Any integration the handler only **writes** through (slack notifications,
linear comments on non-trigger issues) has no trigger to save it.

**The labelled-mirror sub-trap — a trigger that LOOKS like it covers the write
but doesn't.** A trigger mounts the watched subtree as a *read* mirror, and for
some providers the mirror path is **display-labelled** while the writeback path
is **canonical bare-id**. Slack is the production case: the trigger mirrors the
channel at `/slack/channels/{id}__{name}/messages` (channel id + `__` + name),
but `slackClient().post()` writes to `/slack/channels/{id}/messages` (bare id).
The two **never coincide**, so a Slack trigger does NOT cover a Slack write —
the draft still lands on unmounted disk and the post is a silent no-op even
though the run logs `handler.ok`. This shipped as the **linear-slack bug
(2026-06)**: the agent had a `slack` trigger on its board channel and *still*
posted into the void; the orphaned draft was recovered from the live sandbox.
github/linear are immune because their trigger and writeback paths share one
bare identifier form (`/github/repos/{owner}/{repo}/...`,
`/linear/issues/{issueId}/...`).

Rules:

- Every integration the handler writes through needs a trigger **or** a
  non-empty `scope` — **except Slack (and any display-labelled mirror): a Slack
  WRITE always needs a `scope`; a trigger is never enough.** Safest default:
  give every write-through integration an explicit `scope`.
- **Make delivery loud.** `post()`/`reply()`/`dm()` resolve with `ts: ''`
  instead of throwing when the writeback gets no receipt (the `ts: ''` signature
  above), so a dropped post still logs `handler.ok`. Treat an empty `ts` as
  failure (`if (!result.ts) throw …`) so the runtime surfaces `handler.error`
  instead of a silent no-op.
- **`scope: {}` does NOT work.** persona-kit's `parseIntegrationConfig`
  discards empty scope objects client-side before upload, so cloud's
  `/<provider>/**` provider-root fallback is unreachable from a persona.
- Scope values must be **strings** (persona-kit `parseStringMap` throws on
  arrays). A value starting with `/` is used verbatim as a mount glob; a bare
  value `v` under key `k` becomes `/<provider>/<k>/<v>/**`.
- When the target is picked at deploy time (e.g. a `SLACK_CHANNEL` input),
  scope the subtree, not the instance:

```ts
slack: {
  scope: { paths: '/slack/channels/**' }   // covers any picked channel, excludes DMs/users
}
```

- **A scope root must be a concrete prefix — a mid-path `*` mounts NOTHING.**
  Cloud reduces each scope to a remote root via `scopedRemoteRoot`
  (`cloud/packages/core/src/relayfile/mount-script.ts`): it strips a trailing
  `/**`, then **discards the path entirely if any `*` remains** (and
  `relayfile-mount --remote-path` only accepts a concrete prefix, never a glob).
  So a `*` is allowed *only* in the final `/**`:

  ```ts
  // ❌ silently dropped — the mid-path `*` survives the /** strip → mounts nothing
  github: { scope: { paths: '/github/repos/AgentWorkforce/*/pulls/**' } }
  // ✅ concrete root — mounts; filter to the repos/PRs you want in the handler
  github: { scope: { paths: '/github/**' } }
  ```

  This is doubly silent: the deploy still mints a matching fs token and the path
  passes string validation, so nothing errors — the handler just reads an empty
  tree. It bit daily-ship (every digest said "No PRs merged"). Pick the broadest
  concrete root and narrow in code. (Platform hardening tracked in
  `AgentWorkforce/cloud#1986`.)

- **Verify after compiling**: run `agentworkforce persona compile <dir>/persona.ts`
  and check the generated persona.json still carries `integrations.<p>.scope`.
  If persona-kit dropped it, the deployed persona is silently inert.
- Pin a test (see §6): parse `persona.integrations` through persona-kit's
  `parseIntegrations` and assert the scope survives as a non-empty map covering
  the writeback subtree your client uses.

## 2. `sandbox: true` vs `sandbox: false`

`sandbox` is a top-level boolean on the persona spec
(persona-kit `parse.js` `parseSandbox`; default **true** when omitted).

| | `sandbox: true` (default) | `sandbox: false` |
|---|---|---|
| Daytona box | provisioned per fire (seconds of cold start) | **none** — handler runs in the persona runner (ms) |
| `ctx.sandbox.exec()` | available | **rejects** (`SandboxNotAvailableError`) |
| `ctx.files.read/write` | available | unavailable — use VFS helpers (`readJsonFile`/`writeJsonFile`) against provider paths |
| `ctx.harness.run()` | available | **still works** |
| Harness CLI credentials | mounted | not mounted |
| PR-reviewer checkout / PR writeback / conflict-autofix / git workspace clone | available when capabilities declared | **disabled even if declared** (cloud gates them on `!lightweightSandbox`, `deployment-trigger-delivery.ts`) |

Pick `sandbox: false` for chat-lead / read-classify-reply personas that touch
provider data only through relayfile (e.g. the linear chat lead). Pick the
default for anything that clones repos, runs shells, or uses PR capabilities.

## 3. Inputs — declaration and resolution

Declare inputs in the persona spec:

```ts
inputs: {
  SLACK_CHANNEL: {
    description: 'Channel for review pings.',
    env: 'SLACK_CHANNEL',
    optional: true,                                  // no default → unset means feature off
    picker: { provider: 'slack', resource: 'channels' } // deploy-UI picker; stores channel ID
  }
}
```

Resolution facts (verified against cloud delivery + runtime):

- Cloud does **not** export each input as a bare env var in the sandbox.
  Input values travel inside `WORKFORCE_AGENT_CONTEXT` (JSON) and surface as
  `ctx.persona.inputs` (the runtime merges the `inputValues` / `input_values`
  aliases).
- The conventional handler accessor checks env first (local dev), then ctx:

```ts
function input(ctx: WorkforceCtx, name: string): string | undefined {
  const spec = ctx.persona?.inputSpecs?.[name];
  const v = process.env[spec?.env ?? name] ?? ctx.persona?.inputs?.[name] ?? spec?.default;
  return typeof v === 'string' && v.trim() ? v : undefined;
}
```

- An **optional input with no default that gates a feature** means the feature
  is off-by-config when undeployed — fine, but document it, and remember it
  compounds with §1: the feature needs the input set **and** the path mounted.
- Picker types observed in production: `{provider:'slack', resource:'channels'}`,
  `{provider:'github', resource:'users'}`. Pickers store provider IDs
  (e.g. `C…` channel IDs), not display names.

## 4. Harness and model selection

- `harness`: which CLI runs `ctx.harness.run()` prompts — `'codex'` or
  `'claude'`. `model` must match the harness family (e.g. `gpt-5.x` for codex;
  `claude-*` for claude).
- `harnessSettings`: `reasoning`, `timeoutSeconds`, `sandboxMode`,
  `workspaceWriteNetworkAccess`, and
  `dangerouslyBypassApprovalsAndSandbox: true` — required for codex in cloud
  fires because **Daytona is the trust boundary** and codex's nested bubblewrap
  sandbox needs user namespaces Daytona doesn't allow. Say so in a comment when
  you set it.
- Version pinning: capabilities and spec fields are parsed **client-side by
  persona-kit before upload**. A persona-kit older than the field you're using
  silently strips it (this shipped as the teamSolve-capability strip). Exact-pin
  `@agentworkforce/persona-kit` (and cli/runtime) in the repo and verify the
  compiled artifact carries every field you depend on.

## 5. Teams — `teamSolve` capability and `team.json`

A lead persona opts into team orchestration via capabilities
(`cloud → packages/core/src/proactive-runtime/capabilities.ts`):

```json
"capabilities": {
  "teamSolve": {
    "enabled": true,
    "maxMembers": 1,          // default 4, hard-capped at 4
    "roles": ["implementer"], // default ["lead","impl","reviewer","prober"]
    "tokenBudget": 400000,    // default 400000
    "timeBudgetSeconds": 1800 // default 1800
  }
}
```

Multi-member rosters bind through `team.json`
(`cloud → packages/core/src/proactive-runtime/team-spec.ts`, loaded from the
persona directory; bound via `PUT /api/v1/workspaces/{id}/teams`):

```json
{
  "id": "my-team",                      // must match the team directory name
  "lead": "alice",                      // must reference a member name
  "members": [
    { "name": "alice", "persona": "alice-persona-slug", "role": "lead" },
    { "name": "bob",
      "persona": { "slug": "bob-persona-slug", "version": 2 },
      "role": "implementer",
      "owns": [ { "issue.labels": ["bug"] } ] }
  ],
  "tokenBudget": 1000000,
  "timeBudgetSeconds": 3600
}
```

Validation: unique member names and persona refs, no duplicate `owns`
ownership, `inline` persona refs rejected (Phase 1). Members resolve to
already-deployed personas in the workspace — deploy members first, then bind.
Spawning is cloud-side (`launchMember`); there is **no in-box
`ctx.team.spawn`** — don't write handler code that assumes one.

## 6. The showcase quality bar (AgentWorkforce/agents repo)

The agents repo is a public showcase. Merges get blocked on brittleness even
when the code works and is approved. The bar:

- **No inline base64 blobs, no `node -e` one-liners, no hand-rolled shell
  quoting** inside handlers or workflows. Extract checked-in helper scripts.
- **Pass data as JSON arguments** (a JSON file or single JSON env/arg), never
  as positional shell argv that needs quoting.
- **Golden tests are a merge gate.** Exported pure helpers (`readPr`,
  `labelNames`, allowlist deciders) get node:test coverage in `tests/`; persona
  config invariants (like §1's scope) get pinned with a test proven **red**
  against the broken shape before the fix lands.
- persona.json is **generated** from persona.ts in the agents repo (untracked
  since agents#24) — edit persona.ts, never the artifact.

## 7. `onEvent` handler patterns

Declare wakeups in `defineAgent({...})` (triggers / schedules / watch);
branch imperatively in the handler. Hard-won guard patterns:

- **First line** (single-provider personas): `if (event.source !== '<provider>') return;` — multi-provider handlers branch per `event.source` instead of returning early.
- **Terminal-event guards before work**: approval → merge → return;
  green check_run → return; only then the expensive review path.
- **Read materialized meta defensively.** Provider projections drift — accept
  both shapes when one has shipped (`author?: string | { login?: string }`),
  and decide explicitly whether a gate **fails open or closed** when meta is
  missing (author allowlist: fail closed; skip-label check on a payload that
  lacks labels: fail open). Comment the choice.
- **Cron**: discriminate with `event.name`, but never write a guard that
  no-ops the whole persona when `event.name` is empty — cloud's cron payload
  has shipped without the schedule name, turning `event.name !== 'daily'`
  into a permanent silent no-op. Prefer "route by name when present, default
  to the single schedule's behavior otherwise" for single-schedule personas.
- **Sentinel contracts with the harness**: if the handler keys behavior off
  harness output (e.g. a literal `READY` last line), spell the contract out in
  the prompt and parse only the last line — and remember output-tail
  truncation preserves the end, not the start.
- Log skips with reasons (`ctx.log?.('info', 'skipped', { reason })`) — a
  silent return is indistinguishable from a delivery failure during triage.

## 8. Delegation — `ctx.workflow.run` vs `ctx.harness.run`

Two ways to do heavy work; pick by shape:

| | `ctx.harness.run(args)` | `ctx.workflow.run(name, args)` |
|---|---|---|
| What | one prompt through the persona's harness CLI | a multi-step agent-relay workflow (DAG of deterministic + agent steps) |
| Returns | `{ output, exitCode, durationMs }` directly | `{ runId, completion() }`; `await completion()` → `{ output, status }` |
| Use for | single coding/review task in the box | clone → implement → open-PR pipelines, multi-agent coordination |

The **thin-lead pattern** (linear chat lead,
`references/agents/linear/agent.ts`):
classify intent with a cheap harness/LLM call → **reply to the user
immediately** ("starting an implementation workflow…") → delegate via
`ctx.workflow.run` → on completion, post the result (e.g. extract the PR URL
from `completion.output`). The chat handler stays responsive; the workflow
carries the long work. Keep workflow definitions as checked-in files under
`workflows/` (see §6) rather than assembling source strings in the handler.

## 9. Relayfile — how provider clients actually resolve

`slackClient()` / `linearClient()` / `githubClient()` / `providerClient(p)`
from `@relayfile/relay-helpers` are **not** HTTP clients. A `write` resolves a
catalog path (`/slack/channels/{channelId}/messages`), drops a uniquely-named
draft JSON under the **mount root**, and waits for the writeback worker to
replace it with a receipt. Reads (`readJsonFile`, `.list()`) read materialized
JSON from the same tree.

Consequences:

- **The path must be mounted** (token-scoped + daemon-watched) or the draft
  sits on local disk forever and the call returns silently — see §1.
- **Anchor the mount root explicitly.** The runner's CWD is not the mount
  root (CWD `…/workforce-runtime` vs mount `…/workspace` shipped as a real
  ENOENT bug). Pass `{ relayfileMountRoot: resolveMountRoot({}) }` or rely on
  the `RELAYFILE_MOUNT_ROOT` env — never on relative paths from CWD.
- **A returned receipt is the success signal.** `result.receipt?.created/id`
  present → delivered; absent after the wait → not delivered (the call does
  not throw for an unmounted path). If delivery is load-bearing, check the
  receipt and surface the failure.
- Item paths (ending `.json`) are direct read/write; collection paths take
  drafts and `.list()`. Encode user-supplied path segments with
  `encodeSegment(...)`.
- Terminal provider states (closed/merged/archived) stay readable as records
  with terminal status — never model them as deletions.

## Production pre-merge checklist

1. Every written-to integration has a trigger or a non-empty, string-valued
   scope (§1) — and the **compiled** persona.json still carries it.
2. `sandbox` matches the capability set (§2) — no `ctx.sandbox.exec` /
   PR-capability reliance under `sandbox: false`.
3. Feature-gating inputs documented; resolution goes through a `input(ctx, …)`
   helper, not bare `process.env` (§3).
4. Harness/model pair valid; persona-kit/cli/runtime pinned; compiled artifact
   carries every capability you declared (§4, §5).
5. Tests pin the config invariants and were proven red against the broken
   shape (§6).
6. Handler guards: source check first, terminal events early-returned,
   defensive meta reads with explicit fail-open/closed choices, no
   empty-`event.name` no-op gate (§7).
7. Writeback receipts checked where delivery matters (§9).


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
3. `agent.ts` uses `defineAgent(...)` with either a listener source:
   - `triggers`, or
   - `schedules`, or
   - `watch`
   or an intentional team-member shape like `launchedBy: 'team-dispatcher'`
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
