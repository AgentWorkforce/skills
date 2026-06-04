---
name: writing-agent-personas
description: Use when authoring or reviewing an AgentWorkforce persona (persona.ts/persona.json + agent.ts) and you need the rules and traps that make personas actually work in production — integration scope mounting (the silent-Slack trap), sandbox true/false implications, input plumbing, harness/model selection, team.json shape, the agents-repo showcase quality bar, onEvent guard patterns, ctx.workflow.run delegation, and how relay-helpers clients resolve against relayfile mounts. Complements creating-cloud-persona (basic shape); this skill is the production-correctness ruleset.
---

# Writing Agent Personas

Production-correctness rules for AgentWorkforce personas. `creating-cloud-persona`
covers the basic persona.json + agent.ts shape; **this skill covers the rules that
make the persona actually work once deployed** — most of them learned from real
shipped defects. Each rule cites the code that enforces it.

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

Why github "just works" in most personas while slack doesn't: github usually
appears in `triggers`, and trigger paths are mounted independently of scope.
Any integration the handler only **writes** through (slack notifications,
linear comments on non-trigger issues) has no trigger to save it.

Rules:

- Every integration the handler writes through needs a trigger **or** a
  non-empty `scope`.
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

The **thin-lead pattern** (linear chat lead, `agents/linear/agent.ts`):
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

## Pre-merge checklist

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
