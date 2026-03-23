---
name: writing-agent-relay-workflows
description: Use when building multi-agent workflows with the relay broker-sdk - covers the WorkflowBuilder API, DAG step dependencies, agent definitions, step output chaining via {{steps.X.output}}, verification gates, evidence-based completion, owner decisions, dedicated channels, swarm patterns, error handling, event listeners, step sizing rules, authoring best practices, and the lead+workers team pattern for complex steps
---

# Writing Agent Relay Workflows

## Overview

The relay broker-sdk workflow system orchestrates multiple AI agents (Claude, Codex, Gemini, Aider, Goose) through typed DAG-based workflows. Workflows can be written in **TypeScript** (preferred), **Python**, or **YAML**.

**Language preference:** TypeScript > Python > YAML. Use TypeScript unless the project is Python-only or a simple config-driven workflow suits YAML.

## When to Use

- Building multi-agent workflows with step dependencies
- Orchestrating different AI CLIs (claude, codex, gemini, aider, goose)
- Creating DAG, pipeline, fan-out, or other swarm patterns
- Needing verification gates, retries, or step output chaining

## Quick Reference

```typescript
const { workflow } = require('@agent-relay/sdk/workflows');

async function main() {
const result = await workflow('my-workflow')
  .description('What this workflow does')
  .pattern('dag') // or 'pipeline', 'fan-out', etc.
  .channel('wf-my-workflow') // dedicated channel (auto-generated if omitted)
  .maxConcurrency(3)
  .timeout(3_600_000) // global timeout (ms)

  .agent('lead', { cli: 'claude', role: 'Architect', retries: 2 })
  .agent('worker', { cli: 'codex', role: 'Implementer', retries: 2 })

  .step('plan', {
    agent: 'lead',
    task: `Analyze the codebase and produce a plan.`,
    retries: 2,
    verification: { type: 'output_contains', value: 'PLAN_COMPLETE' },
  })
  .step('implement', {
    agent: 'worker',
    task: `Implement based on this plan:\n{{steps.plan.output}}`,
    dependsOn: ['plan'],
    verification: { type: 'exit_code' },
  })

  .onError('retry', { maxRetries: 2, retryDelayMs: 10_000 })
  .run({ cwd: process.cwd() });

  console.log('Result:', result.status);
}

main().catch(console.error);
```

**Critical TypeScript rules:**
1. Use `require()`, not `import` — most projects default to CJS
2. Wrap in `async function main()` — CJS does not support top-level await
3. Use `.run({ cwd: process.cwd() })` — `createWorkflowRenderer` does not exist
4. Validate with `--dry-run` before running: `agent-relay run --dry-run workflow.ts`

## Key Concepts

### Step Output Chaining

Use `{{steps.STEP_NAME.output}}` in a downstream step's task to inject the prior step's terminal output.

**Only chain output from clean sources:**
- Deterministic steps (shell commands — always clean)
- Non-interactive agents (`preset: 'worker'` — clean stdout)

**Never chain from interactive agents** (`cli: 'claude'` without preset) — PTY output includes spinners, ANSI codes, and TUI chrome. Instead, have the agent write to a file, then read it in a deterministic step.

### Verification Gates

```typescript
verification: { type: 'exit_code' }                        // preferred for code-editing steps
verification: { type: 'output_contains', value: 'DONE' }   // optional accelerator
verification: { type: 'file_exists', value: 'src/out.ts' } // deterministic file check
```

Only these four types are valid: `exit_code`, `output_contains`, `file_exists`, `custom`. Invalid types are silently ignored and fall through to process-exit auto-pass.

**Verification token gotcha:** If the token appears in the task text, the runner requires it **twice** in output (once from task echo, once from agent). Prefer `exit_code` for code-editing steps to avoid this.

### DAG Dependencies

Steps with `dependsOn` wait for all listed steps. Steps with no dependencies start immediately. Steps sharing the same `dependsOn` run in parallel:

```typescript
.step('fix-types',  { agent: 'worker', dependsOn: ['review'], ... })
.step('fix-tests',  { agent: 'worker', dependsOn: ['review'], ... })
.step('final',      { agent: 'lead',   dependsOn: ['fix-types', 'fix-tests'], ... })
```

### Self-Termination

Do NOT add exit instructions to task strings. The runner handles this automatically.

### Step Completion Model

Steps complete through a multi-signal pipeline (highest priority first):

1. **Deterministic verification** — `exit_code`, `file_exists`, `output_contains` pass → immediate completion
2. **Owner decision** — `OWNER_DECISION: COMPLETE|INCOMPLETE_RETRY|INCOMPLETE_FAIL`
3. **Evidence-based** — channel signals, file artifacts, clean exit code
4. **Marker fast-path** — `STEP_COMPLETE:<step-name>` (optional accelerator)
5. **Process-exit fallback** — agent exits 0 with no signals → completes after grace period

**Key principle:** No single signal is mandatory. Describe the deliverable, not what to print.

## Agent Definition

```typescript
.agent('name', {
  cli: 'claude' | 'codex' | 'gemini' | 'aider' | 'goose' | 'opencode' | 'droid',
  role?: string,
  preset?: 'lead' | 'worker' | 'reviewer' | 'analyst',
  retries?: number,
  model?: string,
  interactive?: boolean, // default: true
})
```

| Preset     | Interactive   | Relay access | Use for                                              |
| ---------- | ------------- | ------------ | ---------------------------------------------------- |
| `lead`     | yes (PTY)     | yes          | Coordination, monitoring channels                    |
| `worker`   | no (subprocess) | no         | Bounded tasks, structured stdout                     |
| `reviewer` | no (subprocess) | no         | Reading artifacts, producing verdicts                |
| `analyst`  | no (subprocess) | no         | Reading code/files, writing findings                 |

Non-interactive presets run via one-shot mode (`claude -p`, `codex exec`). Output is clean and available via `{{steps.X.output}}`.

**Critical rule:** Pre-inject content into non-interactive agents. Don't ask them to read large files — pre-read in a deterministic step and inject via `{{steps.X.output}}`.

## Step Definition

### Agent Steps

```typescript
.step('name', {
  agent: string,
  task: string,                   // supports {{var}} and {{steps.NAME.output}}
  dependsOn?: string[],
  verification?: VerificationCheck,
  retries?: number,
})
```

### Deterministic Steps (Shell Commands)

```typescript
.step('verify-files', {
  type: 'deterministic',
  command: 'test -f src/auth.ts && echo "FILE_EXISTS"',
  dependsOn: ['implement'],
  captureOutput: true,
  failOnError: true,
})
```

Use for: file checks, reading files for injection, build/test gates, git operations.

## Common Patterns

### Pipeline (sequential handoff)

```typescript
.pattern('pipeline')
.step('analyze', { agent: 'analyst', task: '...' })
.step('implement', { agent: 'dev', task: '{{steps.analyze.output}}', dependsOn: ['analyze'] })
.step('test', { agent: 'tester', task: '{{steps.implement.output}}', dependsOn: ['implement'] })
```

### Error Handling

```typescript
.onError('fail-fast')   // stop on first failure (default)
.onError('continue')    // skip failed branches, continue others
.onError('retry', { maxRetries: 3, retryDelayMs: 5000 })
```

## Multi-File Edit Pattern

When a workflow needs to modify multiple existing files, **use one agent step per file** with a deterministic verify gate after each. Agents reliably edit 1-2 files per step but fail on 4+.

```yaml
steps:
  - name: read-types
    type: deterministic
    command: cat src/types.ts
    captureOutput: true

  - name: edit-types
    agent: dev
    dependsOn: [read-types]
    task: |
      Edit src/types.ts. Current contents:
      {{steps.read-types.output}}
      Add 'pending' to the Status union type.
      Only edit this one file.
    verification:
      type: exit_code

  - name: verify-types
    type: deterministic
    dependsOn: [edit-types]
    command: 'if git diff --quiet src/types.ts; then echo "NOT MODIFIED"; exit 1; fi; echo "OK"'
    failOnError: true

  - name: read-service
    type: deterministic
    dependsOn: [verify-types]
    command: cat src/service.ts
    captureOutput: true

  - name: edit-service
    agent: dev
    dependsOn: [read-service]
    task: |
      Edit src/service.ts. Current contents:
      {{steps.read-service.output}}
      Add a handlePending() method.
      Only edit this one file.
    verification:
      type: exit_code

  - name: verify-service
    type: deterministic
    dependsOn: [edit-service]
    command: 'if git diff --quiet src/service.ts; then echo "NOT MODIFIED"; exit 1; fi; echo "OK"'
    failOnError: true

  # Deterministic commit — never rely on agents to commit
  - name: commit
    type: deterministic
    dependsOn: [verify-service]
    command: git add src/types.ts src/service.ts && git commit -m "feat: add pending status"
    failOnError: true
```

**Key rules:**
- Read the file in a deterministic step right before the edit (not all files upfront)
- Tell the agent "Only edit this one file" to prevent it touching other files
- Verify with `git diff --quiet` after each edit — fail fast if the agent didn't write
- Always commit with a deterministic step, never an agent step

## File Materialization: Verify Before Proceeding

After any step that creates files, add a deterministic `file_exists` check before proceeding. Non-interactive agents may exit 0 without writing anything (wrong cwd, stdout instead of disk).

```yaml
- name: verify-files
  type: deterministic
  dependsOn: [impl-auth, impl-storage]
  command: |
    missing=0
    for f in src/auth/credentials.ts src/storage/client.ts; do
      if [ ! -f "$f" ]; then echo "MISSING: $f"; missing=$((missing+1)); fi
    done
    if [ $missing -gt 0 ]; then echo "$missing files missing"; exit 1; fi
    echo "All files present"
  failOnError: true
```

**Rules for file-writing tasks:**
1. Use full paths from project root — say `src/auth/credentials.ts`, not `credentials.ts`
2. Add `IMPORTANT: Write the file to disk. Do NOT output to stdout.`
3. Use `file_exists` verification for creation steps (not just `exit_code`)
4. Gate all downstream steps on the verify step

## DAG Deadlock Anti-Pattern

```yaml
# WRONG — deadlock: coordinate depends on context, work-a depends on coordinate
steps:
  - name: coordinate
    dependsOn: [context]    # lead waits for WORKER_DONE...
  - name: work-a
    dependsOn: [coordinate] # ...but work-a can't start until coordinate finishes

# RIGHT — workers and lead start in parallel
steps:
  - name: context
    type: deterministic
  - name: work-a
    dependsOn: [context]    # starts with lead
  - name: coordinate
    dependsOn: [context]    # starts with workers
  - name: merge
    dependsOn: [work-a, coordinate]
```

**Rule:** if a lead step's task mentions downstream step names alongside waiting keywords, that's a deadlock.

## Step Sizing

**One agent, one deliverable.** A step's task prompt should be 10-20 lines max.

Split into a **lead + workers team** when:
- The task requires a 50+ line prompt
- The deliverable is multiple files that must be consistent
- You need one agent to verify another's output

```yaml
# Team pattern: lead + workers on a shared channel
steps:
  - name: track-lead-coord
    agent: track-lead
    dependsOn: [prior-step]
    task: |
      Lead the track on #my-track. Workers: track-worker-1, track-worker-2.
      Post assignments to the channel. Review worker output.

  - name: track-worker-1-impl
    agent: track-worker-1
    dependsOn: [prior-step]  # same dep as lead — starts concurrently
    task: |
      Join #my-track. track-lead will post your assignment.
      Implement the file as directed.
    verification:
      type: exit_code

  - name: next-step
    dependsOn: [track-lead-coord]  # downstream depends on lead, not workers
```

## Supervisor Pattern

When you set `.pattern('supervisor')` (or `hub-spoke`, `fan-out`), the runner auto-assigns a supervisor agent as owner for worker steps. The supervisor monitors progress, nudges idle workers, and issues `OWNER_DECISION`.

**Auto-hardening only activates for hub patterns** — not `pipeline` or `dag`.

| Use case | Pattern | Why |
|----------|---------|-----|
| Sequential, no monitoring | `pipeline` | Simple, no overhead |
| Workers need oversight | `supervisor` | Auto-owner monitors |
| Local/small models | `supervisor` | Supervisor catches stuck workers |
| All non-interactive | `pipeline` or `dag` | No PTY = no supervision needed |

## Concurrency

**Cap `maxConcurrency` at 4-6.** Spawning 10+ agents simultaneously causes broker timeouts.

| Parallel agents | `maxConcurrency` |
|-----------------|-------------------|
| 2-4             | 4 (default safe)  |
| 5-10            | 5                 |
| 10+             | 6-8 max           |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Adding exit instructions to tasks | Runner handles self-termination automatically |
| Setting `timeoutMs` on agents/steps | Use global `.timeout()` only |
| Using `general` channel | Set `.channel('wf-name')` for isolation |
| `{{steps.X.output}}` without `dependsOn: ['X']` | Output won't be available yet |
| Requiring exact sentinel as only completion gate | Use `exit_code` or `file_exists` verification |
| Writing 100-line task prompts | Split into lead + workers on a channel |
| `maxConcurrency: 16` with many parallel steps | Cap at 5-6 |
| Non-interactive agent reading large files via tools | Pre-read in deterministic step, inject via `{{steps.X.output}}` |
| Workers depending on lead step (deadlock) | Both depend on shared context step |
| `fan-out`/`hub-spoke` for simple parallel workers | Use `dag` instead |
| `pipeline` but expecting auto-supervisor | Only hub patterns auto-harden. Use `.pattern('supervisor')` |
| Workers without `preset: 'worker'` in lead+worker flows | Add preset for clean stdout |
| Using `_` in YAML numbers (`timeoutMs: 1_200_000`) | YAML doesn't support `_` separators |
| Workflow timeout under 30 min for complex workflows | Use `3600000` (1 hour) as default |
| `import { workflow }` (ESM) in TypeScript workflows | Use `require('@agent-relay/sdk/workflows')` — most repos are CJS |
| Top-level `await` in TypeScript | Wrap in `async function main() { ... } main().catch(console.error)` |
| Using `createWorkflowRenderer` | Does not exist. Use `.run({ cwd: process.cwd() })` |
| `export default workflow(...)...build()` | No `.build()`. Chain ends with `.run()` inside async main |
| Relative import `'../workflows/builder.js'` | Use `require('@agent-relay/sdk/workflows')` |
| `pattern('single')` on cloud runner | Not supported — use `dag` |
| `pattern('supervisor')` with one agent | Same agent is owner + specialist. Use `dag` |
| Invalid verification type (`type: 'deterministic'`) | Only `exit_code`, `output_contains`, `file_exists`, `custom` are valid |
| Chaining `{{steps.X.output}}` from interactive agents | PTY output is garbled. Use deterministic steps or `preset: 'worker'` |
| Single step editing 4+ files | Agents modify 1-2 then exit. Split to one file per step with verify gates |
| Relying on agents to `git commit` | Agents emit markers without running git. Use deterministic commit step |
| File-writing steps without `file_exists` verification | `exit_code` auto-passes even if no file written |

## YAML Alternative

```yaml
version: '1.0'
name: my-workflow
swarm:
  pattern: dag
  channel: wf-my-workflow
agents:
  - name: lead
    cli: claude
    role: Architect
  - name: worker
    cli: codex
    role: Implementer
workflows:
  - name: default
    steps:
      - name: plan
        agent: lead
        task: 'Produce a detailed implementation plan.'
      - name: implement
        agent: worker
        task: 'Implement: {{steps.plan.output}}'
        dependsOn: [plan]
        verification:
          type: exit_code
```

Run with: `agent-relay run path/to/workflow.yaml`

## Available Swarm Patterns

`dag` (default), `fan-out`, `pipeline`, `hub-spoke`, `consensus`, `mesh`, `handoff`, `cascade`, `debate`, `hierarchical`, `map-reduce`, `scatter-gather`, `supervisor`, `reflection`, `red-team`, `verifier`, `auction`, `escalation`, `saga`, `circuit-breaker`, `blackboard`, `swarm`

See skill `choosing-swarm-patterns` for pattern selection guidance.
