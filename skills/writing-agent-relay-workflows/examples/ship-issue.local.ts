/**
 * ship-issue (local variant) — agent steps + `gh` deterministic steps.
 *
 * Integration steps (createGitHubStep) cannot run in a workflow that also has
 * agent steps: the runner throws "Integration steps require a cloud executor",
 * and supplying `executor` to satisfy it hijacks agent steps as well — and the
 * cloud executor does not implement executeIntegrationStep either. So any
 * workflow that mixes agent work with GitHub work uses deterministic `gh`
 * steps. See integration-steps-need-an-executor.ts.
 */
import { workflow, WorkflowRunner } from '@relayflows/core';
import { assertBranch, assertRepo } from './assert-repo.js';

// REPO is interpolated into `gh` shell commands, so it is validated rather
// than trusted — an unvalidated env var here is a command-injection hole.
const REPO = assertRepo(process.env.SHIP_ISSUE_REPO ?? 'AgentWorkforce/cloud-e2e-sandbox');
const BRANCH = assertBranch(process.env.SHIP_ISSUE_BRANCH ?? `agent/ship-issue-${Date.now()}`);
const WORKDIR = process.env.SHIP_ISSUE_CWD ?? process.cwd();

const config = workflow('ship-issue-local')
  .description('Local variant: gh CLI instead of integration steps')
  .pattern('dag')
  .agent('worker', { cli: 'claude', preset: 'worker', cwd: WORKDIR })
  .step('find-issue', {
    type: 'deterministic',
    cwd: WORKDIR,
    command: `gh issue list --repo ${REPO} --label ship --state open --limit 1 --json number,title,body`,
  })
  .step('implement', {
    agent: 'worker',
    dependsOn: ['find-issue'],
    timeoutMs: 10 * 60_000,
    task: [
      'Open issues (JSON): {{steps.find-issue.output}}',
      'Implement the FIRST issue in that list in the current git checkout.',
      'Then run this exact one-line sequence (safe to re-run on a retry):',
      `git checkout -B ${BRANCH} && git add -A && { git diff --cached --quiet || git commit -m "feat: address issue"; } && git push -u origin ${BRANCH}`,
      'The branch MUST be pushed before you finish.',
    ].join('\n'),
    verification: {
      type: 'custom',
      value: `git ls-remote --exit-code --heads origin ${BRANCH}`,
      description: 'branch was actually pushed',
    },
  })
  .step('open-pr', {
    type: 'deterministic',
    dependsOn: ['implement'],
    cwd: WORKDIR,
    command: `gh pr create --repo ${REPO} --head ${BRANCH} --base main --title "feat: ship labelled issue" --body "Automated by ship-issue-local."`,
    verification: { type: 'pr_url', value: REPO, description: 'a real PR exists' },
  })
  .onError('retry', { maxRetries: 1 })
  .toConfig();

// `cwd` MUST be set on the runner: verification checks run in the runner's cwd
// (runner.js runVerification -> `{ ...options, cwd: this.cwd }`), NOT the step's
// `cwd`. Omitting it ran `git ls-remote origin` outside any git checkout.
const runner = new WorkflowRunner({ cwd: WORKDIR });

// `process.env.DRY_RUN` is a string, so a bare truthiness check sends
// DRY_RUN=false and DRY_RUN=0 down the dry-run path and exits 0 without ever
// running the workflow. Parse it.
const dryRun = /^(1|true|yes)$/i.test(process.env.DRY_RUN?.trim() ?? '');

if (dryRun) {
  // A DryRunReport is NOT a WorkflowRunRow: it has no `status` field, so the
  // usual `status !== 'completed'` guard is true on a PASSING dry run and exits
  // 1. Branch on `valid`.
  const report = await runner.dryRun(config);
  console.log(`valid=${report.valid} steps=${report.totalSteps} waves=${report.estimatedWaves}`);
  if (!report.valid) {
    console.error(report.errors);
    process.exitCode = 1;
  }
} else {
  const row = await runner.execute(config);
  console.log(`status=${row.status} run=${row.id}`);
  if (row.error) console.log('ERROR:', row.error);
  if (row.status !== 'completed') process.exitCode = 1;
}
