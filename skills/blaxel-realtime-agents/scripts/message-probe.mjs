#!/usr/bin/env node
// Install @relaycast/sdk beside this file, or supply RELAYCAST_SDK_MODULE.
import fs from 'node:fs';

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
const config = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
const query = JSON.parse(fs.readFileSync(queryPath, 'utf8'));
const origin = new URL(config.base_url);
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.username || origin.password) {
  throw new Error('An explicit HTTPS messaging origin is required');
}
if (!/^[A-Za-z0-9_-]{1,128}$/.test(query.round) || !/^[a-f0-9]{64}$/.test(query.expected) ||
    !/^[A-Za-z0-9_./-]+$/.test(query.file) || query.file.split('/').includes('..')) {
  throw new Error('Invalid challenge, file path, or expected hash');
}
const { AgentClient, HttpClient } = await import(process.env.RELAYCAST_SDK_MODULE || '@relaycast/sdk');
const agent = new AgentClient(new HttpClient({ apiKey: config.token, baseUrl: origin.origin }), { autoHeartbeatMs: false });
const started = performance.now();
const observed = [];
let finished = false;
let sent = false;
const deadline = setTimeout(() => void finish({ ok: false, error: 'Reply deadline exceeded' }), 45000);

async function finish(result) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  await Promise.race([agent.disconnect().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]);
  console.log(JSON.stringify({ ...result, round: query.round, observed, elapsed_ms: performance.now() - started }));
  process.exit(result.ok ? 0 : 1);
}

agent.connect();
agent.on.any(event => {
  if (observed.length < 32) observed.push(event.type);
  if (!['dm.received', 'thread.reply'].includes(event.type) || event.message?.agentName !== query.to) return;
  const matched = event.message.text?.match(new RegExp(`(?:^|\\s)ACK ${query.round} ([a-f0-9]{64})(?=\\s|$)`));
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
    const response = await fetch(`${origin.origin}/v1/dm`, { method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': query.round },
      body: JSON.stringify({ to: query.to, text: `E2E_QUERY ${query.round} ${query.file}` }),
      signal: AbortSignal.timeout(15000) });
    if (!response.ok) await finish({ ok: false, error: 'DM send failed', status: response.status });
  } catch {
    await finish({ ok: false, error: 'DM transport failed' });
  }
});
