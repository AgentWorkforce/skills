---
name: writing-relayflows
description: Use when authoring a Relayflows flow (@relayflows/surface / @relayflows/sdk, the journal-based v2 engine — the CLI is `flows`, package versions 2.0.x) in TypeScript or YAML/JSON. Covers the three-rung ladder (run/llm/agent), the resident verbs (human/dispatch/done), verification gates, TypeScript vs YAML authoring, per-step cli/model selection and its resolution order, flows.json, and `flows check`/`run`/`resume` with their real refusal shapes and exit codes. Not for the older, unrelated `@relayflows/core` WorkflowBuilder engine (`.pattern('dag')`/.agent()/.step() chains) that `writing-agent-relay-workflows` and `migrating-persona-to-relayflow` cover — that's a different product despite the similar name.
---

# Writing Relayflows

## Overview

Relayflows turns a coding-agent task into steps a journal can inspect, verify, and resume. A flow is data (YAML/JSON) or code (TypeScript) that compiles to the same journal-backed kernel spec. Every effect is journaled before it's treated as real — a journal write that fails fails the step, with no silent fallback.

**Name collision warning.** This repo also has skills for an older, unrelated engine that is *also* casually called "Relayflow" (singular) — `@relayflows/core`'s `WorkflowBuilder`, a chained builder (`workflow('name').pattern('dag').agent(...).step(...).run()`). That's `writing-agent-relay-workflows` and `migrating-persona-to-relayflow`'s territory. This skill is the **v2** engine: `@relayflows/surface`'s `flow()` function and the YAML/JSON dialect compiled by `@relayflows/sdk`. If you see `.pattern(`, `.agent(` as a chained builder call, or `ctx.workflow.run()`, you're in the other engine — stop and use one of those skills instead.

## When to use this skill

- Writing a new `.flow.ts` or `.flow.yaml`/`.flow.json` for the `flows` CLI (package `@relayflows/sdk`, binary name `flows`).
- Deciding whether a step needs `run` (shell), `llm` (bare model call), or `agent` (harnessed coding agent in a workspace).
- Wiring up `cli`/`model` for an `agent` or `llm` step, in either language.
- Debugging a `REFUSED [...]` message from `flows check` or `flows run`.
- Choosing between TypeScript and YAML for a given flow.

## The ladder

Three step verbs, one per rung — never more (`packages/sdk/src/spec.ts`, `export type StepType = 'deterministic' | 'llm' | 'agent';`):

1. **`run` / `deterministic`** — a shell command. No model. Implicit gate is `exit_code == 0`. It takes options: `f.run(cmd, { timeout: '5m' })`. **The default lease is 30 seconds and the maximum is 15 minutes** (`packages/surface/src/context.ts:60`) — invisible in most documentation and long enough to bite any command that touches the network. `git fetch`, `cargo build` and `gh pr create` all exceed it in their bad case, which is exactly when you least want an intermittent failure.
2. **`llm` / `llm`** — a bare model call. Prompt in, verified output out. No workspace, no tool use.
3. **`agent` / `agent`** — a harnessed coding agent in a workspace. Returns `{ summary, artifacts }`, not raw text.

Plus four resident verbs that aren't ladder rungs: `human` (durable approval), `dispatch` (hand off to a child flow), `done` (typed finish), and in YAML, `on`/triggers (event entry points — out of scope for this skill).

Most flows only need `run` and `llm`. Climb to `agent` once a step needs hands on a real workspace.

## Two ways to author the same thing

**YAML/JSON** is data: `flows check` or CI can validate it without running anything. **TypeScript** calls the same primitives imperatively as ordinary async code. Both compile to the same journal.

### TypeScript

```ts
import { flow } from '@relayflows/surface';

export default flow('hello', async (f) => {
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

**Version note:** the published `@relayflows/surface@2.0.8` on npm predates `AgentOptions.cli`/`.model` (flows#310) — it does not define them, and using them against that installed version throws at authoring time. These examples require `AgentWorkforce/flows@86a2ec2` or a later/compatible published release; if your installed `@relayflows/surface` still reads `2.0.8` and doesn't export these fields, omit `cli`/`model` from `f.agent`/`f.llm` calls until it's updated. Both examples above were run for real against a source build of that commit (`flows check`, exit 0 both) — see **Verified against**.

## The real `Ctx` contract (TypeScript)

`packages/surface/src/context.ts`, current as of `origin/main@86a2ec2`:

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
}

export interface Ctx {
  run(command: string): Step<string>;
  llm(strings: TemplateStringsArray, ...values: unknown[]): Step<string>;
  llm(prompt: string, options: { output: Record<string, unknown>; cli?: string; model?: string }): Step<unknown>;
  agent(name: string, options: AgentOptions): Step<AgentResult>;
  human(question: string, options: { to: string }): Promise<boolean>;
  dispatch<T>(flow: string, input: unknown): Promise<T>;
  done(reason: RunCompletionReason): void;
  cloud: CloudHelper;
  slack: SlackHelper;
}
```

Do not add fields to `AgentOptions`/`Ctx` that aren't in this list — they don't exist in the shipped SDK. In particular: **no flow-level `cli`, no named-agent map, no `recoveryMode`/`permissions`/`surfaces`/`budget`** on the TypeScript side. Those are YAML/JSON-only today (see **What this skill does NOT cover**). `FlowHeader` (`packages/surface/src/flow.ts:4-9`) only allows `identity`, `memory`, `budget`, `tools`, `workspace` — no `agents` key. Passing an unknown header field or an unknown `AgentOptions` field throws a `TypeError` at authoring time, before anything is journaled.

`Step<T>` (`packages/surface/src/step.ts`) is a `PromiseLike<T>` with one extra method: `.gate(predicate, because?)`, which fails the step `verification_failed` when the predicate returns false. Every awaited step must actually be awaited — an unawaited or manually-`.then()`-chained step is refused (`unawaited_step` / `unsupported_verb`), not silently dropped.

`done(reason)` takes exactly one of the closed run-completion set (`packages/surface/src/completion.ts`): `'success' | 'step_failed' | 'canceled' | 'budget_exceeded'`. There's no fifth option — don't invent one (e.g. `'partial'`, `'skipped'`).

### `flow()` takes a header, and that is where a TypeScript budget goes

`flow()` has three overloads (`packages/surface/src/flow.ts:57-61`), and the three-argument one is the one you want for anything long-running:

```ts
export default flow<Input>(
  'relay.ci.pr-proof',
  { budget: { wallclock: '110m' } },   // FlowHeader
  async (f, input) => { ... }
);
```

`FlowHeader` carries `budget`, `workspace`, `tools` and `use?: string[]`. It does **not** carry `agents` — that throws `TypeError: flow header has unknown fields: agents` at authoring time.

The header budget (`wallclock: '110m'`) and the spec budget (`budget: { maxWallclockMs: 6_600_000 }`) are different shapes for the same thing: `BudgetSpec | HeaderBudget` in `packages/sdk/src/spec.ts`. Write the duration form in TypeScript and the millisecond form in a generated spec.

## The real step shapes (YAML/JSON, `packages/sdk/src/spec.ts`)

```ts
interface DeterministicStepSpec {
  type: 'deterministic';
  id: string;
  command: string;
  dependsOn?: string[];
  timeoutMs?: number;
  verification?: VerificationSpec;   // omit for implicit exit_code
}

interface LlmStepSpec {
  type: 'llm';
  id: string;
  prompt: string;
  dependsOn?: string[];
  verification?: OutputVerificationSpec;
  model?: string;
  cli?: string;
}

interface AgentStepSpec {
  type: 'agent';
  id: string;
  instruction: string;
  dependsOn?: string[];
  verification?: OutputVerificationSpec;
  agent?: string;      // selects a named FlowSpec.agents entry
  cli?: string;
  model?: string;
  surfaces?: { workspace?: { surface: string }[]; streams?: { stream: string }[]; external?: string[] };
  recoveryMode?: 'reset' | 'inspect' | 'manual';   // default 'reset'
  permissions?: { fileGlobs?: string[]; networkAllowlist?: string[]; accessPreset?: 'readonly' | 'readwrite' };
}

interface FlowSpec {
  version: string;      // required, e.g. '0.1.0' — not optional
  name?: string;
  cli?: string;                          // flow-level CLI default
  agents?: Record<string, { cli: string; model: string }>;  // both fields required
  steps: StepSpec[];
  budget?: { maxTokensIn?: number; maxTokensOut?: number; maxDollars?: string };
}
```

`version` is required on every `FlowSpec` — omitting it is a real, common mistake; `flows check` refuses it.

## Verification gates

Verification is control flow, not decoration — a gate decides whether a step actually completed, not just whether the process exited cleanly (`packages/sdk/src/spec.ts`, `VerificationGateType`):

There are **eight**, not three (`packages/sdk/src/spec.ts`; the full list is also in `validate.ts`'s `unknown_gate_kind` refusal):

- `exit_code` — implicit default for `deterministic` steps. `exit_code == 0`. Not configurable in v0.
- `output_contains` — step output (stdout tail or LLM value, stringified) contains `value`.
- `json_schema` — step output validates against a JSON Schema (`boolean | Record<string, unknown>`). Used for structured LLM/agent output.
- `regex_match` — `{ pattern, in_output_at?, flags? }`. RE2-safe (no catastrophic backtracking), inspectable before execution. The one to reach for when an agent must emit a specific receipt line.
- `artifact_exists` — `{ path }`, a working-directory-relative POSIX path. Passes when the step's **journaled** `artifacts` list names the path. Nothing on disk is consulted, so replay and resume see the recorded verdict. This is the right gate for "the agent must have written X".
- `subprocess_gate` — `{ command, from_output? }`. Runs a shell command; see the warning below before using it.
- `references_input` — `{ input_key, in_output_at? }`. The output must quote a value from the run input.
- `word_count_bounds` — `{ min?, max? }`.

In TypeScript these attach **postfix**, with `.gate()` on the returned `Step<T>` (`packages/surface/src/step.ts`) — one per step:

```ts
await f
  .agent('prover', { task: '...', cli: 'claude' })
  .gate({ type: 'regex_match', pattern: 'PROOF_COMPLETE arm=base', in_output_at: ['summary'] });

await f.agent('writer', { task: '...' }).gate({ type: 'artifact_exists', path: 'review/security.md' });
```

`.gate()` also takes a predicate — `.gate(v => v.length > 0, 'must not be empty')` — but the closure cannot be inspected by `flows check` before the run. Prefer a `NamedGate` when the check should be visible up front.

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

Verified for real: `flows check` on exactly this step passed (`CHECK PASSED`, exit 0) — see **Verified against**.

An agent step rarely fails by crashing; it fails by returning something plausible and wrong, which a plain retry-on-error never catches. Always give an `agent`/`llm` step a real `verification`, not just the default.

### Don't gate an agent step — check it in the step after

Neither named gate is usable on an agent step today: `subprocess_gate`'s output is not captured, and `artifact_exists` cannot see a dot-directory. Both are open bugs — see **Open bugs you must author around** below for the detail and the issue links.

The durable lesson outlives both fixes: **put enforcement in a deterministic step after the agent, not in a gate on it.** A dropped agent transport then reads as "nothing was written" — a repairable fact — instead of as a crashed run, and the verdict is legible because a deterministic step journals its output. This is the same advice `relay-80-100-workflow` gives as *keep repairable gates on the critical path*; v2 makes it mandatory rather than merely wise.

### There is no `failOnError: false`

v2 gates every `deterministic` step on exit code with no opt-out. If you are porting a v1 flow, or writing a repair-before-failure flow where a red check is *work for an agent* rather than the end of the run, you need a pattern for it. The two in use:

- `{ <command> } || true` — the group braces are load-bearing, because `||` cannot begin a line, so appending `\n|| true` to a multi-line command is a shell syntax error rather than a fallback. This discards the exit code, so a later gate has nothing to read.
- **An evidence recorder** — a small script that runs the command, writes `{command, exitCode, verdict, tail}` to a file, and always exits 0; a later deterministic step reads those files back and decides. Verbose, but it is the only shape where a repair agent can see *why* a check was red and a final gate can recompute green from recordings rather than from an agent's report.

Tracked at [flows#509](https://github.com/AgentWorkforce/flows/issues/509).

## `cli` / `model`: what a step actually runs on

Both YAML and TypeScript agent/llm steps can set `cli` and `model` directly (TypeScript since flows#310, `AgentOptions.cli?`/`.model?`). Resolution order for `cli` — checked once per step by `preflight.ts`'s `resolveCli` (`packages/sdk/src/preflight.ts:265-282`), identical regardless of authoring language because both compile to the same `StepSpec`:

1. **step** — `step.cli` (or TS's `options.cli`)
2. **named** — the flow's `agents[step.agent]` entry, if the step selects one via `agent: <name>` (YAML/JSON only — TypeScript has no named-agent map yet, see below)
3. **flow** — `FlowSpec.cli`
4. **project** — nearest `flows.json`'s `cli`, found by walking up from the flow file's directory

No resolution found at any level → `REFUSED [cli_unresolved]`, before anything is journaled. Verified for real:

```
$ flows check hello.flow.yaml   # agent step, no cli anywhere
REFUSED [cli_unresolved] Step "greeter" has no CLI at step, flow, or project level. No flows.json was found from "..." to the filesystem root.
```
(exit 2 — see **Verified against**)

`model` has **no** flow or project default — only step or named-agent. Omitting it just runs whatever model the resolved CLI defaults to.

### `flows.json`

Nearest-wins project config, walking from the flow file's directory to the filesystem root (`packages/sdk/src/cli/check.ts`). Exact schema — unknown keys fail closed as `config_invalid`:

```json
{ "cli": "claude", "executors": ["cron"], "models": ["claude-sonnet-4-6"] }
```

- `cli` (optional, non-empty string) — the project-wide CLI default (resolution rung 4 above).
- `executors` (optional, string array) — trigger executors this project has registered. A trigger whose `executor` isn't in this list is `no_executor`.
- `models` (optional, string array) — **an allowlist, not a default.** Any model declared on any step or named agent anywhere in the flow must appear here, or `flows check` refuses `model_unknown`. Setting `models` does not select a model for anything; there's still no flow/project model default.

```
$ flows check hello.flow.yaml   # model set on the step, but not in flows.json's models[]
REFUSED [model_unknown] Step "greeter" declares model "claude-sonnet-4-6" for CLI "claude", but it is not listed in project model registry "..."; add the exact model only after verifying that project is allowed to use it.
```
(Verified for real — see **Verified against**.)

## Human approval and dispatch (TypeScript resident verbs)

```ts
import { flow } from '@relayflows/surface';

export default flow('ship-feature', async (f) => {
  const plan = await f.agent('planner', {
    task: 'Research and plan: add OAuth2 support',
    workspace: 'acme/api: readonly',   // compiles to relayauth path scopes
  });

  const ok = await f.human(`Ship this?\n${plan.summary}`, { to: 'khaliq' });
  if (!ok) return f.done('canceled');

  const pr = await f.dispatch('garden/implement', plan);   // hands off to a child flow
  f.done('success');
});
```

`f.human` is a durable, journaled approval gate — the run parks until the human answers, and resumes exactly where it left off. `f.dispatch` hands input to a named child flow and returns its typed result; the parent doesn't inline the child's steps. (Source: `docs/SURFACE.md` §2 rule 6 region, lines ~40-53 as of `origin/main@86a2ec2` — this snippet is cited, not independently re-run, since it needs a live daemon.)

`f.slack` is a separate helper namespace, and its real calling convention doesn't fit a plain `flow(name, async (f) => ...)` body: in the real source, `f.slack.reply(event, ...)` only appears inside a trigger handler registered via `.on(slack.mention('#exec'), async (f, event) => { ... })`, where `event` is the trigger's second callback argument — not something a step-based flow like the one above ever has in scope. Triggers and `f.slack` are out of this skill's scope (see **What this skill does NOT cover**); don't copy a bare `f.slack.reply(event, ...)` call into a `flow()` body like the one above, it will throw `event is not defined`.

## Running it: `flows check` / `run` / `resume`

Real usage (`packages/sdk/src/cli.ts`):

```
flows check [--json] <flow.yaml|spec.json>
flows run [--json] [--no-spawn] [--no-observer-link] [--data-dir <dir>] [--local-agent] <flow.yaml|spec.json>
flows run [--json] [--no-spawn] [--no-observer-link] [--data-dir <dir>] [--local-agent] <flow.ts> --input <inline-json-or-file>
flows resume [--json] [--no-spawn] [--no-observer-link] [--data-dir <dir>] <run-id>
```

### A flow with an agent step needs `--local-agent`

`flows run <spec>` on a flow containing **any** `agent` step parks immediately at that step unless you pass `--local-agent`:

```
PARKED [run_parked] Run "01M2Z..." parked at step "implement-rust" (agent): no worker is attached for step type "agent".
RUN 01M2Z... parked (3 steps)                                      # exit 3
```

The flag is in the usage string but nothing says it is *required*; the message reads as "your infrastructure is missing a worker", not "pass this flag". Budget a wasted run for it the first time, or just always pass it for a local run with agents.

Three details worth having in advance:

- **The remedy is only named sometimes.** The hint `To start a new run with a local agent worker: flows run --local-agent '<path>'` is appended only for `flows run` on a YAML/JSON spec path. A `.flow.ts` gets the bare message with no remedy, and `flows resume` never gets one (`packages/sdk/src/cli/run.ts:627-640`).
- **`flows resume --local-agent <run-id>` is a trap on a spec run.** The flag is accepted and then ignored: `resumeFlow` attaches a worker only on the authored-TS path, so a YAML/JSON run parks again with the identical message. Start a new run instead. ([flows#504](https://github.com/AgentWorkforce/flows/issues/504))
- **`flows schedule` has no `--local-agent` at all.** A scheduled flow with an agent step parks forever, silently, on a timer. Drive it from cron with `flows run --local-agent` until that changes. ([flows#503](https://github.com/AgentWorkforce/flows/issues/503))

### Watching a run

`flows status <run-id>` is the observability surface, and it is good: a live step table with per-step attempts, durations, gate verdicts, spend and transcript paths, plus per-attempt transcripts under `.relayflowd/runs/<run-id>/steps/<step>/`. Poll it with `watch`.

Two durable facts. **The step count will not match your spec** — the kernel adds a lowered `.gate` step per gated step, so a 58-step spec reports 67. And **a side-effect log written by your own gate scripts is not a progress signal**: agents run those same commands on themselves while working, so the log mixes flow steps, agent self-checks and your own manual runs. `flows status` is the only caller-accurate view.

For what is missing (observer link, `flows logs`) see the open-bugs section.

### `flows check` passing does not mean the flow will run

`check` is a pure compile-and-preflight — no daemon, no socket, no data dir. It's the fast, safe way to validate a flow before ever running it. `--json` works on `check`/`run`/`resume`; it does **not** exist on `tick start`, `hn-monitor start`, or `observer`. The printed usage above only lists `<flow.yaml|spec.json>` for `check`, but it accepts `.flow.ts` too — verified in this skill's own **Verified against** section (`flows check hello.flow.ts` passes); the tool's own `--help` text is just incomplete on this point.

That is what makes it fast and worth running constantly. It also means **the one validation tool the product ships structurally cannot catch spec/daemon skew**: the npm packages and the runtime binary can carry the same version number and disagree about the schema, and you learn it as a mid-run `protocol_error` after the flow has already done work ([flows#489](https://github.com/AgentWorkforce/flows/issues/489), [flows#502](https://github.com/AgentWorkforce/flows/issues/502)).

Practical consequence for authoring: **budget a shakedown run against a throwaway target, and treat green unit tests plus `CHECK PASSED` as necessary but not remotely sufficient.** The failures that actually block a flow live in the seams between the packages, the daemon, the CLI flags and the forge, and none of those are reachable without a real run.

A `.flow.ts` run via `flows run` requires `--input <inline-json-or-file>` even when the flow body ignores its input argument — `flows run hello.flow.ts` alone refuses `REFUSED [input_missing]`.

### Exit codes and refusal shapes

Every refusal before a journal write is exit **2**, printed as `REFUSED [<kind>] <message>`. The `<kind>` differs by *how* the flow was checked, not just *what* was wrong — don't assume one canonical string for "no CLI":

- `flows check` on a YAML/JSON spec, or the declarative-compiler path in general → `preflight.ts`'s own kind directly: `cli_unresolved`, `model_unknown`, `cli_missing`, `cli_unauthenticated`, `no_executor`, etc. (`packages/sdk/src/failure-kinds.ts`, `PREFLIGHT_FAILURE_KINDS`).
- `flows run` on a **TypeScript** `.flow.ts` whose authored `f.agent`/`f.llm` call can't resolve a CLI at runtime → the executor's internal `agent_cli_unresolved` gets wrapped and printed as `REFUSED [invalid_spec] <message>` (`packages/sdk/src/cli/direct-run.ts:97-119`). The internal `agent_cli_unresolved` string is never itself the printed kind a user sees.

Both are real, both are exit 2 — just from different code paths, so don't be surprised if the same underlying problem prints a different `[kind]` depending on whether you hit it via `flows check` on YAML or `flows run` on TypeScript.

## Common mistakes

- **Forgetting `version` in a YAML/JSON `FlowSpec`.** It's required, not optional — `flows check` refuses a spec without it.
- **Adding `agents:` to a TypeScript `flow()` header.** `FlowHeader` has no such field; it throws `TypeError: flow header has unknown fields: agents` at authoring time. Named-agent maps + `agent:` selector are YAML/JSON-only (flows#300 tracks TypeScript composition via `use:`, not yet shipped).
- **Assuming `flows.json`'s `models` sets a default model.** It only validates models already declared elsewhere; it never selects one.
- **Not awaiting a step, or manually `.then()`-chaining one.** Both are refused (`unawaited_step` / `unsupported_verb`) rather than silently ignored — the executor closes every root operation's lifecycle explicitly.
- **Running a `.flow.ts` without `--input`.** Required even for flows that don't use their input argument.
- **Expecting a fifth `done()` reason.** The set is closed in this skill's examples as `success | step_failed | canceled | budget_exceeded`; the installed runtime has since added `needs_human` and `declined`. Check `RunCompletionReason` in the version you have rather than trusting either list.
- **Running a flow with agent steps without `--local-agent`.** It parks at the first agent step. See above.
- **Gating an agent step on `subprocess_gate`.** When it fails you get `exit=1` and nothing else. See above.
- **Assuming `f.run` has no timeout.** It leases for 30 seconds by default.

## What this skill does NOT cover

- **Named-agent maps in TypeScript** (`agents: { reviewer: { cli, model } }` + reuse across steps by name) — YAML/JSON only today. Tracked for TS composition via `use:` at [flows#300](https://github.com/AgentWorkforce/flows/issues/300).
- **`recoveryMode`, `surfaces`, `memory`** on agent steps — real YAML/JSON fields with no TypeScript equivalent. Author that step in YAML and reach it from TypeScript with `f.dispatch` if you need them. (`budget` *does* have a TypeScript home — the `FlowHeader` — and `AgentOptions` has grown `permissions`, `cwd` and `transport` since this skill was first written.)
- **`permissions` and `options.cwd`** — both are accepted and neither works as written. See **Open bugs you must author around**.
- **Cloud execution** (`flows run --cloud`), **triggers/webhooks**, **memory retrieval**, and the **`f.mcp`**/**`f.slack`** helper namespaces — each is its own surface with its own gotchas; see the [Relayflows product docs](https://agentrelay.com/docs/relayflows) for what's shipped versus designed-but-not-yet-implemented.
- The **older `@relayflows/core` `WorkflowBuilder`** engine — see `writing-agent-relay-workflows` and `migrating-persona-to-relayflow` in this repo.

## Quick reference

| Verb / field | Language | Notes |
|---|---|---|
| `f.run(command)` / `type: deterministic` | both | shell command, implicit `exit_code` gate |
| `f.llm(...)` / `type: llm` | both | bare model call, no workspace |
| `f.agent(name, opts)` / `type: agent` | both | harnessed coding agent, returns `{summary, artifacts}` |
| `f.human(question, {to})` | TS only | durable approval; YAML has no equivalent yet |
| `f.dispatch(flow, input)` | TS only | hand off to a named child flow |
| `f.done(reason)` / — | TS / kernel | one of `success \| step_failed \| canceled \| budget_exceeded` |
| `options.cli` / `step.cli` | both | per-call/step CLI override (TS: flows#310) |
| `options.model` / `step.model` | both | per-call/step model; no flow/project default |
| `agent: <name>` + `agents: {...}` | YAML/JSON only | named cli/model pair, reused by selector |
| `flows check <file>` | CLI | pure validate + preflight, no daemon |
| `flows run <file> [--input ...]` | CLI | actually executes; `.flow.ts` needs `--input` |
| `flows resume <run-id>` | CLI | resume a parked/crashed run |
| `.gate(config)` on a `Step<T>` | TS | postfix named gate; one per step |
| `--local-agent` | CLI | **required** for any local run with an `agent` step |
| `f.run(cmd, { timeout })` | TS | **default lease 30s, max 15m** — set it for anything touching the network |

## Open bugs you must author around

**Verified against CLI 2.0.22 on 2026-09-20.** Everything in this section describes a bug, not a design. Each row says when to delete it — check the issue before trusting the workaround, and remove the row once it closes. Nothing else in this skill depends on these.

| Symptom | Workaround | Delete when |
| --- | --- | --- |
| A failing `subprocess_gate` journals `exit=1` with **empty** stdout and stderr; `relayflowd.log` is empty too. The lowering runs your command under `stdio: 'inherit'` and the daemon's stdio is captured nowhere. | Don't gate agent steps. If you must, have the command write its verdict to a file — that file is the only record you get. | [flows#511](https://github.com/AgentWorkforce/flows/issues/511) |
| `artifact_exists` can never pass for a path under a dot-directory. The worker's journaled `artifacts` list omits them — one run journaled 6,837 paths, `{target: 6832, crates: 5}`, and zero under `.workflow-artifacts/` it had demonstrably written to. Not a `.gitignore` effect; `target/` is ignored too and included in full. | Check the disk from a deterministic step instead. | [flows#513](https://github.com/AgentWorkforce/flows/issues/513) |
| `flows resume --local-agent <run-id>` accepts the flag and ignores it on a spec run, parking again identically. | Start a new run. Use `flows run --reuse-from <run-id>` to reuse completed steps — it keys on `step_spec_hash` plus resolved input, so an edited step re-executes and the rest do not. | [flows#504](https://github.com/AgentWorkforce/flows/issues/504) |
| `flows schedule` has no `--local-agent`, so a scheduled agent flow parks forever, silently, on a timer. | Drive it from cron with `flows run --local-agent`. | [flows#503](https://github.com/AgentWorkforce/flows/issues/503) |
| `flows logs <run-id>` is documented but refused `invalid_invocation`. | `flows status`, and the transcripts under `.relayflowd/runs/`. | — |
| No observer link and no channel for a local run. | `flows status`; there is no shareable live view. | [flows#341](https://github.com/AgentWorkforce/flows/issues/341), [flows#264](https://github.com/AgentWorkforce/flows/issues/264) |
| `LEASE OVERDUE by Nm` in `flows status` usually means an agent is mid-turn, not that anything is stuck. | Check the worker process before concluding a stall. | — |
| `permissions` on an agent step is validated and journaled and **never enforced**. A `flows run` is not sandboxed; agent steps can read and write the whole checkout. | Declare it for reviewability. Partition agents by path *and* sequence them, and gate on out-of-scope changes yourself. | [flows#487](https://github.com/AgentWorkforce/flows/issues/487) |
| `options.cwd` on an agent step is declared by surface+sdk and rejected by the runtime at the same version. | Don't plan a per-step worktree around it. | [flows#489](https://github.com/AgentWorkforce/flows/issues/489) |
| `retries_exhausted` reports only the last attempt, hiding the first — which is usually the one that explains the failure. | Read the journal directly. | [flows#506](https://github.com/AgentWorkforce/flows/issues/506) |
| `flows check` never contacts the daemon, so a green check says nothing about whether the daemon will accept the spec, and it stays silent on run-time properties it can already compute. | Budget a shakedown run against a throwaway target. Treat green unit tests plus `CHECK PASSED` as necessary and nowhere near sufficient. | [flows#502](https://github.com/AgentWorkforce/flows/issues/502), [flows#514](https://github.com/AgentWorkforce/flows/issues/514) |

## Verified against

**Updated 2026-09-20** against `AgentWorkforce/flows@e73b315e` (origin/main, CLI 2.0.22) while authoring a 58-step campaign flow for `AgentWorkforce/relay` (`flows/migrate/native-delivery.spec.ts`). The `--local-agent` park, the silent `subprocess_gate` failure, the eight gate types, the `.gate()` postfix form, the three-argument `flow()` and the `f.run` 30-second lease were each read from the source cited beside them or observed in a real run — the park and the gate silence cost one run each. The `f.gitlab`/`f.github` writeback asymmetry, the `cwd` skew and the `retries_exhausted` behaviour come from the *Relayflows v2 Field Report* (2026-09-18, Julian Fann), corroborated against the same tree.

Original verification, `AgentWorkforce/flows@86a2ec2` (origin/main). Built `packages/surface` and `packages/sdk` from source in a clean worktree (published npm `@relayflows/surface@2.0.8` is stale — it predates flows#310 and lacks `cli`/`model` on `AgentOptions`; local build was symlinked in instead), then ran the real CLI:

```
$ flows check hello.flow.yaml         # this skill's YAML example, cli/model added, flows.json models allowlist set
CHECK PASSED hello.flow.yaml            # exit 0

$ flows check hello.flow.ts            # this skill's TypeScript example
CHECK PASSED hello.flow.ts              # exit 0

$ flows check extract.flow.yaml        # this skill's output_contains example
CHECK PASSED extract.flow.yaml          # exit 0

$ flows check hello.flow.yaml           # same YAML, no flows.json anywhere
REFUSED [cli_unresolved] Step "greeter" has no CLI at step, flow, or project level. ...   # exit 2

$ flows check hello.flow.yaml           # step model not in flows.json's models[]
REFUSED [model_unknown] Step "greeter" declares model "claude-sonnet-4-6" ... not listed in project model registry ...   # exit 2
```

The `f.human`/`f.dispatch`/`f.slack` snippet and the TypeScript `REFUSED [invalid_spec]` wrapping claim are source-cited (exact file:line above), not independently re-run — both need a live `relayflowd` daemon (and Slack mount, for the former), which this pass didn't build.
