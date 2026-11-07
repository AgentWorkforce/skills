---
name: blaxel-realtime-agents
description: Connect agents in Blaxel sandboxes using Relayfile filesystem mirrors and Agent Relay's native probe; verify file convergence, session delivery, and replies across independent machines.
---

# Blaxel agents with shared files and live messaging

Give each sandbox its own local filesystem mirror and native Agent Relay probe.
Relayfile distributes file changes; Agent Relay delivers messages into running
coding sessions. They use separate services, workspaces, and credentials.

Use the official `blaxel-cli` and `blaxel-sdk` skills when installed. Start docs
discovery at <https://docs.blaxel.ai/llms.txt>; fetch individual pages as needed.

## Scope and authorization

Honor the user's chosen workspace and existing authorization. Bootstrap alone
does not authorize resources, project edits, credentials, provider writes, or
cleanup. A concrete integration task authorizes necessary nonproduction work
within its stated boundaries; honor any separately reserved approvals.

Use securely supplied environment variables or existing sign-in. Never ask for
secrets in chat, print tokens, or put credentials in the shared tree, source,
command arguments, evidence, or agent configuration. A supervised runtime's
private credential file is appropriate only when its creation is authorized.

Qualification uses disposable services and test files. Do not attach test
agents to production messaging or copy the person's model login to a sandbox.
Record the exact resources this session creates. Clean up those names
individually, following the official Blaxel deletion rules.

## Bootstrap and choose an image

Inspect the working directory, git state, relevant sibling projects, and
available sign-in without changing source files. Install and verify:

```sh
npx -y skills add blaxel-ai/agent-skills -g --all
npx -y skills list -g --json
curl -fsSL https://blaxel.ai/install.sh -o /tmp/blaxel-install.sh
# Review this downloaded script before executing it.
less /tmp/blaxel-install.sh
sh /tmp/blaxel-install.sh
bl version
bl --help
bl workspaces --current
bl get sandboxes
```

The installer may already run setup. Otherwise use `bl setup` in a terminal or
`bl setup --yes` without one. If account access fails, run `bl login`, open its
secure device flow, and continue after browser approval. A configured workspace
name alone does not prove account access. Do not create a workspace or API key
to work around a login failure.

For an agent, read the downloaded script with its file-reading tool in place
of `less`, then execute that same reviewed file. The installer verifies the
downloaded executable against release checksums; that does not independently
authenticate the installer script itself.

Use a **glibc Linux image**, such as `blaxel/ts-app:latest`, for the published
Linux probe. The default `blaxel/base-image:latest` is Alpine/musl: the probe
failed there with missing `fcntl64` and `__res_init`, including with `gcompat`.
Probe the actual image and executable; tags and bundled runtimes change.
A static Go Relayfile mount works on either.

Give disposable sandboxes an explicit expiration policy. The verified manifest
uses `type: ttl-max-age`, `value: 2h`, `action: delete`. Use YAML filenames with
`bl apply`: the tested version silently skipped `.json` manifests. Verify
creation with a read after applying.

## Configure both planes

Read [setup.md](references/setup.md) for service configuration, mount commands,
credential handling, and native session registration.

1. Choose one Relayfile service/workspace and one messaging service/workspace
   for all participants. Their IDs need not match. Reuse authorized resources;
   do not run workspace-creating setup on every node.
2. Mount the same Relayfile root in a dedicated, empty directory on each
   sandbox. Use separate private state and credentials per sandbox. Start the
   agent with that local directory as its working directory.
3. Run one native probe per sandbox, discover its actual live sessions, and
   register the intended one. Never fabricate session IDs, held-file registries,
   or registrations as a substitute for discovery.
4. Verify file bytes and message round trips. Process liveness, a green roster,
   and zero reported lag are insufficient evidence.

### Details that change the outcome

- `--mode poll` is a materialized directory with Linux filesystem notifications
  for uploads and WebSocket events for downloads. It does not require FUSE.
  Its five-second minimum poll interval is fallback/maintenance, not the
  realtime mechanism.
- Mount credentials need `fs:read`, `fs:write`, and **`ops:read`**. Without the
  last scope, bytes may converge while durable receipts fail with HTTP 403 and
  the outbox needs attention. Check receipt settlement, too.
- Use exact layout. The tested Relayfile checkout refuses scoped/multipath
  layout; consult the installed binary before copying flags from older guides.
- For Blaxel-supervised daemons use `wait_for_completion: false`,
  **`keep_alive: true`, and `timeout: 0`**. With keep-alive and the default
  600-second process timeout, the platform kills the process after ten minutes.
  Keep-alive keeps compute active: bound test resources with expiry and cleanup.
- Probe 2026.11.3 uses `agent-relay-probe relay serve/call`; the installed
  2026.11.4-beta.3 uses `agent-relay-probe serve/call`. Check `--help` rather
  than assuming a prefix. The native probe needs no npm Agent Relay broker.
- Programmatic agents should use `@relaycast/sdk`'s `AgentClient`/`relay.as`.
  Agent realtime uses `/v1/node/ws`, with registration, delivery cursors, and
  acknowledgements. An agent token on the retired `/v1/ws` returns 401.
- Native automatic answers can arrive as **`thread.reply`**, including answers
  to a DM. Correlate the sender, fresh round ID, and expected hash; don't accept
  an old reply replayed during reconnect.
- Keep private state and credentials outside replicated data. Preserve the
  mount's `.relay` metadata and outbox; the mount excludes its runtime tree.
  Never clear an unsettled outbox to make health green. Resolve the underlying
  problem, or preserve diagnostics and use a fresh disposable mount for a retest.

## Qualify before reporting success

Follow [verification.md](references/verification.md). Helpers:

- [file-probe.py](scripts/file-probe.py): OS writes, atomic replacement,
  rename/delete, and deadline-bounded peer SHA-256 checks.
- [message-probe.mjs](scripts/message-probe.mjs): SDK node transport and a
  correlated reply containing the expected peer file hash. It reads an
  authorized private agent credential file; it creates no workspace.

Test both directions, binary content, atomic save, rename/delete, simultaneous
disjoint writes, and recovery after a peer mount restarts. Confirm uploads still
work after restart, not only catch-up downloads. Require listening WebSockets,
no conflicts or pending writes, and settled outboxes.

The retained [qualification evidence](references/qualification.md) distinguishes
real transports and real Pi shell tools from the deterministic local model.
Do not describe that test as paid-model inference, external-provider writeback,
suspend/resume qualification, or production deployment. Report resource
disposition and any remaining limitations.

For measured filesystem performance, read the [600-transfer benchmark](references/benchmarks/2026-11-07/README.md)
with raw samples, exact timing boundaries, environment, and a repeatable harness.
Keep its same-region confirmed-sync results separate from native session reply
time, provider writeback, throughput, and service-level guarantees.
