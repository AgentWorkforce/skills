---
name: writing-relayflows
description: Use when authoring a Relayflows flow (@relayflows/surface / @relayflows/sdk, the journal-based v2 engine — the CLI is `flows`, package versions 2.0.x) in TypeScript or YAML/JSON. Covers the three-rung ladder (run/llm/agent), the resident verbs (human/dispatch/done), verification gates (including which ones actually run today), per-step cli/model selection, flows.json, parallel agents, the agent-relay dispatch transport, and `flows check`/`run`/`deploy`/`schedule` with their real refusal shapes and exit codes. Not for the older, unrelated `@relayflows/core` WorkflowBuilder engine (`.pattern('dag')`/.agent()/.step() chains) that `writing-agent-relay-workflows` and `migrating-persona-to-relayflow` cover — that's a different product despite the similar name.
---

# Writing Relayflows

## Overview

Relayflows turns a coding-agent task into steps a journal can inspect, verify, and resume. A flow is data (YAML/JSON) or code (TypeScript) that compiles to the same journal-backed kernel spec. Every effect is journaled before it's treated as real — a journal write that fails fails the step, with no silent fallback.

**Name collision warning.** This repo also has skills for an older, unrelated engine that is *also* casually called "Relayflow" (singular) — `@relayflows/core`'s `WorkflowBuilder`, a chained builder (`workflow('name').pattern('dag').agent(...).step(...).run()`). That's `writing-agent-relay-workflows` and `migrating-persona-to-relayflow`'s territory. This skill is the **v2** engine: `@relayflows/surface`'s `flow()` function and the YAML/JSON dialect compiled by `@relayflows/sdk`. If you see `.pattern(`, `.agent(` as a chained builder call, or `ctx.workflow.run()`, you're in the other engine — stop and use one of those skills instead.

## When to use this skill

- Writing a new `.flow.ts` or `.flow.yaml`/`.flow.json` for the `flows` CLI (package `@relayflows/sdk`, binary name `flows`).
- Deciding whether a step needs `run` (shell), `llm` (bare model call), or `agent` (harnessed coding agent in a workspace).
- Choosing a verification gate that will actually run — a wrong choice here compiles fine and fails at `flows run` time, not authoring time.
- Wiring up `cli`/`model` for an `agent` or `llm` step, in either language.
- Debugging a `REFUSED [...]` message from `flows check` or `flows run`.
- Deciding between running a flow locally, deploying it to listen for tickets, or scheduling it on a cron.

## The ladder

Three step verbs, one per rung (`@relayflows/sdk`'s `StepType = 'deterministic' | 'llm' | 'agent'`):

1. **`run` / `deterministic`** — a shell command. No model. Implicit gate is `exit_code == 0`.
2. **`llm` / `llm`** — a bare model call. Prompt in, verified output out. No workspace, no tool use.
3. **`agent` / `agent`** — a harnessed coding agent in a workspace. Returns `{ summary, artifacts }`, not raw text.

Plus resident verbs that aren't ladder rungs: `human` (durable approval) and `dispatch` (hand off to a child flow) — both declared in the type, **neither executable yet**, see **Human approval and dispatch** — `done` (typed finish, works), the generated **helper** namespace (`f.slack`, `f.github`, `f.linear`, `f.notion`, `f.jira`, and 30+ others — see **Helpers**), and in YAML, `on`/triggers (event entry points — out of scope for this skill, see the [Cloud docs](https://agentrelay.com/docs/relayflows/cloud)).

Most flows only need `run` and `llm`. Climb to `agent` once a step needs hands on a real workspace.

## Two ways to author the same thing

**YAML/JSON** is data: `flows check` or CI can validate it without running anything. **TypeScript** calls the same primitives imperatively as ordinary async code. Both compile to the same journal.

### TypeScript

```ts
import { flow } from '@relayflows/surface';

export default flow('hello', { budget: { wallclock: '10m' } }, async (f) => {
  const greeting = await f.run('echo "Hello from Relayflows"');
  console.log(greeting.trim());

  const answer = await f.agent('greeter', {
    task: 'Reply with one short hello sentence. Do not use tools or modify files.',
    cli: 'claude',
    model: 'claude-sonnet-4-6',
  });
  console.log(answer.summary);

  f.done('success');
});
```

### YAML

```yaml
version: '0.1.0'
name: hello
steps:
  - id: greeting
    type: deterministic
    command: 'echo "Hello from Relayflows"'
  - id: greeter
    type: agent
    dependsOn: [greeting]
    instruction: 'Reply with one short hello sentence. Do not use tools or modify files.'
    cli: claude
    model: claude-sonnet-4-6
```

**Version note.** This skill was refreshed against `@relayflows/surface@2.0.16` and `@relayflows/sdk@2.0.16` — the current published npm packages, not a source build. Both examples above pass `flows check` for real against those versions (see **Verified against**).

## The real `Ctx` contract (TypeScript)

From the shipped `@relayflows/surface@2.0.16` `.d.ts` files (`dist/context.d.ts`, `dist/step.d.ts`, `dist/flow.d.ts`, `dist/completion.d.ts`):

```ts
export interface AgentResult {
  summary: string;
  artifacts: string[];
}

export interface AgentOptions {
  task: string;
  workspace?: string;
  cli?: string;
  model?: string;
  cwd?: string;                          // working dir for the CLI subprocess; defaults to the flow-runner's cwd
  transport?: 'direct' | 'relay';        // see Agent-relay transport, below
}

export interface LlmOptions {
  output: Record<string, unknown>;       // JSON Schema, checked before the journal accepts the result
  cli?: string;
  model?: string;
}

export interface Ctx extends Helpers {   // Helpers = f.slack, f.github, f.linear, f.notion, ... — see Helpers
  readonly mcp: Readonly<Record<string, Readonly<Record<string, (args: unknown) => Step<unknown>>>>>;
  run(command: string, options?: { timeout?: string | number }): Step<string>;
  llm(strings: TemplateStringsArray, ...values: unknown[]): Step<string>;
  llm(prompt: string, options: LlmOptions): Step<unknown>;
  agent(name: string, options: AgentOptions): Step<AgentResult>;
  human(question: string, options: { to: string }): Promise<boolean>;
  dispatch<T>(flow: string, input: unknown): Promise<T>;
  done(reason: FlowCompletionReason): void;
  cloud: CloudHelper;
  memory: MemoryHelper;
}
```

Do not add fields to `AgentOptions`/`Ctx` that aren't in this list — they don't exist in the shipped SDK. In particular: **no flow-level named-agent selector on `f.agent`, no `recoveryMode`/`permissions`/`surfaces`** on the TypeScript call site. Those are YAML/JSON step fields today. `FlowHeader` (`dist/flow.d.ts`) allows `use`, `identity`, `memory`, `budget`, `tools`, `workspace` — no bare `agents` map key (TypeScript composes reusable flows via `use: string[]` instead — see **Named agents and flow composition**). Passing an unknown header field or an unknown `AgentOptions` field throws a `TypeError` at authoring time, before anything is journaled.

`run()`'s second argument is a real, current option: `{ timeout?: string | number }` — a duration string (`"15m"`) or milliseconds. Every real cookbook example that runs something slower than a few seconds sets this explicitly.

### `f.done()`'s closed set is six values, not four

```ts
export const FLOW_COMPLETION_REASONS = ['success', 'step_failed', 'canceled', 'budget_exceeded', 'needs_human', 'declined'] as const;
```

An authored body can meaningfully call `f.done('success')`, `f.done('step_failed')`, `f.done('needs_human')` (parks the run — it's not a kernel cancellation), or `f.done('declined')` (a deliberate decision not to act — also not a cancellation). `'canceled'` and `'budget_exceeded'` exist in the same closed set but are the **kernel's** to record; a body calling them itself is calling the wrong verdict for what actually happened. The verdict for a human declining a durable approval is `f.done('declined')`, not `f.done('canceled')` — a human declining is a decision, not the kernel calling off the run. (Correct verdict *if* the approval call reaches that point — `f.human` itself doesn't execute yet; see **Human approval and dispatch**.)

`Step<T>` (`dist/step.d.ts`) is a `PromiseLike<T>` with one extra method, `.gate(...)` — see **Verification gates**, which has a critical caveat for the predicate form. Every awaited step must actually be awaited — an unawaited or manually-`.then()`-chained step is refused (`unawaited_step` / a manual `.then()` is not an await), not silently dropped.

## Verification gates

Verification is control flow, not decoration — a gate decides whether a step actually completed, not just whether the process exited cleanly.

### YAML/JSON (`@relayflows/sdk`'s `VerificationSpec`)

```ts
export type VerificationSpec = ExitCodeGate | OutputContainsGate | JsonSchemaGate | NamedDataGate;
// NamedDataGate = ReferencesInputGate | SubprocessGate | WordCountBoundsGate | RegexMatchGate
```

- `exit_code` — implicit default for `deterministic` steps. Not configurable; writing it explicitly is allowed and compiles to the same thing as omitting it.
- `output_contains` — step output (stdout tail, or the LLM value stringified) contains `value`.
- `json_schema` — step output validates against a JSON Schema (`boolean | Record<string, unknown>`). Used for structured LLM/agent output; `output?: JsonOutputSchema` on an `llm`/`agent` step is sugar that compiles to this.
- `subprocess_gate` — runs `command` under `/bin/sh`, judged on its exit code. The gate that actually works for "check a file the agent wrote": `{ type: 'subprocess_gate', command: 'test -s review.md' }`. If you also need to inspect the step's own output (via `from_output`), the SDK's generated wrapper reads its internal `FLOWS_INPUT` env var, extracts the value, and passes it to *your* command as `$INPUT` — `FLOWS_INPUT` itself is never visible to the author's command, only `$INPUT` is: `{ type: 'subprocess_gate', command: 'echo "$INPUT" | grep -q PASSED', from_output: ['summary'] }`.
- `regex_match` — the step's output (or a value at `in_output_at`) matches `pattern`, evaluated by a non-backtracking RE2 engine (only `i`, `m`, `s` flags).
- `word_count_bounds`, `references_input` — narrower named gates; see `packages/sdk/src/named-gates.ts` in the flows repo for the exact contract.

```yaml
- id: classify
  type: llm
  prompt: 'Classify this ticket as bug, feature, or question: "the export button does nothing"'
  cli: claude
  model: claude-sonnet-4-6
  verification:
    type: output_contains
    value: bug
```

### TypeScript (`Step<T>.gate(...)`) — read this before you write one

`Step<T>` has **two** overloads, and only one of them works today:

```ts
gate(config: NamedGate): Step<T>;
// NamedGate = ReferencesInputNamedGate | SubprocessNamedGate | WordCountBoundsNamedGate | RegexMatchNamedGate
// — the surface-visible subset of NamedDataGate above. This one is journal-honest and runs.

gate(predicate: (value: T) => boolean, because?: string): Step<T>;
// The type itself documents why this is dangerous — straight from the shipped .d.ts:
// "Predicate gates cannot be journaled — the JavaScript closure would not survive
//  replay — so the executor refuses this branch with unsupported_gate."
```

**Verified for real, this session, against `flows@main` (post-v2.0.16, current as of 2026-09-17):** any flow using the predicate form — `.gate((out) => out.trim().length > 0, "some reason")` — fails at `flows run` time with:

```
FAILED [protocol_error] relayflowd could not complete the run request: unsupported_gate:
postfix .gate(predicate) closures cannot be journaled; use .gate({type: "…", …}) with a
slice-P named gate instead.
```

This reproduced identically on two different real example flows (`examples/pr-review-pipeline`, `examples/dependency-upgrade-bot` in `AgentWorkforce/flows`) that both used the predicate form — neither got past their first gate. **Always use the config-object form**:

```ts
const outdated = await f.run('npm outdated --json 2>/dev/null || true')
  .gate({ type: 'subprocess_gate', command: 'test -n "$INPUT"' });   // not .gate((out) => out.length > 0, '…')

const review = await f.agent('review', { task: '…', cli: 'claude' })
  .gate({ type: 'subprocess_gate', command: 'test -s review.md' });  // checks a file the agent wrote, ignores $INPUT
```

(Verified for real: `.gate({ type: 'subprocess_gate', command: 'test -n "$INPUT" && echo "$INPUT" | grep -q pkg' })` against a step outputting `{"pkg":"left-pad"}` passes — `$INPUT`, not `$FLOWS_INPUT`, is what the author's command sees. `FLOWS_INPUT` is an env var the SDK's own generated wrapper reads internally to extract the value before invoking your command; it is never visible to `command` itself.)

[flows#449](https://github.com/AgentWorkforce/flows/pull/449) (open at time of writing) adds journaled `artifact_exists` gates and real predicate-gate support (the executor runs the closure once, on the journaled value, and journals the verdict) — check whether it's merged before assuming predicate gates still don't work. Until it lands, `subprocess_gate`/`regex_match`/`word_count_bounds`/`references_input` are the only gates that actually run in TypeScript.

An agent step rarely fails by crashing; it fails by returning something plausible and wrong, which a plain retry-on-error never catches. Always give an `agent`/`llm` step a real, config-object gate — never the default, never a predicate.

## Helpers: journaled effects, not just Slack

`Ctx extends Helpers`, and `Helpers` is generated from 40+ provider adapters shipped in `@relayflows/surface` — `slack`, `github`, `linear`, `jira`, `notion`, `salesforce`, `postgres`, `s3`, `redis`, `daytona`, `gmail`, `google-calendar`, `hubspot`, and more (`dist/helpers/index.d.ts` lists them all). A helper call — `f.slack.post(channel, text)`, `f.github.comment(...)` — compiles to a journaled effect: the receipt the helper returns *is* the journal record, so a retried step that already posted doesn't double-post; the second attempt is deduped by `(step_id, idempotency_key, surface_path)`.

Two things every helper call needs:

- **A relayfile mount for that provider**, locally — `flows check` refuses `helper_slack.credential_missing` (or the equivalent for another provider) without one. Cloud provides a mount for every connected provider automatically.
- **A declared intent** on the flow header: `tools: { slack: true }` in TypeScript, or the equivalent in YAML. Forgetting this is a separate, earlier failure than the mount check.

For local development without standing up a real provider mount, prefix the run with the provider's mock env var — `RELAYFLOWS_SLACK_MOCK=1 flows run ... --local-agent` records the effect (a real file under the daemon's data dir) instead of sending it. This does not exercise live delivery, and should be called out as such wherever you cite it as verification.

**`tools` means two different things depending on where you write it — do not confuse them:**

- `FlowHeader.tools` (TypeScript) / `FlowSpec` top-level `tools` you're declaring intent on: `Partial<Record<keyof Helpers, boolean>> & { relayfile?: string[]; mcp?: string[] }` — e.g. `{ slack: true }`. This is "which helpers this flow uses."
- `FlowSpec.tools` in the compiled YAML/JSON spec is instead `{ fs?: string | string[] }` — path-scoped **filesystem** grants, mirroring `workspace` for shell/deterministic steps. Not the same field, despite the identical name.
- `flows.json` (the project config file) has **no** `tools` field at all — see **`flows.json`**, below. Putting a `tools` key there is refused as `config_invalid`; this is an easy, first-try mistake (made once, personally, writing this refresh).

## `cli` / `model`: what a step actually runs on

Both YAML and TypeScript agent/llm steps can set `cli` and `model` directly. Resolution order for `cli`, identical regardless of authoring language because both compile to the same `StepSpec`:

1. **step** — `step.cli` (or TS's `options.cli`)
2. **named** — the flow's `agents[step.agent]` entry, if the step selects one via `agent: <name>` (YAML/JSON only — TypeScript composes reusable flows via `use:` instead, not a per-step named-agent selector; see **Named agents and flow composition**)
3. **flow** — `FlowSpec.cli` (YAML) — there is no equivalent flow-level `cli` field on the TypeScript `FlowHeader`
4. **project** — nearest `flows.json`'s `cli`, found by walking up from the flow file's directory

No resolution found at any level → `REFUSED [cli_unresolved]`, before anything is journaled, e.g.:

```
$ flows check hello.flow.yaml   # agent step, no cli anywhere
REFUSED [cli_unresolved] Step "greeter" has no CLI at step, flow, or project level. No flows.json was found from "..." to the filesystem root.
```

`model` has **no** flow or project default — only step or named-agent. Omitting it just runs whatever model the resolved CLI defaults to.

### `flows.json`

Nearest-wins project config, walking from the flow file's directory to the filesystem root. The shipped SDK type (`@relayflows/sdk`'s `FlowsJson`) is exactly:

```ts
interface FlowsJson {
  cli?: string;
  executors?: string[];
  models?: string[];
  mcp?: Record<string, McpServerConfig>;
  deploy?: { bucket: string };
}
```

- `cli` — the project-wide CLI default (resolution rung 4 above).
- `executors` — trigger executors this project has registered. A trigger whose `executor` isn't in this list is `no_executor`; a flow that declares `.on(...)` triggers but is invoked directly (not via a webhook) still needs its provider named here — e.g. `{ "executors": ["github"] }` for a flow with `.on(github.pull_request(...))` handlers, even when you never hit that code path.
- `models` — **an allowlist, not a default.** Any model declared on any step or named agent anywhere in the flow must appear here, or `flows check`/`flows run` refuses `model_unknown` / `llm_cli_unresolved`. Setting `models` does not select a model for anything.
- `mcp` — project-owned MCP server connections.
- `deploy` — a file-bucket target for `flows deploy <flow>@sha256:<digest> --to <bucket-uri>`.

**Verified for real:**

```
$ flows run hello.flow.ts --local-agent --input '{}'   # step declares model "claude-opus-5", flows.json has no models[]
REFUSED [invalid_spec] llm_cli_unresolved: Step "llm-1" declares model "claude-opus-5" for CLI "claude",
but it is not listed in project model registry "…/flows.json"; add the exact model only after verifying
that project is allowed to use it.

$ flows run pr-reviewer.flow.ts --local-agent --input '{...}'   # flow declares .on(github....) handlers, no executors[]
REFUSED [no_executor] webhook trigger "github" is not registered in flows.json
```

Any other top-level key — `tools`, `budget`, `identity`, `agents` — is refused as `config_invalid`. Those are `FlowHeader`/`FlowSpec` fields on the *flow itself*, not on the project config.

## Named agents and flow composition

**YAML/JSON**: a named-agent map declares each `{ cli, model }` pair once; a step's `agent:` selector resolves to it at compile time, and `flows check` flags a named agent nobody selects, or one a step overrides without using.

```yaml
agents:
  planner: { cli: claude, model: claude-opus-5 }
  implementer: { cli: codex, model: gpt-5.6-codex }
steps:
  - id: plan
    type: agent
    agent: planner
    instruction: '…'
```

**TypeScript** has no equivalent `agents:` map key on `FlowHeader` — the closest idiom is a plain object spread reused across calls:

```ts
const planner = { cli: 'claude', model: 'claude-opus-5' };
await f.agent('plan', { ...planner, task: '…' });
```

What TypeScript *does* have, which the map doesn't give you, is `FlowHeader.use?: string[]` — "relative paths to reusable authored flows composed by this body" ([flows#300](https://github.com/AgentWorkforce/flows/issues/300), closed). This is a real field in the shipped `2.0.16` type; this skill hasn't independently run a flow that exercises it, so treat its exact runtime semantics as a pointer to verify against `docs/SURFACE.md` and the flows repo, not as tested guidance the way the rest of this document is.

## Parallel agents

Running several agent (or any) steps concurrently is first-class, documented authoring — not a workaround:

> "…`Promise.resolve`, `Promise.all`, `Promise.allSettled`, `Promise.any` and `Promise.race` over authored steps" are "ordinary, supported authoring." — `docs/SURFACE.md`, the authored operation lifecycle

```ts
const LENSES = ['security', 'correctness', 'performance'] as const;

await Promise.all(
  LENSES.map((lens) =>
    f.agent(`${lens}-reviewer`, {
      task: `Review this diff for ${lens} issues ONLY. Write findings to review/${lens}.json.`,
      cli: 'claude',
    }).gate({ type: 'subprocess_gate', command: `test -s review/${lens}.json` }),
  ),
);

const consensus = await f.agent('consensus', {
  task: 'Read review/*.json. Resolve disagreement between lenses. Write review/consensus.json.',
}).gate({ type: 'subprocess_gate', command: 'test -s review/consensus.json' });
```

This is the exact shape `examples/pr-review-pipeline` in `AgentWorkforce/flows` (and the cookbook's would-be equivalent) uses: fan out, each lane writes its own file, a reconciliation step reads them all. **Disclosure worth knowing before you rely on it**: the flows package replaces the global `Promise.all` intrinsic, process-wide, for the lifetime of any authored flow execution, so the kernel can prove every concurrent step was actually awaited (rather than inferring group membership from callback identity). It delegates to the real intrinsic and restores it when the last concurrent flow closes — but any other code sharing that process sees the replacement during that window.

## Agent-relay transport: dispatch, not live chat

`AgentOptions.transport?: 'direct' | 'relay'` (default `'direct'`, a local subprocess). Setting `transport: 'relay'` dispatches the step to Agent Relay's own task infrastructure instead — per the shipped type's own doc comment: *"posts to agent-relay so the agent registers as a first-class workspace participant that DMs can steer."*

What this actually is, per `docs/AGENT-RELAY-TRANSPORT.md`: the step calls `POST /v1/actions/task.run/invoke` against relaycast, then waits for a durable final receipt — spawn readiness and invocation acceptance do **not** complete the step, only a terminal receipt does. It needs a pre-provisioned `RELAY_AGENT_TOKEN` (a workspace API key cannot substitute) and the Relay provider running with `AGENT_RELAY_TASK_PROVIDER=1`. The dispatched worker submits its result via an injected `agent_result` tool.

Don't describe this as "agents talking to each other" — there's no documented pattern in this skill's scope for two flow steps to hold a live back-and-forth over Relay channels while both are running. What's real: the step's agent becomes a genuine Agent Relay workspace participant while it runs (so a human, or another agent with the right access, can DM it and potentially steer it — per the type's own wording), and the flow still only sees a request-and-durable-receipt shape, not an open channel. Multi-agent *coordination* inside a flow today means sequential handoff (one step's return value feeds the next) or parallel fan-out (**Parallel agents**, above) — not live messaging.

## Human approval and dispatch (declared, not yet runnable)

`Ctx` declares `human(question, {to})` and `dispatch<T>(flow, input)`, and both typecheck and pass `flows check`. **Neither actually runs today.** Verified for real against `@relayflows/surface@2.0.16`:

```
$ flows run human.flow.ts --local-agent --input '{}'
FAILED [protocol_error] relayflowd could not complete the run request:
unsupported_verb: the initial authored executor does not lower f.human

$ flows run dispatch.flow.ts --local-agent --input '{}'
FAILED [protocol_error] relayflowd could not complete the run request:
unsupported_verb: the initial authored executor does not lower f.dispatch
```

Type availability does not establish executable support for either verb — the shipped executor throws `unsupported_verb` for both, identically, regardless of what the rest of the flow does. [flows#400](https://github.com/AgentWorkforce/flows/issues/400) tracks wiring up durable human approval; there's no dedicated tracking issue found yet for `f.dispatch`. Until one of these lands, treat both as authoring-surface-only:

```ts
// This typechecks and passes `flows check` — it will FAIL at `flows run` time.
// Do not ship a flow whose only path to done() runs through f.human or f.dispatch.
const ok = await f.human(`Ship this?\n${plan.summary}`, { to: 'khaliq' });
if (!ok) return f.done('declined');   // correct verdict, if this call ever executes
```

If you need durable approval today, do it in YAML with `permissions`/`recoveryMode: manual` (parks the run as `needs_human` with a diff for a person to resolve), or split the decision out to a separate, human-triggered flow run rather than a mid-flow `f.human` call.

**The same "types accept it, the executor doesn't" trap applies to `workspace` on an agent step under `--local-agent`.** Neither an annotated (`'acme/api: readonly'`) nor a bare (`'acme/api'`) value works — both fail identically:

```
REFUSED [invalid_spec] unsupported_workspace_permission: The local agent worker accepts
stream-only steps. Remove workspace or attach a worker that holds its revision pins.
```

It isn't the `: readonly`/`: readwrite` annotation syntax that's rejected — it's that the local-agent worker doesn't hold workspace revision pins at all. Omit `workspace` entirely for a step you intend to run with `--local-agent`; it's a real, working field only against a worker that supports it (Cloud's).

## Running it: `flows check` / `run` / `deploy` / `schedule`

```
flows check [--json] [--watch] <flow.ts|flow.yaml|spec.json>
flows run [--json] [--no-spawn] [--no-observer-link] [--data-dir <dir>] [--local-agent] <flow.yaml|spec.json>
flows run [--json] [--no-spawn] [--no-observer-link] [--data-dir <dir>] [--local-agent] <flow.ts> --input <inline-json-or-file>
flows resume [--allow-human-influenced] [--json] [--no-spawn] [--no-observer-link] [--data-dir <dir>] [--local-agent] <run-id>
flows deploy <flow.ts> --repo <owner/name> --on <provider>[:key=value,...] [--on ...] --approver <handle> [--agents claude[,codex]] [--name <name>] [--draft] [--json]
flows deployments [--json]
flows undeploy [--json] <deployment-id>
flows schedule <flow.ts> --cron "<expr>" --tz <tz> --input <inline-json-or-file>
```

`check` is a pure compile-and-preflight — no daemon, no socket, no data dir. It's the fast, safe way to validate a flow before ever running it, and it does accept `.flow.ts` despite older `--help` text implying only YAML/JSON.

**`--local-agent` is not optional decoration.** Without it, `agent`/`llm` steps have no worker to dispatch to and the run parks indefinitely rather than executing. Every local run in this skill's examples, and every real run in [`AgentWorkforce/flows-cookbook`](https://github.com/AgentWorkforce/flows-cookbook), passes it.

A `.flow.ts` run via `flows run` requires `--input <inline-json-or-file>` even when the flow body ignores its input argument.

**`--data-dir` gotcha, learned the hard way.** If a flow does its own git hygiene on the directory you invoke it from — `pr-reviewer`'s and similar examples' `git clean -fdq -e .workforce` when there's nothing to push — that cleanup deletes *anything else untracked in that directory*, including the daemon's own default `.relayflowd/` state if you didn't move it. The symptom is a bizarre `SQLite journal failed: unable to open database file` on the *next* run in the same checkout, because the previous run's own cleanup step deleted the very journal directory the daemon needed. Fix: put the daemon's data outside the checkout:

```bash
flows run pr-reviewer.flow.ts --local-agent --data-dir /somewhere/outside/the/repo --input '{...}'
```

**Before `flows deploy` will do anything, two things have to already be true — a correct command still fails without them:**

1. **You (or whoever's driving this) are logged in.** `agent-relay cloud login` once; check with `agent-relay cloud whoami`. There's no separate `flows`-specific login — it shares the `agent-relay` Cloud session.
2. **The workspace has a GitHub App installation covering `--repo`, and the `--on` provider is actually a connected integration** — not just declared in the command. `flows deploy` looks up the workspace's GitHub installation before it will activate a listener; with none, it refuses `flow_repository_not_connected` rather than deploying a broken one (`prepare-flow-deploy.ts` in `AgentWorkforce/cloud`). Check what's connected with `agent-relay cloud integration connections --workspace <id>` — a provider showing `degraded` instead of `ready` is not deploy-safe, even though the CLI won't tell you that until you try. This is a separate concern from your own local git push access (a personal git/`gh` credential thing, needed only for testing a flow's own `git push`/`gh pr create` steps locally) — don't conflate the two when debugging a refusal.

**`flows deploy`** creates a persistent listener: each matching ticket (`--on github:labels=agent`, `linear:team=ENG`, `jira:project=OPS`, `shortcut:workspace=…`, `slack:channel=#eng`) launches one Cloud run. `flows deployments` lists what's listening; `flows undeploy <id>` stops it — verified for real this session (deployed `software-factory` against a real repo with `--on linear:team=…`, got back `{"status":"listening", ...}`, then cleanly undeployed).

**`flows schedule`** puts a flow on a cron instead of a ticket trigger — newer (shipped after the `2.0.16` release line) and not yet reflected everywhere in older examples that instead show `flows run --cloud` for the same use case.

**Known current bug, filed and open at time of writing** ([flows#461](https://github.com/AgentWorkforce/flows/issues/461)): the one-shot `flows run --cloud [--sync-code] <flow.ts> --input <json>` form is broken for authored TypeScript flows — it either misroutes into the declarative-spec loader (`invalid_input: Cannot read or compile the declarative flow`) or refuses with a bare `http_error: HTTP 400`, regardless of flag order or a real git remote. `flows deploy` (the persistent-listener form) works correctly. If you need one-shot cloud execution of a TS flow today, expect this to fail and check whether #461 has landed before spending time on flag combinations.

### Exit codes and refusal shapes

Every refusal before a journal write is exit **2**, printed as `REFUSED [<kind>] <message>`. The `<kind>` differs by *how* the flow was checked, not just *what* was wrong:

- `flows check` on a YAML/JSON spec, or the declarative-compiler path in general → the preflight's own kind directly: `cli_unresolved`, `model_unknown`, `cli_missing`, `cli_unauthenticated`, `no_executor`, `config_invalid`, etc.
- `flows run` on a **TypeScript** `.flow.ts` whose authored `f.agent`/`f.llm` call can't resolve a CLI or model at runtime → wrapped and printed as `REFUSED [invalid_spec] <message>` with the specific reason (`llm_cli_unresolved`, etc.) inside the message text, not as the printed `[kind]` itself.

Both are real, both are exit 2 — the same underlying problem can print a different `[kind]` depending on whether you hit it via `flows check` on YAML or `flows run` on TypeScript.

## Common mistakes

- **Forgetting `version` in a YAML/JSON `FlowSpec`.** Required, not optional.
- **Using a predicate `.gate((v) => …, reason)` in TypeScript.** Refused at runtime (`unsupported_gate`) until [flows#449](https://github.com/AgentWorkforce/flows/pull/449) lands. Use a config-object gate — see **Verification gates**.
- **Putting `tools`, `budget`, or any other `FlowHeader` field into `flows.json`.** `flows.json` only accepts `cli`, `executors`, `models`, `mcp`, `deploy` — anything else is `config_invalid`.
- **Assuming `flows.json`'s `models` sets a default model.** It only validates models already declared elsewhere; it never selects one.
- **Declaring `.on(...)` trigger handlers without registering the provider in `flows.json`'s `executors`.** Even a flow you only ever run directly (never via a real webhook) needs this, or it's refused `no_executor` before your input is even read.
- **Calling `f.done('canceled')` for a human's "no."** That's `f.done('declined')` — `canceled` is the kernel's verdict, not an authored body's.
- **Running an agent/llm-bearing flow without `--local-agent`.** The run parks with nothing attached to do the work.
- **Letting a git-hygiene flow's cleanup step delete your daemon's own data dir.** Pass `--data-dir` outside the checkout for any flow that runs `git clean`/`git checkout --force` on its own working tree.
- **Not awaiting a step, or manually `.then()`-chaining one.** Refused (`unawaited_step`) rather than silently ignored.
- **Running a `.flow.ts` without `--input`.** Required even for flows that don't use their input argument.
- **Trying `flows run --cloud` for a one-shot TypeScript flow run.** Broken today — see [flows#461](https://github.com/AgentWorkforce/flows/issues/461). Use `flows deploy` for a persistent listener instead.

## What this skill does NOT cover

- **Triggers/webhooks** (`.on(github.pull_request(...), ...)`), **memory retrieval**, and the full **helper** catalog's per-provider quirks (`f.mcp`, provider-specific settings) — each is its own surface; see the [Relayflows product docs](https://agentrelay.com/docs/relayflows) and the [flows-cookbook](https://github.com/AgentWorkforce/flows-cookbook) for real, run-verified examples of each.
- **Named-agent map equivalent in TypeScript beyond `use:`** — `FlowHeader.use` exists in the shipped type but this skill hasn't independently run a flow that exercises it; verify current semantics against `docs/SURFACE.md` before relying on this section alone.
- **YAML-only agent step fields with no TypeScript equivalent**: `recoveryMode`, `permissions`, `surfaces`, and enforced `workspace` (TypeScript's `workspace` string is accepted by the type but rejected by the local-agent worker — see **Human approval and dispatch**). Author that step in YAML if you need them; `f.dispatch` is not a working escape hatch for this today (see below).
- The **older `@relayflows/core` `WorkflowBuilder`** engine — see `writing-agent-relay-workflows` and `migrating-persona-to-relayflow` in this repo.

## Quick reference

| Verb / field | Language | Notes |
|---|---|---|
| `f.run(command, {timeout?})` / `type: deterministic` | both | shell command, implicit `exit_code` gate |
| `f.llm(...)` / `type: llm` | both | bare model call, no workspace |
| `f.agent(name, opts)` / `type: agent` | both | harnessed coding agent, returns `{summary, artifacts}` |
| `f.human(question, {to})` | TS only | **not executable yet** — `unsupported_verb`; typechecks, fails at `flows run`. [flows#400](https://github.com/AgentWorkforce/flows/issues/400) |
| `f.dispatch(flow, input)` | TS only | **not executable yet** — `unsupported_verb`; typechecks, fails at `flows run` |
| `f.done(reason)` | TS / kernel | one of `success \| step_failed \| needs_human \| declined` from an authored body; `canceled \| budget_exceeded` are kernel-only |
| `.gate({type: '...', ...})` | TS | the only `.gate()` form that runs today — config object, never a predicate |
| `options.transport: 'relay'` | TS/YAML `agent` step | dispatch to Agent Relay's task infra; request+receipt, not live chat |
| `Promise.all([...steps])` | TS | first-class supported concurrent fan-out |
| `flows.json`: `cli, executors, models, mcp, deploy` | project config | exact accepted key set — nothing else |
| `flows check <file>` | CLI | pure validate + preflight, no daemon |
| `flows run <file> --local-agent [--input ...]` | CLI | actually executes; `.flow.ts` needs `--input`, agent/llm steps need `--local-agent` |
| `flows deploy <flow.ts> --repo ... --on ...` | CLI | persistent trigger-based listener; needs `agent-relay cloud login` plus a connected GitHub App + `--on` provider first, or `flow_repository_not_connected` |
| `flows run --cloud <flow.ts> --input ...` | CLI | broken for TS today, [flows#461](https://github.com/AgentWorkforce/flows/issues/461) |
| `flows schedule <flow.ts> --cron ...` | CLI | cron-based cloud run |

## Verified against

`@relayflows/surface@2.0.16` and `@relayflows/sdk@2.0.16` (the published npm packages) — types read directly from the shipped `.d.ts` files, not from documentation or memory. Beyond static type-checking, the claims in this refresh that carry a **real run**, not just `flows check`, are backed by the recipes in [`AgentWorkforce/flows-cookbook`](https://github.com/AgentWorkforce/flows-cookbook) — each recipe's own README states exactly what was run, when, and what the result was (a real local run, a real Cloud deploy, or both), rather than duplicating that evidence here where it will go stale. If a claim in this skill and a cookbook recipe's README disagree, trust whichever was verified more recently — check the README's date.

The predicate-gate failure, the `flows.json` schema refusal, the `--data-dir` git-hygiene interaction, and the `flows run --cloud` bug were all reproduced directly while building that cookbook, on `AgentWorkforce/flows@main` past the `v2.0.16` tag (2026-09-17). A subsequent review pass (Devin, on this PR) flagged three more claims worth checking rather than trusting on sight — `f.human`/`f.dispatch` executability, the `workspace: readonly` annotation, and the `subprocess_gate` env var name — all three were independently re-run against the real CLI, confirmed as real breaks (one of the review's own suggested fixes, for `workspace`, turned out not to work either — the bare form fails identically to the annotated one), and corrected in the sections above rather than taken on the reviewer's word alone.
