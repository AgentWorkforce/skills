#!/usr/bin/env node
// Install @relaycast/sdk beside this file, or supply RELAYCAST_SDK_MODULE.
import fs from 'node:fs';
import crypto from 'node:crypto';

const [credentialPath, queryPath] = process.argv.slice(2);
if (!credentialPath || !queryPath) {
  console.error('Usage: message-probe.mjs PRIVATE_CREDENTIAL_FILE QUERY_FILE');
  process.exit(2);
}
const stat = fs.lstatSync(credentialPath);
if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) {
  console.error('The credential file must be an owner-only regular file.');
  process.exit(2);
}
let config;
try {
  config = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
} catch {
  console.error('Cannot read a valid private credential file.');
  process.exit(2);
}
const query = JSON.parse(fs.readFileSync(queryPath, 'utf8'));
if (!query || typeof query !== 'object' || Array.isArray(query) ||
    !['round', 'expected', 'file', 'to'].every(field => typeof query[field] === 'string') ||
    !query.to.trim()) {
  throw new Error('round, expected, file, and to must be explicit strings');
}
let origin;
try {
  if (!config || typeof config.base_url !== 'string' || typeof config.token !== 'string' || !config.token) throw new Error();
  origin = new URL(config.base_url);
} catch { throw new Error('Invalid private credential configuration'); }
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.username || origin.password) {
  throw new Error('An explicit HTTPS messaging origin is required');
}
if (!/^[A-Za-z0-9_-]{1,128}$/.test(query.round) || !/^[a-f0-9]{64}$/.test(query.expected) ||
    !/^[A-Za-z0-9_./-]+$/.test(query.file) ||
    query.file.split('/').some(part => !part || ['.', '..', '.relay'].includes(part))) {
  throw new Error('Invalid challenge, file path, or expected hash');
}
const { AgentClient, HttpClient } = await import(process.env.RELAYCAST_SDK_MODULE || '@relaycast/sdk');
const agent = new AgentClient(new HttpClient({ apiKey: config.token, baseUrl: origin.origin }), { autoHeartbeatMs: false });
const started = performance.now();
const observed = [];
// The caller's label is a prefix, not replayable one-time challenge state.
const round = `${query.round}-${crypto.randomBytes(16).toString('hex')}`;
const seenReplies = new Set();
let finished = false;
let sent = false;
let sendStarted = false;
const deadline = setTimeout(() => void finish({ ok: false, error: 'Reply deadline exceeded' }), 45000);

/** Close the test identity within a bounded grace period and report the result. */
async function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  await Promise.race([agent.disconnect().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]);
  console.log(JSON.stringify({ ...result, round, request_round: query.round, observed, elapsed_ms: performance.now() - started }));
  process.exit(result.ok ? 0 : 1);
}

agent.connect();
agent.on.any(event => {
  if (finished) return;
  if (observed.length < 32) observed.push(event.type);
  if (!sendStarted) return;
  if (!['dm.received', 'thread.reply'].includes(event.type) || event.message?.agentName !== query.to) return;
  const id = event.message.id;
  if (typeof id !== 'string' || !id || seenReplies.has(id)) return;
  seenReplies.add(id);
  const matched = event.message.text?.match(new RegExp(`(?:^|\\s)ACK ${round} ([a-f0-9]{64})(?=\\s|$)`));
  if (!matched) return;
  void finish({ ok: matched[1] === query.expected, peer: query.to, message_id: event.message.id,
    event_type: event.type, sha256: matched[1], reply: event.message.text });
});
agent.on.connected(async () => {
  if (sent) return;
  sent = true;
  // Give the initial node registration a chance to settle before the request.
  await new Promise(resolve => setTimeout(resolve, 200));
  try {
    sendStarted = true;
    const response = await fetch(`${origin.origin}/v1/dm`, { method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': round },
      body: JSON.stringify({ to: query.to, text: `E2E_QUERY ${round} ${query.file}` }),
      signal: AbortSignal.timeout(15000) });
    if (!response.ok) await finish({ ok: false, error: 'DM send failed', status: response.status });
  } catch {
    await finish({ ok: false, error: 'DM transport failed' });
  }
});
