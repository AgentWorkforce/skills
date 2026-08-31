/**
 * Proof: GitHub integration steps CAN run locally, if you supply an executor.
 *
 * The runner's guard is `if (!this.executor?.executeIntegrationStep) throw`.
 * GitHubStepExecutor already implements executeIntegrationStep, so handing it
 * to the runner satisfies the guard. Deterministic steps still run locally
 * because we omit executeDeterministicStep (runner.js: `if
 * (this.executor?.executeDeterministicStep) ... else <local>`).
 *
 * Caveat this proves the shape of: setting `executor` ALSO routes agent steps
 * through it, and GitHubStepExecutor.executeAgentStep() throws. So this pattern
 * is only valid for workflows with NO agent steps.
 */
import { workflow, WorkflowRunner } from '@relayflows/core';
import { createGitHubStep, GitHubStepExecutor } from '@relayflows/core/integrations/github';
import type { RelayYamlConfig, WorkflowStep } from '@relayflows/core';

const REPO = 'AgentWorkforce/cloud-e2e-sandbox';

const config: RelayYamlConfig = workflow('gh-local')
  .description('Integration steps executed locally via GitHubStepExecutor')
  .pattern('dag')
  .agent('unused', { cli: 'claude' })       // agents[] must be non-empty
  .step('report', {
    type: 'deterministic',
    dependsOn: ['list-issues'],
    command: `echo "open ship issues: {{steps.list-issues.output}}"`,
    verification: { type: 'output_contains', value: 'open ship issues:', description: 'integration output flowed downstream' },
  })
  .toConfig();

const steps: WorkflowStep[] = config.workflows![0].steps;
steps.unshift(createGitHubStep({
  name: 'list-issues',
  action: 'listIssues',
  repo: REPO,
  params: { state: 'open', labels: 'ship', perPage: 1 },
  output: { mode: 'data', format: 'json', path: '0.number' },
}));

const row = await new WorkflowRunner({
  cwd: process.cwd(),
  executor: new GitHubStepExecutor({ runtime: 'local' }),
}).execute(config);

console.log(`status=${row.status} run=${row.id}`);
if (row.error) console.log('ERROR:', row.error);
if (row.status !== 'completed') process.exitCode = 1;
