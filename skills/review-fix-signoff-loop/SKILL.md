---
name: review-fix-signoff-loop
description: Use when writing Agent Relay or Ricky workflows that must loop review, fix, and validation with fresh agent context until independent signoff agents, typically Claude and Codex, both agree the work is comprehensively complete. Covers fresh-context iterations, repairable gates, dual reviewer verdict contracts, iteration-count reporting, PR signoff comments, and blocked-state handling.
---

# Review Fix Signoff Loop

## Purpose

Use this pattern for high-stakes implementation workflows where a normal "implement, test, review once" flow is not enough. The workflow must keep repairing and re-reviewing until independent signoff agents agree the spec is fully wired end to end.

Pair this with `writing-agent-relay-workflows` for SDK syntax and `relay-80-100-workflow` for deterministic validation gates.

## Required Shape

1. Run deterministic preflight before agents start.
   - Confirm repository root, required specs, declared write scope, credentials needed for PR comments, and whether commit/push/PR creation is in scope.
   - Write preflight evidence to `.workflow-artifacts/<workflow>/iteration-N/preflight.md`.

2. Implement with scoped owners.
   - Use Codex workers for code changes unless the codebase has a reason to prefer another CLI.
   - Split backend, frontend, desktop, tests, docs, or infrastructure into explicit non-overlapping ownership areas.
   - Each worker writes a durable summary artifact with changed files and commands run.

3. Reconcile before validation.
   - Add a deterministic `implementation-reconcile` gate that checks required files, expected API/UI/runtime surfaces, migrations, generated artifacts, and untracked files with `git status --short -- <paths>`.
   - Use `failOnError: false`, then route the captured output to a repair owner.

4. Run repairable validation.
   - Use capture -> fix -> rerun for typecheck, targeted tests, integration or E2E tests, and regression checks.
   - Red validation output is input for a repair agent, not an immediate workflow failure.
   - Write `BLOCKED_NO_COMMIT.md` only for true external blockers.

5. Run fresh-context signoff reviews.
   - Start a new workflow run, new agent names, or otherwise new agent contexts for each loop iteration.
   - Run Claude and Codex signoff reviews independently over the same post-validation repo state.
   - Reviewers must read specs, diff, validation logs, artifacts, and actual files.

6. Break only on dual signoff.
   - The loop may exit only when both reviewers write the exact satisfied verdict and final deterministic acceptance is green.
   - If either reviewer finds issues or is blocked, run a Codex fix pass and start a new fresh-context review iteration.

7. Report final signoff.
   - Write a final `SIGNOFF.md` that includes iteration count, validation evidence, Claude rationale, Codex rationale, remaining risks, and artifact paths.
   - Post the same report to the PR. Resolve the PR from an explicit env var first, then from `gh pr view`.

## Verdict Contract

Use a strict text contract so deterministic gates can parse the result:

```text
VERDICT: COMPREHENSIVELY_SATISFIED | FINDINGS | BLOCKED
why_passed: required when VERDICT is COMPREHENSIVELY_SATISFIED
end_to_end_wiring_verified: required when VERDICT is COMPREHENSIVELY_SATISFIED
deterministic_evidence: required when VERDICT is COMPREHENSIVELY_SATISFIED
remaining_risks: required when VERDICT is COMPREHENSIVELY_SATISFIED
finding_id: stable-id when VERDICT is FINDINGS
severity: blocker | high | medium | low
file: path
issue: concrete gap
fix_required: exact change needed
test_required: deterministic proof needed
evidence: commands, files, or spec clause
```

A deterministic dual-signoff gate should require:

- both review files contain `VERDICT: COMPREHENSIVELY_SATISFIED`
- neither review file contains `VERDICT: FINDINGS`, `VERDICT: BLOCKED`, or an open `finding_id`
- both review files include the required pass-rationale fields
- the latest final acceptance artifact is green

## Fresh Context Implementation

Prefer an outer loop that starts a new Agent Relay workflow run per iteration:

```typescript
for (let iteration = 1; ; iteration += 1) {
  await runIteration(iteration, runStamp); // new workflow name, channel, and agent names
  if (hasDualSignoff(iteration)) {
    writeAndPostSignoffReport(iteration);
    break;
  }
}
```

Within `runIteration`, suffix workflow name, channel, and agent names with `runStamp-iteration`:

```typescript
const suffix = `${runStamp}-${iteration}`;
workflow(`my-feature-completion-${suffix}`)
  .channel(`wf-my-feature-${suffix}`)
  .agent(`claude-reviewer-${suffix}`, { cli: 'claude', preset: 'reviewer', role: 'Fresh signoff reviewer' })
  .agent(`codex-reviewer-${suffix}`, { cli: 'codex', preset: 'reviewer', role: 'Fresh signoff reviewer' });
```

This prevents reviewer memory from a previous loop from becoming the reason the loop exits.

## PR Signoff Comment

Final signoff should be both a durable artifact and a PR comment.

Resolution order:

1. explicit env var such as `SIGNOFF_PR_NUMBER`, `PR_NUMBER`, or `GITHUB_PR_NUMBER`
2. `gh pr view --json number --jq .number`
3. if no PR is available, write `PR_COMMENT_FAILED.md` and fail unless the workflow has an explicit skip env var

Use a deterministic shell or Node step:

```bash
gh pr comment "$PR_NUMBER" --body-file .workflow-artifacts/my-workflow/pr-comment.md
```

The comment body should include:

- iteration count
- final validation status and command evidence
- Claude signoff rationale
- Codex signoff rationale
- remaining risks or explicit "none"
- artifact path for full logs

## Blocked State

Do not spin forever when progress is impossible. If agents identify a true external blocker, write:

```text
.workflow-artifacts/<workflow>/iteration-N/BLOCKED_NO_COMMIT.md
```

Include exact evidence, missing credentials or services, commands that failed, and the safest retry command. Do not commit, push, or post a success comment from a blocked run.

## Common Mistakes

- Reusing the same reviewer context every loop. Start a new run or new reviewer agents for each iteration.
- Letting a reviewer write `NO_ISSUES_FOUND` without pass rationale. Require the full verdict contract.
- Treating green tests as signoff. Green deterministic gates are required evidence, not a substitute for fresh review.
- Hard-failing the first red validation gate. Capture it, repair it, then rerun.
- Posting a PR comment before both signoff agents agree on the same final state.
- Forgetting to count iterations. The final report must say how many loops it took.
