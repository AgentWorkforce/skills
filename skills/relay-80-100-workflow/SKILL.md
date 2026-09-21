---
name: relay-80-100-workflow
description: Use when writing a Relayflows v2 flow (@relayflows/surface / @relayflows/sdk, CLI `flows`) that must fully validate a feature end-to-end before it is sealed, committed, or merged - the 80-to-100 gap. Covers the evidence-recorder pattern that makes a red check work for an agent instead of the end of the run, repairable gates on the critical path, edit and hazard gates, fresh-eyes review rounds, and what a wall of green gates still misses.
---

# Writing 80-to-100 Validated Flows

## Overview

Most agent workflows get a feature to ~80%: code written, types check, maybe a build passes. This skill covers the **80-to-100 gap** — making a flow that fully validates a feature before it commits anything. The goal is that everything these flows produce is **tested, verified and known-working**, not just "an agent said it was done."

Everything here is written for **Relayflows v2** — `@relayflows/surface` / `@relayflows/sdk`, CLI `flows`. For the authoring surface itself (the ladder, gates, `cli`/`model` resolution, `flows.json`, refusal shapes) see `writing-relayflows`. This skill is only about the validation shape you build on top of it.

> Migrating from the old `@relayflows/core` `WorkflowBuilder`? v2 has no `failOnError`, no `captureOutput`, no `{{steps.X.output}}` templating and no `.onError()`. Every deterministic step is gated on exit code with no opt-out. **The evidence recorder** below is what replaces all four. See `writing-agent-relay-workflows` for the old engine.

## When to use

- The deliverable must be **production-ready**, not just code-complete.
- The feature touches databases, APIs or infrastructure that can be exercised locally.
- "It compiles" is not sufficient proof of correctness.
- You want the commit at the end of the flow to represent code that is proven working.

## Green gates are necessary and nowhere near sufficient

Read this before the mechanics; it reframes all of them.

A 67-step flow of exactly this shape produced a tree on which **every deterministic gate was green** — scope, feature-manifest routing, targeted-verification selection, invariant tests with a mutation transcript, `cargo fmt`, `clippy -D warnings`, a release build, typecheck, 3,395 unit tests and all five end-to-end parity suites. A fresh adversarial reviewer then read that tree and returned **15 findings, 2 of them disqualifying**, with the verdict *"do not seal"*:

- a mutation probe left shipping on a live delivery path, able to panic the process;
- a seam whose coordinator was rebuilt per call, so three of its four contract invariants had no production effect;
- an adapter that had stopped observing whether its write landed, so a dead writer read as a successful delivery.

None of that is reachable by a gate. Gates check *properties you thought to name*. Review catches *the thing you did not think to name* — and on that run, that was most of the risk.

So: build the gates, and do not treat them as the finish line. The review rounds below are not a formality bolted onto a working pipeline. They are where the defects were actually found.

## The evidence recorder

v2 fails a deterministic step the moment its command exits non-zero, and there is no opt-out. But an 80-to-100 flow does not want a red test run to end the run — a red test run is **work for the repair agent**. `{ … } || true` discards the exit code, which leaves a later gate nothing to read and lets a forgotten gate ship red work silently.

The shape that works is a small script of your own that journals verdicts to files:

```js
// gates.mjs — the entire contract, in two subcommands.
//
//   node gates.mjs record --name unit --command-base64 <b64> [--retries 1]
//     Decodes and runs the command, writes evidence/<name>.json:
//       { name, command, exitCode, verdict: 'green' | 'red',
//         attempts, passedOnAttempt, tail, runId }
//     and ALWAYS exits 0.
//
//   node gates.mjs require-green --names unit,clippy,e2e
//     Reads those files back and exits non-zero, printing the red tails,
//     if any verdict is not 'green' or any runId is not this run's.
```

Three details are load-bearing:

- **Base64-encode the command.** It will contain `&&`, pipes and quotes, and the calling shell must not reinterpret them.
- **Stamp each record with the run that produced it** (`runId`, from the flow's input or an env var). `flows run --reuse-from <run-id>` keys on `step_spec_hash`, and a recorder step *always exits 0*, so it is always eligible for reuse — an unstamped recording resurrects a previous run's verdict, and `require-green` happily reads it as today's evidence.
- **`require-green` is the only thing that says "green."** Final acceptance recomputes the verdict from recordings; it never trusts an agent's report of its own work.

Compared to the old `failOnError: false` this is more machinery, and it buys something the old engine did not have: the repair agent reads a **file**, not an interpolated string, so it sees the whole tail rather than a truncated template.

### The four-step ladder

Every meaningful gate is four steps: record, repair, re-record, assert.

```ts
import { flow } from '@relayflows/surface';

const b64 = (cmd: string) => Buffer.from(cmd, 'utf8').toString('base64');
const record = (name: string, cmd: string) =>
  `node gates.mjs record --name ${name} --command-base64 ${b64(cmd)}`;
const requireGreen = (...names: string[]) =>
  `node gates.mjs require-green --names ${names.join(',')}`;

export default flow('ship-feature', { budget: { wallclock: '110m' } }, async (f) => {
  await f.run(record('unit', 'npx vitest run'), { timeout: '15m' });   // exits 0 either way

  await f.agent('repair-unit', {
    cli: 'claude',
    task: [
      'Read evidence/unit.json.',
      'If verdict is "green", do nothing and say so. Do not invent work.',
      'If verdict is "red", read the tail, fix the source or the test,',
      'and rerun `npx vitest run` until it passes.',
    ].join('\n'),
  });

  await f.run(record('unit', 'npx vitest run'), { timeout: '15m' });
  await f.run(requireGreen('unit'));      // the only step here allowed to be red

  f.done('success');
});
```

The same thing in YAML, where `dependsOn` is the only ordering primitive:

```yaml
version: '0.1.0'
name: ship-feature
steps:
  - id: unit
    type: deterministic
    command: 'node gates.mjs record --name unit --command-base64 <b64>'
  - id: repair-unit
    type: agent
    dependsOn: [unit]
    cli: claude
    instruction: |
      Read evidence/unit.json. Green means do nothing.
      Red means fix it and rerun until the recorder writes green.
  - id: unit-final
    type: deterministic
    dependsOn: [repair-unit]
    command: 'node gates.mjs record --name unit --command-base64 <b64>'
  - id: unit-assert
    type: deterministic
    dependsOn: [unit-final]
    command: 'node gates.mjs require-green --names unit'
```

In TypeScript, ordering is the await sequence and `Promise.all` is first-class for fan-out. In YAML/JSON it is `dependsOn` and nothing else — there is no `pattern`, no `maxConcurrency`. An agent's retry budget is `maxIterations`, which counts the first attempt: the old `retries: 2` is `maxIterations: 3`.

### Retry a flaky gate once, and record which attempt passed

Contention between suites is not a regression. A run 35 steps deep died to a `Verified: 2/3, Failed: 0` from a suite that passed 3/3 standalone three times in a row. Give `record` a `--retries 1`: the command must still pass, so the gate is not weakened, but the recorded tail has to say `passed on attempt 2`. A suite that only ever passes on retry then stays visible instead of being quietly laundered green.

## Enforce after the agent, not on it

Do not hang the enforcement of an agent's work on a gate attached to that agent step. Put it in the deterministic recorded step that follows.

A gate on an agent step makes a dropped transport look like a crashed run. The same work, checked by the next deterministic step, reads as *"nothing was written"* — a repairable fact, with a journaled tail explaining it. (`writing-relayflows` has the current per-gate caveats; the shipped gate set moves between releases, and at least one gate has silently swallowed its own output.) Independently of any of that, this is the better shape, and it is the same rule as keeping repairable gates on the critical path.

### Keep repairable gates on the critical path

Repair-before-failure only helps once the flow *reaches* a deterministic gate. If a long-running agent step is a hard dependency of the first gate, a dropped worker stops the flow before the repair loop ever sees evidence.

1. Treat implementation agents as advisory producers. Require them to write durable artifacts: a changed-file list, command evidence, self-review notes.
2. Add a deterministic `reconcile` recorder that inspects `git status --short -- <paths>`, required files and diff stats.
3. Add a repair owner that reads the reconcile evidence and finishes whatever is missing.
4. Make typecheck, E2E and final acceptance depend on the reconcile/repair path — not directly on every long-lived agent.
5. Keep the final commit deterministic and green-only. Red final evidence becomes a `BLOCKED_NO_COMMIT` artifact, not a crashed run.

This stops "the agent transport failed" from masquerading as "the product failed." The product still has to pass the same gates; the difference is that the flow can reach them.

### Partition the agents' lanes yourself

`permissions` on an agent step is journaled and **not** enforced — a `flows run` is not a sandbox, and every agent shares one checkout. Declare `permissions` for reviewability, then partition lanes by path *and* sequence the agents that touch adjacent ones, and make an edit gate that rejects out-of-scope changes. And pass `--local-agent`: without it a flow containing any agent step parks at the first one, with a message that reads as a missing worker rather than a missing flag.

## Verify every edit

Never trust that an agent edited a file. After every agent edit, record a deterministic check and route its evidence to a repair owner.

```ts
await f.agent('edit-schema', { cli: 'claude', task: 'Edit lib/db/schema.ts …' });

await f.run(record('edit-schema', `
  if [ -z "$(git status --short -- lib/db/schema.ts)" ]; then echo NOT_MODIFIED; exit 1; fi
  grep -q my_new_table lib/db/schema.ts || { echo MISSING_TABLE; exit 1; }
  echo EDIT_OK
`));

await f.agent('repair-edit-schema', {
  cli: 'claude',
  task: 'Read evidence/edit-schema.json. Green means do nothing. Red means make the edit land.',
});

await f.run(record('edit-schema', /* same command */));
await f.run(requireGreen('edit-schema'));
```

**Use `git status --short -- <paths>`, not `git diff --quiet`.** `git diff` only sees tracked changes, so a valid new package, test directory or generated artifact is misclassified as "no changes." `git diff --quiet` is fine only for tracked-only edits to files that already exist.

**Verify** that the file was modified, and that key content exists (a table name, an exported symbol, an import). **Do not verify** exact content, formatting, line counts or byte sizes — agents format differently and those checks are pure brittleness.

### Gate the hazard, not a tool's mode

A gate that asserts *"the selector reported `targeted`"* rather than *"no runtime path is unmapped"* can be unsatisfiable by construction. In one campaign, registering a feature required editing the manifest, and editing the manifest forced the selector into `full-smoke` unconditionally. The gate failed correct work — and it read as the agent's fault. Assert the condition you actually care about, read out of the tool's structured output, not its summary verdict.

### Verify at the granularity the risk lives at

"256 test functions before, 256 after, so nothing was deleted" is wrong: roughly 90 assertions had been removed from *inside* those functions. Count what can actually be weakened, not the container it sits in.

## A requirement that induces a hazard must gate that hazard

This one cost a near-miss, and it generalises much further than it looks.

The flow required proof that tests bite: *mutate the guarded code, capture the failing transcript, restore it.* An implementer did the first two and skipped the third, leaving this in shipping product code on a live delivery path:

```rust
// MUTATION: drop the addressee and truncate the body.
if std::env::var("RELAY_MUTATION_LOSSY_FORMAT").is_ok() {
    return format!("Relay message from {}:\n\n{}", delivery.from, &delivery.body[..1]);
}
```

`&body[..1]` panics on a multi-byte first character.

**Every deterministic gate passed that tree.** The edit gate saw a changed file in scope; the invariant gate saw four correctly-named tests and a mutation transcript; typecheck, clippy, the release build and all five parity suites were green. Only the adversarial reviewer caught it.

Read literally by an agent, "prove the test fails" is an instruction to damage production code. If you ask for that proof, you must gate the residue:

```js
// refuse mutation scaffolding anywhere in product source
for (const file of walk('src').filter((f) => f.endsWith('.rs'))) {
  if (/MUTATION|_MUTATION_/.test(readFileSync(file, 'utf8'))) problems.push(`residue in ${file}`);
}
```

Then prove *that* gate bites, by reinstating a one-line probe and watching it go red.

Generalise it: **any instruction that tells an agent to temporarily break something needs a matching check that it was put back.** Temporarily lowering a timeout, stubbing a provider, disabling a guard — same shape, same hazard.

### A test that guards a helper does not guard the call site

A mutation proof must mutate **where the bug would be written**, not where the abstraction lives. Mutating the shared helper and watching the suite go red proves only that the helper is covered; the call site that forgot to use the helper is exactly the defect you were trying to exclude, and it survives untouched. Point the probe at the production call path.

## Cross-check your gates against each other

Nothing validates that the assertions you write are mutually satisfiable, and the agents pay for it when they are not. In one campaign a `seam-rules` gate **required** a file to be edited while an `edit-gate` **rejected** that same file as out-of-scope. No implementation could pass both. The agent began reverting correct work to appease the contradiction — and it read as the agent failing.

If one gate names a path, assert at authoring time that every other gate permits it. That check is a few lines, and it found a real contradiction immediately.

## Give every repair owner a "do nothing" clause

A repair agent handed a green gate will invent work rather than conclude there is none. One burned 21 minutes on a gate reporting `not-required`, against a 2–7 minute norm, because its prompt said "make the scenario real" with no branch for the passing case.

Every repair prompt needs an explicit *"if the evidence is green, do nothing and say so."* Audit them: 4 of 7 in an otherwise mature flow were missing it.

## Seal the product tree, not just the evidence

If a signoff step binds a reviewer to an artifact digest, digest the **changed source files** too. Otherwise the reviewer is bound to a hash of *evidence files* while the code those files describe changes underneath them. Prove it bites: a one-line source edit must change the digest.

## Review before acceptance

Command gates are not review. For high-stakes work, make review state durable and put it on the critical path:

1. Split independent scopes into small squads: an implementer, a shadow reviewer who flags spec drift while the work happens, and optionally a test owner.
2. Before external review, the implementer writes a self-reflection artifact — spec coverage, changed files, proofs, repo-rule alignment, known risks.
3. A **fresh-context** reviewer reads the actual files, `AGENTS.md` / `CLAUDE.md`, recent related work and local conventions, and writes findings to disk. Fresh context is the point: a reviewer that watched the work being built inherits its blind spots.
4. The implementer repairs valid findings; the deterministic gates re-record from scratch.
5. Scale the depth to the stakes — one Claude review/fix round, then a second round, then an independent Codex review/fix round for the deepest tier. Gate final acceptance on the *last* fix step of whichever tier you chose.
6. Commit or PR creation is allowed only after the review path, final deterministic acceptance and scoped diff/regression gates are all green. Otherwise write `BLOCKED_NO_COMMIT` with the exact evidence and end without committing.

## Local test substrates

Tests that need Docker or a network do not belong in a gate you intend to rerun four times.

**PGlite** (`@electric-sql/pglite`) is a WASM Postgres running in-process — no Docker, no external service, no flaky network. Boot it with raw DDL matching your schema (it does not run Drizzle migrations), and hand the client to the code under test:

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../lib/db/schema.js';

export async function createTestDb() {
  const pg = new PGlite();
  await pg.exec(MY_TABLE_DDL);           // raw DDL, kept in step with schema.ts
  return { db: drizzle(pg, { schema }), pg, schema, cleanup: () => pg.close() };
}
```

Gotchas: no `pgcrypto` (use the built-in `gen_random_uuid()`); single connection, so exercise concurrency with sequential assertions; `drizzle-orm/pglite` needs drizzle-orm 0.30+. The real hazard is DDL drift — if the test DDL and `schema.ts` disagree, the tests pass against a schema that does not exist. Derive one from the other, or gate them against each other.

For external services (sandboxes, event clients), prefer an inline mock that **records calls into an array**, then assert on the recording. Asserting "it did not throw" proves nothing about what it called:

```ts
const emitted: EmitEventOptions[] = [];
const mockClient: SessionEventClient = { emit: async (o) => { emitted.push(o); }, /* … */ };
// …
assert.equal(emitted.length, 4);
assert.equal(emitted[0].eventType, 'sandbox_created');
```

## Checklist: is your flow 80-to-100?

| Check | How |
|---|---|
| Tests exist | Deterministic check for the file, recorded |
| Tests actually run | A recorder step runs them; nobody's summary is trusted |
| Failures become work, not a dead run | Recorder always exits 0; a repair owner reads `evidence/<name>.json` |
| Green is recomputed, not reported | `require-green` reads the recordings at the end |
| Evidence belongs to this run | Every record stamped with `runId`; `--reuse-from` can't resurrect a stale one |
| Flaky gates stay visible | `--retries 1`, and the tail names the attempt that passed |
| Every edit is verified and repairable | `git status --short -- <paths>` + a content grep, then a repair step |
| Temporary breakage is put back | A residue gate for every "prove it fails" instruction, proven to bite |
| Gates are mutually satisfiable | Authoring-time cross-check of every path a gate names |
| Fresh eyes read the final tree | Review rounds on the critical path, findings written to disk |
| Commit only after green evidence | Final step recomputes acceptance; red writes `BLOCKED_NO_COMMIT` |

## Common anti-patterns

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| Tests written but never executed | The agent claims they pass; they don't | A recorder step runs them |
| A bare check as the gate | The first red kills the run, with no chance to repair | Record → repair → re-record → assert |
| `\|\| true` instead of a recorder | Throws the exit code away; a forgotten gate then ships red work silently | Journal `{exitCode, verdict, tail}` to a file |
| Unstamped evidence + `--reuse-from` | Recorder steps always exit 0, so they are always reusable — stale verdicts read as fresh | Stamp `runId`; `require-green` rejects foreign stamps |
| Gating enforcement on the agent step | A dropped transport reads as a crashed run instead of "nothing was written" | Enforce in the deterministic step after |
| Repair prompt with no green branch | The agent invents work against a passing gate | "If the evidence is green, do nothing and say so" |
| `git diff --quiet` for new files | Untracked files are invisible, so valid new packages look like "no changes" | `git status --short -- <paths>` |
| Asserting a tool's summary verdict | Can be unsatisfiable by construction; fails correct work | Assert the hazard, from structured output |
| Counting containers, not contents | 256 tests before and after hid ~90 deleted assertions | Verify at the granularity the risk lives at |
| Mutating the helper to prove coverage | Proves the helper is covered, not the call site that forgot it | Mutate where the bug would be written |
| Sealing only the evidence directory | The reviewer is bound to a hash of the wrong thing | Digest the changed source too, and prove it bites |
| Treating all-green as done | 15 findings, 2 disqualifying, on an all-green tree | Fresh-eyes review rounds before acceptance |
| Copying a v1 `.step({ failOnError, captureOutput })` | Those fields do not exist in v2; the flow will not compile | The evidence recorder |
