/**
 * Faithful simulation of the CLOUD executor's interface surface.
 * cloud/packages/core/src/executor/executor.ts (SandboxedStepExecutor, exported
 * as DaytonaStepExecutor) implements exactly two methods: executeAgentStep and
 * executeDeterministicStep. It has NO executeIntegrationStep.
 * cloud/packages/core/src/bootstrap/templates/bootstrap-inner.mjs then does
 *   new WorkflowRunner({ executor, processBackend: executor, ... })
 * So this is the shape a createGitHubStep step actually meets in cloud.
 */
import { workflow, WorkflowRunner } from '@relayflows/core';
import { createGitHubStep } from '@relayflows/core/integrations/github';

const cloudLikeExecutor = {
  async executeAgentStep() { return 'stub agent output'; },
  async executeDeterministicStep() { return { output: 'stub', exitCode: 0 }; },
  // NOTE: no executeIntegrationStep — matching SandboxedStepExecutor exactly.
};

const config = workflow('cloud-shape')
  .agent('worker', { cli: 'claude' })
  .step('after', { agent: 'worker', dependsOn: ['gh'], task: 'noop' })
  .toConfig();

config.workflows![0].steps.unshift(createGitHubStep({
  name: 'gh', action: 'listIssues', repo: 'AgentWorkforce/cloud-e2e-sandbox',
  params: { state: 'open', perPage: 1 },
}));

const row = await new WorkflowRunner({ executor: cloudLikeExecutor as any }).execute(config);
// Verified 2026-08-31:
//   status: failed
//   error : Step "gh" failed: Integration steps require a cloud executor.
console.log('status:', row.status);
console.log('error :', row.error);
