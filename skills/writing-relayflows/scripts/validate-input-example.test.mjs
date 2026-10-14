import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Execute the actual documentation body so a stale copied implementation cannot
// hide a regression. Neither the SDK nor a provider/model is invoked.
const skill = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');
const body = /export default flow<Input>\('summarize', async \(f, inputs\) => \{([\s\S]*?)^\}\);/mu.exec(skill)?.[1];
assert.ok(body, 'The documented summarize Flow callback must exist');
const invoke = runInNewContext(`(async (f, inputs) => {${body}})`, {
  console: { log() {} },
});

async function exercise(inputs) {
  const completions = [];
  const modelCalls = [];
  await invoke({
    done(reason) { completions.push(reason); },
    async llm(strings, ...values) {
      modelCalls.push({ strings: Array.from(strings), values });
      return 'A summary';
    },
  }, inputs);
  return { completions, modelCalls };
}

const invalidCases = [
  ['missing inputs', undefined],
  ['null inputs', null],
  ['boolean inputs', false],
  ['number inputs', 42],
  ['string inputs', 'task'],
  ['array inputs', Object.assign([], { task: 'task' })],
  ['missing task', {}],
  ['undefined task', { task: undefined }],
  ['null task', { task: null }],
  ['boolean task', { task: false }],
  ['number task', { task: 42 }],
  ['array task', { task: ['task'] }],
  ['object task', { task: { trim() { throw new Error('Must not call trim'); } } }],
  ['empty task', { task: '' }],
  ['whitespace task', { task: ' \t\n ' }],
];

for (const [name, inputs] of invalidCases) {
  test(`${name} declines without calling the model`, async () => {
    assert.deepEqual(await exercise(inputs), { completions: ['declined'], modelCalls: [] });
  });
}

for (const task of ['Review the change', ' \tReview the change\n ']) {
  test(`valid task ${JSON.stringify(task)} invokes the model once and succeeds`, async () => {
    const result = await exercise({ task });
    assert.deepEqual(result.completions, ['success']);
    assert.equal(result.modelCalls.length, 1);
    assert.deepEqual(result.modelCalls[0].values, [task.trim()]);
  });
}
