# Verified examples

Every claim in these files was checked against the published packages on
**2026-08-31**, against `@relayflows/core@1.1.0`, `@relayflows/cli@1.1.0`,
`@agent-relay/sdk@11.8.7`, `agent-relay` CLI `11.8.7`.

## Which file to read

| File | What it proves | Status |
|---|---|---|
| `ship-issue.local.ts` | Agent step + deterministic `gh` steps + `pr_url` gate | **Ran green end-to-end.** 3/3 steps, opened a real PR |
| `github-steps.local.ts` | `createGitHubStep` executing locally via an injected `GitHubStepExecutor` | **Ran green end-to-end.** 2/2 steps, live GitHub call |
| `integration-steps-need-an-executor.ts` | That a `createGitHubStep` step fails against the cloud executor's exact interface shape | **Ran, reproduces the failure** |

## The corrections these examples encode

1. **`@agent-relay/sdk/workflows` does not exist.** `@agent-relay/sdk@11.8.7`
   exports only `.`, `./actions`, `./session`, `./delivery`, `./messaging`,
   `./capabilities`. Importing the subpath throws
   `ERR_PACKAGE_PATH_NOT_EXPORTED`. Use `@relayflows/core`.

2. **`createGitHubStep` is not in `@agent-relay/sdk`.** It lives in
   `@relayflows/core/integrations/github`.

3. **There is no `agent-relay run`.** The local runner is a separate binary,
   `relayflows run` (`@relayflows/cli`), and it is the one that has `--dry-run`.
   `agent-relay cloud run` has no `--dry-run`.

4. **`WorkflowBuilder.step()` rejects integration steps.** It handles agent /
   `deterministic` / `worktree` only; a `createGitHubStep()` result is
   `type: 'integration'` and throws `Agent steps must have both agent and task`.
   Splice it into `config.workflows[0].steps` after `.toConfig()`.

5. **Integration steps need an executor, and cloud does not supply one.** The
   runner throws `Integration steps require a cloud executor` — the real guard
   is `!this.executor?.executeIntegrationStep`. That error's advice is wrong:
   the cloud executor does not implement the method either.
   `cloud/packages/core/src/executor/executor.ts` (`SandboxedStepExecutor`,
   exported as `DaytonaStepExecutor`) implements exactly `executeAgentStep` and
   `executeDeterministicStep`, and
   `cloud/packages/core/src/bootstrap/templates/bootstrap-inner.mjs` hands that
   object straight to `new WorkflowRunner({ executor, ... })`. Grepping the
   whole cloud repo for `executeIntegrationStep` returns no implementation.
   `integration-steps-need-an-executor.ts` reproduces the failure against that
   exact interface shape.

   The only executor that does implement it is `GitHubStepExecutor`. Injecting
   it locally works (`github-steps.local.ts`) — **but** setting `executor` also
   routes *agent* steps through it, and `GitHubStepExecutor.executeAgentStep()`
   throws. So today: GitHub steps run locally in a workflow with no agent steps,
   and nowhere else. For a workflow that needs both, use deterministic `gh`
   steps — `ship-issue.local.ts`.

6. **The `createPR` output has no URL field.** Verified live — the mapped
   `PullRequest` top-level keys are `number, id, title, body, user, state,
   draft, locked, mergeable, mergeableState, merged, base, head,
   requestedReviewers, labels, commentsCount, reviewCommentsCount, commitsCount,
   additionsCount, deletionsCount, changedFilesCount, createdAt, updatedAt`.
   `html_url` is `undefined`. Capture `path: 'number'` and reconstruct the URL.

7. **Verification runs in the runner's cwd**, never the step's or agent's
   (`runVerification(..., { cwd: this.cwd })`). Pass
   `new WorkflowRunner({ cwd: WORKDIR })` or `git`-based checks inspect the
   wrong tree — this failed a correct run during verification.

8. **There is no `getIssue` action.** The enum is exactly 22 values
   (`GITHUB_ACTIONS` from `@relayflows/github-primitive`); read a single issue
   via `listIssues`.

## Reproducing

```bash
npm i @relayflows/core@1.1.0 @relayflows/cli@1.1.0 @agent-relay/sdk@11.8.7
# package.json needs "type": "module"

# 1. subpath is gone
node --input-type=module -e "await import('@agent-relay/sdk/workflows')"
#    → ERR_PACKAGE_PATH_NOT_EXPORTED

# 2. no `run` subcommand; relayflows has --dry-run
agent-relay --help | grep -c '^  run'      # → 0
relayflows run --help | grep -- --dry-run  # → present

# 3. the action enum
node --input-type=module -e "
  const { GITHUB_ACTIONS } = await import('@relayflows/github-primitive');
  console.log(GITHUB_ACTIONS.length, GITHUB_ACTIONS.join(', '))"
```

The two local examples need a `ship`-labelled open issue in the target repo and
a git checkout to work in:

```bash
export SHIP_ISSUE_REPO=AgentWorkforce/cloud-e2e-sandbox
export SHIP_ISSUE_CWD=/path/to/checkout
npx tsx ship-issue.local.ts
npx tsx github-steps.local.ts
```

## On cloud runs

Two separate things were found, and they compound:

1. **The cloud executor cannot run integration steps** — established from the
   cloud source (above) and reproduced by
   `integration-steps-need-an-executor.ts`. This is why no
   `ship-issue.cloud.ts` ships here: a `createGitHubStep` workflow submitted to
   cloud would fail the same way, so publishing one as "the cloud pattern"
   would be publishing something that does not work.

2. **Cloud dispatch did not fire at all** on 2026-08-31. Two submissions
   (`026852ad-fe47-4c8a-a28c-fdc7267b5bdf`,
   `cbe13ab4-a273-4997-9602-cd53fc3d546e`) were accepted and then sat at
   `status: pending` / `sandboxId: null` indefinitely — no sandbox, no logs.
   `agent-relay cloud run` has no `--runtime` flag, so every CLI submission
   takes the Daytona sandbox path. That is an environment/capacity problem,
   independent of (1).

So a green end-to-end cloud run of a GitHub-integration workflow was **not**
achieved, and per (1) is not currently achievable. If `executeIntegrationStep`
lands on the cloud executor, add a cloud example and update this section.
