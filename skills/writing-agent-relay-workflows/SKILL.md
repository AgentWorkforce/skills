---
name: writing-agent-relay-workflows
description: Use when authoring multi-agent agent-relay workflows (TypeScript, Python, YAML) — covers the WorkflowBuilder API, DAG dependencies, step output chaining, verification gates, the GitHub primitive (createGitHubStep), cross-repo worktrees, shared setup helpers, sibling linking, cloud runs via --sync-code, and the canonical 80-to-100 test-fix-rerun pattern. Pair with the relay-80-100-workflow skill for validation-gate authoring.
---

# Writing Agent Relay Workflows

Relay workflows orchestrate multiple agents (Claude, Codex, Gemini, Aider, Goose, opencode, droid) through typed DAG-based steps. You write workflows in **TypeScript** (preferred), **Python**, or **YAML**; you run them with `agent-relay run`.

This skill is the authoring guide. It is deliberately short — the full reference lives in the public docs:

- **[Workflows overview](https://agentrelay.com/docs/markdown/workflows-introduction.md)** — mental model, patterns, cloud
- **[Quickstart](https://agentrelay.com/docs/markdown/workflows-quickstart.md)** — a working workflow in 5 minutes
- **[Builder API](https://agentrelay.com/docs/markdown/reference-workflows.md)** — every method on `workflow()`
- **[Patterns](https://agentrelay.com/docs/markdown/workflows-patterns.md)** — canonical multi-agent shapes
- **[Setup helpers](https://agentrelay.com/docs/markdown/workflows-setup-helpers.md)** — `applySiblingLinks`, per-repo setup
- **[GitHub primitive](https://agentrelay.com/docs/markdown/github-primitive.md)** — bundled PR / issue / file ops
- **[Common mistakes](https://agentrelay.com/docs/markdown/workflows-common-mistakes.md)** — bugs every author hits once

If a detail here conflicts with the docs, the docs are the source of truth.

## When to use this skill

- Writing a new workflow file from scratch
- Adding steps to an existing workflow (especially cross-repo or multi-file edits)
- Picking a swarm pattern (`dag`, `supervisor`, `fan-out`, etc.)
- Deciding what belongs in a deterministic step vs. an agent step
- Chaining step outputs, wiring verification gates, composing the GitHub primitive

Pair with **[`relay-80-100-workflow`](https://github.com/agentworkforce/skills/tree/main/skills/relay-80-100-workflow)** for validation-gate patterns (test-fix-rerun, PGlite, regression checks).

## Core shape

```typescript
import { workflow } from '@agent-relay/sdk/workflows';
import { ClaudeModels, CodexModels } from '@agent-relay/config';

async function main() {
  const result = await workflow('my-workflow')
    .description('What this workflow does')
    .pattern('dag')
    .channel('wf-my-workflow')
    .maxConcurrency(3)
    .timeout(3_600_000)

    .agent('lead',   { cli: 'claude', model: ClaudeModels.SONNET, preset: 'lead' })
    .agent('worker', { cli: 'codex',  model: CodexModels.GPT_5_4, preset: 'worker' })

    .step('plan', {
      agent: 'lead',
      task: `Produce a 5-bullet plan for <feature>.`,
    })

    .step('implement', {
      agent: 'worker',
      dependsOn: ['plan'],
      task: `Implement per the plan:\n{{steps.plan.output}}\nOnly edit src/feature.ts.`,
      verification: { type: 'exit_code' },
    })

    .step('test', {
      type: 'deterministic',
      dependsOn: ['implement'],
      command: 'npm test 2>&1 | tail -40',
      failOnError: true,
    })

    .run({ cwd: process.cwd() });

  if (result.status !== 'completed') process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**Three non-negotiables:**
1. **Wrap in `async function main()`** — not raw top-level `await`. Executor-driven files sometimes run as CJS.
2. **End with `.run({ cwd: process.cwd() })`** — not `.build()`, not `createWorkflowRenderer`. The file MUST call `.run()`.
3. **Dry-run before running**: `agent-relay run --dry-run workflows/my.ts` catches typos, missing `dependsOn`, invalid patterns.

Check `package.json` for `"type": "module"` — if CJS, use `require()` instead of `import`.

## Decisions agents get wrong

### Pattern selection

Don't default to `dag` blindly. Pick based on how work actually flows:

| Shape of work | Pattern |
|---|---|
| Linear steps with branches | `dag` (default) |
| Lead plans, workers implement in parallel | `supervisor` or `fan-out` (auto-hardens) |
| Iterate until gate passes | `review-loop`, `reflection`, `verifier` |
| Multiple approaches, pick best | `auction`, `competitive`, `consensus` |
| Transactional multi-step with rollback | `saga` |

Hub patterns (`supervisor`, `hub-spoke`, `fan-out`) auto-spawn a supervisor that issues `OWNER_DECISION` if workers stall. `dag` and `pipeline` don't auto-harden — wire supervision yourself if needed. See the full table at [Patterns](https://agentrelay.com/docs/markdown/workflows-introduction.md).

For the decision framework across all 24 patterns — when to pick `debate` vs `consensus`, `cascade` vs `pipeline`, etc. — use the [`choosing-swarm-patterns`](https://github.com/agentworkforce/skills/tree/main/skills/choosing-swarm-patterns) skill.

### Step sizing

| Wrong | Right |
|---|---|
| One 100-line task prompt to one agent | Lead + worker on a shared channel |
| Single step editing 4+ files | One step per file with verify gates between |
| Agent writes tests AND runs them AND fixes | Three steps: write / run (deterministic) / fix |
| Long fenced code blocks inside `task: \`...\`` | Move examples to referenced files |

Rule of thumb: if a step can fail for more than one reason, split it.

### Verify gates after every edit

Agents can exit 0 without writing anything. Always add a deterministic verify after an agent edit:

```typescript
.step('edit', { agent: 'impl', task: '...', verification: { type: 'exit_code' } })
.step('verify', {
  type: 'deterministic',
  dependsOn: ['edit'],
  command: 'git diff --quiet src/foo.ts && (echo "NOT MODIFIED"; exit 1) || echo "OK"',
  failOnError: true,
})
```

Only four verification types are valid — **invalid types silently fall through to process-exit auto-pass**, which means a bug in your verification typo gets you a passing workflow with broken output:

| Type | Use for | Example |
|---|---|---|
| `exit_code` | Code-editing agent steps, deterministic commands | `verification: { type: 'exit_code' }` |
| `file_exists` | Creation steps (new file must appear) | `verification: { type: 'file_exists', value: 'src/feat.ts' }` |
| `output_contains` | Marker-based checks on clean stdout | `verification: { type: 'output_contains', value: 'DONE' }` |
| `custom` | Custom predicate function | `verification: { type: 'custom', check: (out) => out.includes('OK') }` |

**Token gotcha:** if the token (e.g. `STEP_COMPLETE`) appears in the task text, the runner requires it **twice** in output (once from task echo, once from the agent). Prefer `exit_code` for code-editing steps to avoid this.

### DAG deadlock

If a lead step depends on its own workers, the workers wait on the lead, the lead waits for workers → deadlock:

```yaml
# WRONG
- name: coordinate
  dependsOn: [context]
- name: work-a
  dependsOn: [coordinate]   # work-a can't start until coordinate finishes

# RIGHT
- name: work-a
  dependsOn: [context]      # starts with lead
- name: coordinate
  dependsOn: [context]      # starts with workers
- name: merge
  dependsOn: [work-a, coordinate]
```

### Parallelism and waves

**Within a workflow**, steps sharing the same `dependsOn` run in parallel. Fan out independent sub-tasks and merge at the end:

```typescript
// BAD — unnecessary sequential chain
.step('fix-a', { agent: 'worker', dependsOn: ['review'] })
.step('fix-b', { agent: 'worker', dependsOn: ['fix-a'] })      // why wait?

// GOOD — parallel fan-out with merge
.step('fix-a',    { agent: 'impl-1', dependsOn: ['review'] })
.step('fix-b',    { agent: 'impl-2', dependsOn: ['review'] })  // same dep = parallel
.step('verify',   { agent: 'reviewer', dependsOn: ['fix-a', 'fix-b'] })
```

Cap `maxConcurrency` at 5-6 — the broker times out above 10.

**Across workflows**, group independent ones into parallel waves (4-7× speedup on large batches):

```bash
# Wave 1: independent infra
agent-relay run workflows/34-sst.ts &
agent-relay run workflows/35-env.ts &
agent-relay run workflows/36-ui.ts &
wait
git add -A && git commit -m "Wave 1"

# Wave 2: testing (each runs against Wave 1 output)
agent-relay run workflows/40-unit.ts &
agent-relay run workflows/41-integration.ts &
wait
```

Two workflows parallelize safely if they don't share write targets. Declare scope on the workflow to help planners:

```typescript
workflow('48-comparison-mode')
  .packages(['web', 'core'])
  .isolatedFrom(['49-feedback-system'])
  .requiresBefore(['46-admin-dashboard'])
```

### Step output chaining

`{{steps.NAME.output}}` injects the upstream step's terminal output. Only chain from clean sources:
- Deterministic steps (shell — always clean)
- Non-interactive agents (`preset: 'worker'` — clean stdout)

**Never chain from interactive agents** (no preset). PTY output has spinners, ANSI, TUI chrome. Either have the agent write to a file and read it in a deterministic step, or use `preset: 'worker'`.

### Self-termination

Do NOT add exit instructions to task prompts. The runner handles self-termination via the multi-signal pipeline (verification gate → `OWNER_DECISION` → evidence + clean exit → marker → process-exit). Describe the deliverable, not what to print.

## Composing primitives

Workflows compose the relay primitives ([channels](https://agentrelay.com/docs/markdown/channels.md), [DMs](https://agentrelay.com/docs/markdown/dms.md), [files](https://agentrelay.com/docs/markdown/file-sharing.md), [scheduling](https://agentrelay.com/docs/markdown/scheduling.md)) plus **workflow-specific primitives** like the GitHub primitive.

### GitHub primitive (bundled with the SDK)

For PR creation, issue updates, file reads, or any GitHub op, prefer `createGitHubStep` over shelling out to `gh`. It's **bundled with `@agent-relay/sdk`** — no separate install.

```typescript
import { workflow } from '@agent-relay/sdk/workflows';
import { createGitHubStep } from '@agent-relay/sdk/github';

await workflow('ship-readme')
  .agent('writer', { cli: 'claude' })

  .step('read-readme', createGitHubStep({
    action: 'readFile',
    repo: 'AgentWorkforce/relay',
    params: { path: 'README.md' },
    output: { mode: 'data', format: 'text' },
  }))

  .step('edit', {
    agent: 'writer',
    dependsOn: ['read-readme'],
    task: `Current README:\n{{steps.read-readme.output}}\nClean up the intro.`,
  })

  .step('open-pr', createGitHubStep({
    action: 'createPR',
    repo: 'AgentWorkforce/relay',
    params: { head: 'docs/readme-cleanup', base: 'main', title: 'docs: cleanup', body: '...' },
  }))

  .run({ cwd: process.cwd() });
```

Actions cover repos, issues, PRs, files, branches, commits, identity. The primitive auto-picks `local` (via `gh` CLI) or `cloud` (via Nango or relay-cloud) based on env. Full list + multi-tenant routing: [GitHub primitive](https://agentrelay.com/docs/markdown/github-primitive.md).

### Lead + workers on a shared channel

For multi-file edits with review feedback, prefer **interactive agents on a shared channel** over a chain of one-shot workers. The lead assigns work, reviews, posts feedback; workers implement and iterate:

```typescript
.agent('lead', {
  cli: 'claude',
  model: ClaudeModels.OPUS,
  role: 'Architect + reviewer. Assigns work, reviews diffs, posts feedback on channel.',
})  // no preset = interactive

.agent('impl-new', {
  cli: 'codex',
  model: CodexModels.GPT_5_4,
  role: 'Creates new files. Listens on channel for assignments + feedback.',
})

.agent('impl-modify', {
  cli: 'codex',
  model: CodexModels.GPT_5_4,
  role: 'Edits existing files. Listens on channel.',
})

// All three share the same dependsOn — they start concurrently (no deadlock)
.step('lead-coordinate',  { agent: 'lead',        dependsOn: ['install-deps'], task: '...' })
.step('worker-create',    { agent: 'impl-new',    dependsOn: ['install-deps'], task: '...' })
.step('worker-modify',    { agent: 'impl-modify', dependsOn: ['install-deps'], task: '...' })

.step('final-verify', { type: 'deterministic', dependsOn: ['lead-coordinate', 'worker-create', 'worker-modify'], command: '...' })
```

Key points: no preset on the agents (they need PTY for channel injection), all three share the same `dependsOn` (prevents the lead-waits-for-workers deadlock), lead merges via a downstream step.

### Cross-repo workflows

When a workflow edits a sibling repo, use a **worktree** (don't touch the user's main checkout) and close with a PR via `createGitHubStep`:

```typescript
.step('setup-worktree', {
  type: 'deterministic',
  command: `git -C ../other-repo worktree add ../other-repo-feat-x -b feat-x 2>&1 | tail -5`,
  failOnError: true,
})

.step('install-sibling', {
  type: 'deterministic',
  dependsOn: ['setup-worktree'],
  command: 'cd ../other-repo-feat-x && npm install --legacy-peer-deps 2>&1 | tail -10',
  failOnError: true,
})

.step('edit-sibling', {
  agent: 'impl',
  dependsOn: ['install-sibling'],
  task: `Edit ../other-repo-feat-x/src/foo.ts to <change>. Only this file.`,
  verification: { type: 'exit_code' },
})

.step('push-branch', {
  type: 'deterministic',
  dependsOn: ['edit-sibling'],
  command: `cd ../other-repo-feat-x && git add -A && git commit -m "feat: x" && git push -u origin feat-x 2>&1 | tail -5`,
  failOnError: true,
})

.step('open-pr', createGitHubStep({
  action: 'createPR',
  repo: 'org/other-repo',
  params: { head: 'feat-x', base: 'main', title: 'feat: x', body: 'Linked PR.' },
  output: { mode: 'data', format: 'text', path: 'htmlUrl' },
}))

.step('print-pr-url', {
  type: 'deterministic',
  dependsOn: ['open-pr'],
  command: `echo "PR: {{steps.open-pr.output}}"`,
  captureOutput: true,
})

.step('cleanup-worktree', {
  type: 'deterministic',
  dependsOn: ['print-pr-url'],
  command: `git -C ../other-repo worktree remove ../other-repo-feat-x --force 2>&1 | tail -5`,
  failOnError: false,
})
```

Don't forget the PR URL echo — `createGitHubStep` captures it, but humans and masters want it in the log.

### Dynamic channel management

Agents can `subscribe` / `unsubscribe` / `mute` / `unmute` channels mid-workflow:

```typescript
await relay.subscribe({ agent: 'auditor', channels: ['review-pr-456'] });
await relay.mute({ agent: 'auditor', channel: 'general' });
```

Semantics: `mute` keeps the agent subscribed (history access intact) but stops PTY injection. Use for multi-PR sessions, phase transitions, or dynamic fanout.

## Shared setup

Put prelude (branch checkout, install, build) in `workflows/lib/<repo>-setup.ts` and expose `applyMyRepoSetup(wf, opts)`. Every workflow in that repo calls it. When a new prerequisite appears (e.g. "build the platform package because its types point at dist/"), you fix one file. See [Setup helpers](https://agentrelay.com/docs/markdown/workflows-setup-helpers.md).

## Sibling linking

When a workflow edits code that imports from a sibling repo (e.g. sage depends on agent-assistant), link the **real** sibling instead of relying on published versions — agents see head-of-main types and can't fabricate interfaces.

```typescript
import { applySiblingLinks } from '@agent-relay/sdk/workflows';

applySiblingLinks(wf, {
  after: 'install-deps',
  siblings: [{ name: '@agent-assistant/proactive', path: '../agent-assistant/packages/proactive' }],
});
```

The helper runs `npm link` / `uv pip install -e` in the sibling, then again in the consumer. It fails fast if a required export is missing — which means an agent gets a real type error instead of fabricating `declare module`. Never use `file:` paths in committed `package.json`.

## The 80-to-100 gate

Most workflows stop at "compiles." Production workflows run the tests, fix failures, and gate the commit. The pattern is three steps, not one:

```typescript
// 1. Run tests (don't fail the workflow — let the agent fix it)
.step('run-tests', {
  type: 'deterministic',
  dependsOn: ['write-tests'],
  command: 'npx vitest run test/feature.test.ts 2>&1 | tail -60',
  captureOutput: true,
  failOnError: false,        // <-- fail-tolerant
})

// 2. Agent reads output, fixes, re-runs until green
.step('fix-tests', {
  agent: 'tester',
  dependsOn: ['run-tests'],
  task: `Check test output and fix any failures.

Output:
{{steps.run-tests.output}}

If all pass, do nothing. Otherwise: read the failing tests + source,
fix, re-run \`npx vitest run test/feature.test.ts\` until ALL pass.`,
  verification: { type: 'exit_code' },
})

// 3. Deterministic final run — this one MUST pass
.step('run-tests-final', {
  type: 'deterministic',
  dependsOn: ['fix-tests'],
  command: 'npx vitest run test/feature.test.ts 2>&1',
  failOnError: true,          // <-- hard gate
})

.step('commit', {
  type: 'deterministic',
  dependsOn: ['run-tests-final'],
  command: 'git add src/ test/ && git commit -m "feat: ..."',
  failOnError: true,
})
```

**Why three steps:** the first run captures output for the agent to diagnose, the middle step iterates, the final run is a boring pass/fail gate with no agent judgment. Same shape works for `npx tsc --noEmit`, `npm run build`, regression suites.

Full walkthrough (PGlite for in-process Postgres, regression patterns, mock sandboxes): [`relay-80-100-workflow`](https://github.com/agentworkforce/skills/tree/main/skills/relay-80-100-workflow) skill.

## Shell conventions

| Rule | Why |
|---|---|
| No `_` in YAML numbers (`1_200_000`) | YAML doesn't support them |
| `grep -Eq "a\|b\|c"` not `grep "a\|b\|c"` | Basic alternation misbehaves silently |
| Cloud sandbox: wrap bash-only syntax in `bash -c '...'` (single-quoted) | Daytona `/bin/sh` is dash |
| Shell assignments from user input: `VAR='...'` not `VAR="..."` | Double quotes still expand `$(...)`, backticks, `\` |
| Final verification: boring, portable shell | Fancy alternation creates fake failures |

## Cloud runs

The same workflow file runs in a Daytona sandbox:

```bash
git add workflows/my.ts src/feature.ts          # staging is enough; commit optional
agent-relay cloud run workflows/my.ts --sync-code
agent-relay cloud logs <run-id> --follow
agent-relay cloud sync <run-id>                 # pull diff back locally
```

**Almost always pass `--sync-code`** — without it the sandbox has no code at all (there's no fallback clone from origin). The tarball is built from `git ls-files` + working-tree contents: tracked files (including staged-but-uncommitted) are synced; untracked files are **silently excluded**. `git add` new files before running. See [`--sync-code`](https://agentrelay.com/docs/markdown/cli-cloud-commands.md).

For bug-fix workflows, validate the fix in a **fresh environment** (cloud sandbox, Docker, or isolated shell) — don't trust dirty local state.

## Starter templates

| Goal | Start with |
|---|---|
| Single feature + tests + commit | [Quickstart](https://agentrelay.com/docs/markdown/workflows-quickstart.md) |
| Multi-file edit with review | [Lead + workers](https://agentrelay.com/docs/markdown/workflows-patterns.md) |
| Cross-repo PR | [Cross-repo](https://agentrelay.com/docs/markdown/workflows-patterns.md) + `createGitHubStep` |
| Tested before commit | [Test-fix-rerun](https://agentrelay.com/docs/markdown/workflows-patterns.md) |
| Fix workflow with E2E validation | relay-80-100-workflow skill |

## Companion skills

| Skill | For |
|---|---|
| `relay-80-100-workflow` | Validation gates, PGlite, regression checks, test-fix-rerun patterns |
| `choosing-swarm-patterns` | Picking the right pattern for the coordination problem |
| `running-headless-orchestrator` | Self-bootstrapping agent manages its own worker team |

## Installation

Install this skill (and its companion) via `prpm` or `skills.sh`:

```bash
# prpm (recommended)
npx prpm install @agent-relay/writing-agent-relay-workflows --as claude
npx prpm install @agent-relay/relay-80-100-workflow --as claude
npx prpm install @agent-relay/choosing-swarm-patterns --as claude

# Or install all three for multiple hosts at once
npx prpm install \
  @agent-relay/writing-agent-relay-workflows \
  @agent-relay/relay-80-100-workflow \
  @agent-relay/choosing-swarm-patterns \
  --as claude,codex
```

```bash
# skills.sh
npx skills add https://github.com/agentworkforce/skills --skill writing-agent-relay-workflows
npx skills add https://github.com/agentworkforce/skills --skill relay-80-100-workflow
npx skills add https://github.com/agentworkforce/skills --skill choosing-swarm-patterns
```

Once installed, a prompt like "Write a workflow that adds a `pending` status to `src/types.ts` with tests, using the 80-to-100 pattern so the commit only lands if tests pass" just works — the host agent reads the skills alongside your prompt and writes a workflow that follows repo conventions.
