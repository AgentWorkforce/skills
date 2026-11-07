import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const probe = fileURLToPath(new URL('../scripts/message-probe.mjs', import.meta.url));
const valid = { round: 'fresh-test-round', file: 'scratch/file', to: 'peer', expected: 'a'.repeat(64) };

/** Execute the real script with a local transport fixture and private test inputs. */
function run(query, replyHash = valid.expected, rawCredential = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'message-probe-test-'));
  try {
    const credentials = path.join(root, 'credentials.json');
    const request = path.join(root, 'request.json');
    const sdk = path.join(root, 'sdk.mjs');
    const imported = path.join(root, 'imported');
    fs.writeFileSync(credentials, rawCredential ?? JSON.stringify({ base_url: 'https://example.invalid', token: 'synthetic-fixture-value' }), { mode: 0o600 });
    fs.writeFileSync(request, JSON.stringify(query));
    fs.writeFileSync(sdk, `
      import fs from 'node:fs';
      fs.writeFileSync(${JSON.stringify(imported)}, 'yes');
      let receiver;
      export class HttpClient {}
      export class AgentClient {
        on = { any: h => { receiver = h; }, connected: h => queueMicrotask(h) };
        connect() {}
        async disconnect() {}
      }
      globalThis.fetch = async (url, options) => {
        if (url !== 'https://example.invalid/v1/dm' || options.method !== 'POST' ||
            options.headers.Authorization !== 'Bearer synthetic-fixture-value' ||
            options.headers['Content-Type'] !== 'application/json' ||
            !options.signal)
          throw new Error('Incorrect transport request');
        const data = JSON.parse(options.body);
        const round = data.text.match(/^E2E_QUERY (fresh-test-round-[a-f0-9]{32}) scratch\\/file$/)?.[1];
        if (data.to !== 'peer' || !round || options.headers['Idempotency-Key'] !== round) throw new Error('Incorrect send');
        setImmediate(() => {
          receiver({ type: 'thread.reply', message: { agentName: 'other-peer', text: 'ACK fresh-test-round ${valid.expected}' } });
          receiver({ type: 'thread.reply', message: { id: 'stale-id', agentName: 'peer', text: 'ACK fresh-test-round ${valid.expected}' } });
          receiver({ type: 'thread.reply', message: { id: 'duplicate-id', agentName: 'peer', text: 'ACK stale-round ${valid.expected}' } });
          receiver({ type: 'thread.reply', message: { id: 'duplicate-id', agentName: 'peer', text: 'ACK ' + round + ' ${valid.expected}' } });
          receiver({ type: 'thread.reply', message: { id: 'reply-id', agentName: 'peer', text: 'ACK ' + round + ' ${replyHash}' } });
        });
        return { ok: true };
      };
    `);
    const result = spawnSync(process.execPath, [probe, credentials, request], {
      env: { ...process.env, RELAYCAST_SDK_MODULE: pathToFileURL(sdk).href }, encoding: 'utf8', timeout: 5000,
    });
    return { ...result, imported: fs.existsSync(imported) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('missing and non-string fields fail before SDK import or network work', () => {
  for (const key of ['round', 'file', 'expected', 'to']) {
    for (const value of [undefined, null, 42, true, {}]) {
      const query = { ...valid, [key]: value };
      const result = run(query);
      assert.notEqual(result.status, 0, `${key}: ${value}`);
      assert.equal(result.imported, false);
      assert.match(result.stderr, /must be explicit strings/);
    }
  }
});

test('empty recipients fail before SDK import or network work', () => {
  for (const to of ['', '  ']) {
    const result = run({ ...valid, to });
    assert.notEqual(result.status, 0);
    assert.equal(result.imported, false);
    assert.match(result.stderr, /must be explicit strings/);
  }
});

test('valid strings require matching peer, fresh round and hash', () => {
  const result = run(valid);
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true);
  assert.equal(response.message_id, 'reply-id');
  assert.equal(response.sha256, valid.expected);
});

test('a correlated reply containing the wrong file hash fails', () => {
  const result = run(valid, 'b'.repeat(64));
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, false);
});

test('absolute, runtime, empty and traversal path components fail before transport import', () => {
  for (const file of ['/etc/passwd', '.relay/state', 'a/.relay/state', 'a//b', './file', '../file', 'file/']) {
    const result = run({...valid, file});
    assert.notEqual(result.status, 0, file);
    assert.equal(result.imported, false);
  }
});

test('malformed private JSON never echoes credential fragments', () => {
  const marker = 'SENSITIVE_TEST_MARKER_12345';
  const result = run(valid, valid.expected, '{"token":"' + marker + '" broken');
  assert.equal(result.status, 2);
  assert.equal(result.imported, false);
  assert.match(result.stderr, /valid private credential/);
  assert.ok(!result.stderr.includes(marker));
});

test('reusing a caller label still generates a different one-time challenge', () => {
  const a = JSON.parse(run(valid).stdout);
  const b = JSON.parse(run(valid).stdout);
  assert.notEqual(a.round, b.round);
  assert.equal(a.request_round, valid.round);
});
