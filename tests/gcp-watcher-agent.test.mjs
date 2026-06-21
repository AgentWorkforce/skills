import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { envelopeToAgentEvent } from '@agentworkforce/runtime';
import { parseIntegrations } from '@agentworkforce/persona-kit';

import agent, { evaluateSignals, type GcpService, type GcpAlert, type GcpBilling } from '../.test-build/gcp-watcher/agent.js';
import persona from '../.test-build/gcp-watcher/persona.js';

const FIXED_NOW = Date.parse('2026-06-17T12:00:00.000Z');

// ── helpers ───────────────────────────────────────────────────────────────────

function cronEvent() {
  return envelopeToAgentEvent({
    id: 'evt-gcp-scan',
    workspace: 'ws-test',
    type: 'cron.tick',
    occurredAt: new Date(FIXED_NOW).toISOString(),
    name: 'gcp-scan',
    cron: '0 * * * *',
  });
}

function monitoringWebhookEvent(payload, type = 'gcp.monitoring.incident.open') {
  return envelopeToAgentEvent({
    id: 'evt-mon-webhook',
    workspace: 'ws-test',
    type,
    provider: 'gcp',
    occurredAt: new Date(FIXED_NOW).toISOString(),
    paths: ['/gcp/monitoring/alerts/_index.json'],
    resource: payload,
  });
}

function relaycastMessageEvent(text) {
  return envelopeToAgentEvent({
    id: 'evt-relaycast',
    workspace: 'ws-test',
    type: 'relaycast.message',
    occurredAt: new Date(FIXED_NOW).toISOString(),
    data: { text },
  });
}

function ctx(memorySaves, inputs = {}, memoryRecallResult) {
  return {
    persona: {
      inputs: {
        SLACK_CHANNEL: 'C-gcp-alerts',
        GCP_PROJECT_ID: 'nightcto-production',
        BILLING_ALERT_USD: '500',
        ...inputs,
      },
      inputSpecs: {},
    },
    memory: {
      recall: async () =>
        memoryRecallResult ?? [
          { content: JSON.stringify({ signature: ':old-signature:' }) },
        ],
      save: async (content, opts) => {
        memorySaves.push({ content, opts });
        return { id: 'snapshot-1' };
      },
    },
    llm: {
      complete: async (prompt, opts) => 'Mock LLM answer about GCP state.',
    },
    log: () => {},
  };
}

/**
 * Seed the VFS mount with GCP adapter materialized data and return the mount
 * root. The caller provides partial data; missing files are simply absent
 * (simulating a pre-rollout mount or empty tree).
 */
async function seedGcpMount(overrides = {}) {
  const mountRoot = await mkdtemp(path.join(os.tmpdir(), 'gcp-watcher-mount-'));
  const defaults = {
    'gcp/run/services/_index.json': JSON.stringify([
      { name: 'api-service', region: 'us-central1', ready: true },
      { name: 'worker', region: 'europe-west1', ready: false, latestRevision: 'rev-42' },
    ]),
    'gcp/monitoring/alerts/_index.json': JSON.stringify([
      { policyId: 'pol-cpu', displayName: 'High CPU', firing: true, conditionName: 'CPU > 80%' },
      { policyId: 'pol-latency', displayName: 'High Latency', firing: false },
    ]),
    'gcp/billing/current.json': JSON.stringify({
      billingAccountId: 'billing-1',
      currency: 'USD',
      amount: 420,
    }),
  };
  const files = { ...defaults, ...overrides };
  for (const [file, content] of Object.entries(files)) {
    const abs = path.join(mountRoot, file);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return mountRoot;
}

async function answerSlackWriteback(mountRoot) {
  const dir = path.join(mountRoot, 'slack/channels/C-gcp-alerts/messages');
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const files = await readdir(dir).catch(() => []);
    const draft = files.find((file) => file.endsWith('.json'));
    if (draft) {
      const draftPath = path.join(dir, draft);
      const payload = JSON.parse(await readFile(draftPath, 'utf8'));
      await writeFile(draftPath, JSON.stringify({ created: '1700000000.000001' }), 'utf8');
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Slack draft was not written');
}

// ── evaluateSignals — pure, no-IO unit tests ──────────────────────────────────

test('evaluateSignals produces no alerts when everything is healthy', () => {
  const services = [{ name: 'api', region: 'us-central1', ready: true }];
  const alerts = [{ policyId: 'pol-ok', displayName: 'OK Policy', firing: false }];
  const billing = { amount: 200, currency: 'USD' };

  const result = evaluateSignals(services, alerts, billing, { billingAlertUsd: 500 });
  assert.deepEqual(result.alerts, []);
});

test('evaluateSignals alerts on Cloud Run service not ready', () => {
  const services = [
    { name: 'worker', region: 'europe-west1', ready: false, latestRevision: 'rev-42' },
  ];
  const result = evaluateSignals(services, [], undefined, { billingAlertUsd: 500 });
  assert.equal(result.alerts.length, 1);
  assert.match(result.alerts[0], /Cloud Run not ready.*worker.*europe-west1.*rev-42/);
});

test('evaluateSignals alerts on firing monitoring policy', () => {
  const alerts = [
    { policyId: 'pol-cpu', displayName: 'High CPU', firing: true, conditionName: 'CPU > 80%' },
  ];
  const result = evaluateSignals([], alerts, undefined, { billingAlertUsd: 500 });
  assert.equal(result.alerts.length, 1);
  assert.match(result.alerts[0], /Alert firing.*High CPU.*CPU > 80%/);
});

test('evaluateSignals alerts on spend over threshold', () => {
  const billing = { amount: 600, currency: 'USD' };
  const result = evaluateSignals([], [], billing, { billingAlertUsd: 500 });
  assert.equal(result.alerts.length, 1);
  assert.match(result.alerts[0], /Spend.*USD.*600.*500/);
});

test('evaluateSignals does not alert on spend under threshold', () => {
  const billing = { amount: 400, currency: 'USD' };
  const result = evaluateSignals([], [], billing, { billingAlertUsd: 500 });
  assert.deepEqual(result.alerts, []);
});

test('evaluateSignals combines multiple signals into one alert list', () => {
  const services = [
    { name: 'worker', region: 'us-east1', ready: false },
    { name: 'healthy', region: 'us-east1', ready: true },
  ];
  const alerts = [
    { policyId: 'pol-oom', displayName: 'OOM', firing: true },
    { policyId: 'pol-ok', displayName: 'OK', firing: false },
  ];
  const billing = { amount: 900, currency: 'USD' };

  const result = evaluateSignals(services, alerts, billing, { billingAlertUsd: 500 });
  assert.equal(result.alerts.length, 3);
  assert.match(result.alerts.join('\n'), /Cloud Run not ready.*worker/);
  assert.match(result.alerts.join('\n'), /Alert firing.*OOM/);
  assert.match(result.alerts.join('\n'), /Spend.*USD.*900.*500/);
});

test('evaluateSignals handles empty services and alerts gracefully', () => {
  const result = evaluateSignals([], [], undefined, { billingAlertUsd: 500 });
  assert.deepEqual(result.alerts, []);
});

test('evaluateSignals handles undefined billing gracefully', () => {
  const result = evaluateSignals([], [], undefined, { billingAlertUsd: 500 });
  assert.deepEqual(result.alerts, []);
});

// ── cron dry-run: full scan from VFS mounts ───────────────────────────────────

test('cron dry-run reads GCP VFS mounts, evaluates signals, and posts one Slack alert', async (t) => {
  const mountRoot = await seedGcpMount();
  const memorySaves = [];

  const oldMountRoot = process.env.RELAYFILE_MOUNT_ROOT;
  const oldSlackChannel = process.env.SLACK_CHANNEL;

  try {
    process.env.RELAYFILE_MOUNT_ROOT = mountRoot;
    process.env.SLACK_CHANNEL = 'C-gcp-alerts';

    const slackPayloadPromise = answerSlackWriteback(mountRoot);
    await agent.handler(ctx(memorySaves), cronEvent());
    const slackPayload = await slackPayloadPromise;

    assert.match(slackPayload.text, /Cloud Run not ready.*worker.*europe-west1.*rev-42/);
    assert.match(slackPayload.text, /Alert firing.*High CPU.*CPU > 80%/);
    assert.match(slackPayload.text, /Spend.*USD.*420.*500/);

    assert.equal(memorySaves.length, 1);
    assert.deepEqual(memorySaves[0].opts, {
      tags: ['gcp-watcher:snapshot'],
      scope: 'workspace',
    });
  } finally {
    if (oldMountRoot === undefined) delete process.env.RELAYFILE_MOUNT_ROOT;
    else process.env.RELAYFILE_MOUNT_ROOT = oldMountRoot;
    if (oldSlackChannel === undefined) delete process.env.SLACK_CHANNEL;
    else process.env.SLACK_CHANNEL = oldSlackChannel;
  }
});

test('cron dry-run stays silent when nothing has changed (dedup via snapshot)', async (t) => {
  const mountRoot = await seedGcpMount();
  const memorySaves = [];

  const oldMountRoot = process.env.RELAYFILE_MOUNT_ROOT;
  const oldSlackChannel = process.env.SLACK_CHANNEL;

  try {
    process.env.RELAYFILE_MOUNT_ROOT = mountRoot;
    process.env.SLACK_CHANNEL = 'C-gcp-alerts';

    // Seed memory with the same signature the scan would produce
    const currentSignature = [
      ':rotating_light: *Cloud Run not ready* `worker @ europe-west1` (rev rev-42)',
      ':warning: *Alert firing* `High CPU` — CPU > 80%',
      ':moneybag: *Spend* USD *420* (>= 500)',
    ].sort().join('\n');

    const recallResult = [{ content: JSON.stringify({ signature: currentSignature }) }];

    await agent.handler(ctx(memorySaves, {}, recallResult), cronEvent());

    // No Slack draft should have been written
    const dir = path.join(mountRoot, 'slack/channels/C-gcp-alerts/messages');
    const drafts = await readdir(dir).catch(() => []);
    assert.deepEqual(drafts, [], 'expected no Slack draft when signature matches');

    // Snapshot is still updated (saved with the same signature)
    assert.equal(memorySaves.length, 1);
    const saved = JSON.parse(memorySaves[0].content);
    assert.equal(saved.signature, currentSignature);
  } finally {
    if (oldMountRoot === undefined) delete process.env.RELAYFILE_MOUNT_ROOT;
    else process.env.RELAYFILE_MOUNT_ROOT = oldMountRoot;
    if (oldSlackChannel === undefined) delete process.env.SLACK_CHANNEL;
    else process.env.SLACK_CHANNEL = oldSlackChannel;
  }
});

test('cron dry-run stays silent when no signal is firing', async (t) => {
  const mountRoot = await seedGcpMount({
    // All services healthy
    'gcp/run/services/_index.json': JSON.stringify([
      { name: 'api', region: 'us-central1', ready: true },
    ]),
    // No firing alerts
    'gcp/monitoring/alerts/_index.json': JSON.stringify([
      { policyId: 'pol-ok', displayName: 'All Good', firing: false },
    ]),
    // Spend under threshold
    'gcp/billing/current.json': JSON.stringify({ amount: 100, currency: 'USD' }),
  });
  const memorySaves = [];

  const oldMountRoot = process.env.RELAYFILE_MOUNT_ROOT;
  const oldSlackChannel = process.env.SLACK_CHANNEL;

  try {
    process.env.RELAYFILE_MOUNT_ROOT = mountRoot;
    process.env.SLACK_CHANNEL = 'C-gcp-alerts';

    await agent.handler(ctx(memorySaves), cronEvent());

    // No Slack draft
    const dir = path.join(mountRoot, 'slack/channels/C-gcp-alerts/messages');
    const drafts = await readdir(dir).catch(() => []);
    assert.deepEqual(drafts, [], 'expected no Slack draft when no signal is firing');

    // Snapshot saved with empty signature
    assert.equal(memorySaves.length, 1);
    assert.equal(JSON.parse(memorySaves[0].content).signature, '');
  } finally {
    if (oldMountRoot === undefined) delete process.env.RELAYFILE_MOUNT_ROOT;
    else process.env.RELAYFILE_MOUNT_ROOT = oldMountRoot;
    if (oldSlackChannel === undefined) delete process.env.SLACK_CHANNEL;
    else process.env.SLACK_CHANNEL = oldSlackChannel;
  }
});

test('cron dry-run degrades gracefully when VFS is empty (gcp-relay not yet live)', async (t) => {
  const mountRoot = await mkdtemp(path.join(os.tmpdir(), 'gcp-watcher-empty-'));
  const memorySaves = [];

  const oldMountRoot = process.env.RELAYFILE_MOUNT_ROOT;
  const oldSlackChannel = process.env.SLACK_CHANNEL;

  try {
    process.env.RELAYFILE_MOUNT_ROOT = mountRoot;
    process.env.SLACK_CHANNEL = 'C-gcp-alerts';

    await agent.handler(ctx(memorySaves), cronEvent());

    // No Slack draft when mount is empty
    const dir = path.join(mountRoot, 'slack/channels/C-gcp-alerts/messages');
    const drafts = await readdir(dir).catch(() => []);
    assert.deepEqual(drafts, [], 'expected no Slack draft for empty mount');
    assert.equal(JSON.parse(memorySaves[0].content).signature, '');
  } finally {
    if (oldMountRoot === undefined) delete process.env.RELAYFILE_MOUNT_ROOT;
    else process.env.RELAYFILE_MOUNT_ROOT = oldMountRoot;
    if (oldSlackChannel === undefined) delete process.env.SLACK_CHANNEL;
    else process.env.SLACK_CHANNEL = oldSlackChannel;
  }
});

// ── real-time webhook path ────────────────────────────────────────────────────

test('webhook routes to handleScan (same dedup as cron) when monitoring.incident.open fires', async (t) => {
  const mountRoot = await seedGcpMount();
  const memorySaves = [];

  const oldMountRoot = process.env.RELAYFILE_MOUNT_ROOT;
  const oldSlackChannel = process.env.SLACK_CHANNEL;
  const oldEventType = process.env.GCP_EVENT_TYPE;

  try {
    process.env.RELAYFILE_MOUNT_ROOT = mountRoot;
    process.env.SLACK_CHANNEL = 'C-gcp-alerts';

    const slackPayloadPromise = answerSlackWriteback(mountRoot);
    await agent.handler(ctx(memorySaves), monitoringWebhookEvent({}));
    const slackPayload = await slackPayloadPromise;

    // Same full-scan output (all three signals from the seeded mount)
    assert.match(slackPayload.text, /Cloud Run not ready.*worker/);
    assert.match(slackPayload.text, /Alert firing.*High CPU/);
    assert.match(slackPayload.text, /Spend.*USD.*420.*500/);

    // Snapshot saved (same path as cron)
    assert.equal(memorySaves.length, 1);
    assert.deepEqual(memorySaves[0].opts, {
      tags: ['gcp-watcher:snapshot'],
      scope: 'workspace',
    });
  } finally {
    if (oldMountRoot === undefined) delete process.env.RELAYFILE_MOUNT_ROOT;
    else process.env.RELAYFILE_MOUNT_ROOT = oldMountRoot;
    if (oldSlackChannel === undefined) delete process.env.SLACK_CHANNEL;
    else process.env.SLACK_CHANNEL = oldSlackChannel;
    if (oldEventType === undefined) delete process.env.GCP_EVENT_TYPE;
    else process.env.GCP_EVENT_TYPE = oldEventType;
  }
});

// ── trigger/schedule declarations ────────────────────────────────────────────

test('declares gcp triggers and hourly schedule', () => {
  const ons = (agent.triggers?.gcp ?? []).map((t) => t.on);
  assert.deepEqual(ons, ['monitoring.incident.open', 'monitoring.incident.closed']);
  assert.deepEqual(
    (agent.schedules ?? []).map((s) => s.name),
    ['gcp-scan'],
  );
});

// ── config-invariant pin (creating-cloud-persona §1/§6) ───────────────────────

test('gcp integration scope mounts the subtrees readCollection depends on', () => {
  const parsed = parseIntegrations(
    persona.default?.integrations ?? persona.integrations ?? {},
    'gcp-watcher.integrations',
  ) ?? {};
  const scope = parsed.gcp?.scope ?? {};
  assert.equal(scope.run, '/gcp/run/**', 'run subtree must be scoped so VFS reads are mounted');
  assert.equal(scope.monitoring, '/gcp/monitoring/**', 'monitoring subtree must be scoped');
  assert.equal(scope.billing, '/gcp/billing/**', 'billing subtree must be scoped');
});

test('slack integration has a non-empty scope for writeback delivery (scope trap §1)', () => {
  const parsed = parseIntegrations(
    persona.default?.integrations ?? persona.integrations ?? {},
    'gcp-watcher.integrations',
  ) ?? {};
  const scope = parsed.slack?.scope ?? {};
  assert.equal(scope.paths, '/slack/channels/**', 'slack scope must cover /slack/channels/**');
  // Without this scope, slackClient().post() writes to unmounted disk and
  // returns ts:'' silently — the scope trap from creating-cloud-persona §1.
});
