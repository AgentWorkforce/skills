# Setup commands and boundaries

## Shape

```text
sandbox A: agent + native probe + /app/shared mirror
                | messaging          | file events/writes
                v                    v
           Relaycast service    Relayfile service
                ^                    ^
                |                    |
sandbox B: agent + native probe + /app/shared mirror
```

The paths are independent local disks. An optional third sandbox hosts both
services for an isolated test. Blaxel Agent Drive is not part of this topology:
the qualification proves Relayfile replication rather than a shared disk.

## Sandbox creation

Example manifest for one participant; choose an approved, unique name for each:

```yaml
apiVersion: blaxel.ai/v1alpha1
kind: Sandbox
metadata:
  name: REPLACE_WITH_APPROVED_NAME
spec:
  runtime:
    image: blaxel/ts-app:latest
    memory: 2048
  lifecycle:
    expirationPolicies:
      - type: ttl-max-age
        value: 2h
        action: delete
```

Apply the `.yaml` file, then read the exact sandbox to confirm its image,
region, and status. The verified run used `us-pdx-1`. Use the Blaxel SDK's
binary upload for executables, and batch source uploads when appropriate.

For managed long-lived processes:

```python
await sandbox.process.exec({
    "name": "relayfile-mount",
    "command": "YOUR_REVIEWED_COMMAND",
    "wait_for_completion": False,
    "keep_alive": True,
    "timeout": 0,
})
```

Use the same policy for the probe, test model endpoint, and interactive-session
supervisor. A process timeout is independent of sandbox expiration. Keep-alive
prevents normal standby; this test does not prove suspend/resume behavior.

## Relayfile

Use an authorized existing service, or explicitly provision an isolated one.
The qualification built the real Go server and mount from the same checkout:

```sh
env GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -o /tmp/relayfile-server ./cmd/relayfile
env GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -o /tmp/relayfile-mount ./cmd/relayfile-mount
```

Published `@relayfile/mount-linux-x64` is another distribution route. Check the
actual executable and version; do not claim that a source build tests a newer
published release. FUSE is unnecessary for this materialized mirror.

An isolated server needs an approved strong internal HMAC secret, a trusted
JWKS endpoint, and RS256 bearer tokens with audience `relayfile`, a matching
workspace claim, expiry, and scopes `fs:read`, `fs:write`, `ops:read`. Keep the
signing key and JWKS server on the service sandbox; expose only the public
verification keys as necessary. Use separate mount tokens and private bundles.
Do not use the predictable development HMAC secret on a public preview.

The isolated arbitrary-file test sets `RELAYFILE_EXTERNAL_WRITEBACK=false`:
the OSS service's built-in worker settles operations using its local default
provider writer. That default writer performs no external provider mutation.
With the server default `true`, a separate executor must consume and acknowledge
provider writebacks; otherwise receipts remain pending even when bytes match.
Do not disable real provider execution to hide a production writeback failure.

Expose the service through an HTTPS preview backed by a nonreserved port, such
as 9090. Require application bearer authentication on all file operations;
verify an unauthenticated request is rejected. A public preview is transport,
not an application access policy. Use `X-Correlation-Id` on direct HTTP checks.

On each participant, create an empty shared directory and private runtime
directory. Have the authorized credential handoff create a 0600 bundle inside
a 0700 runtime directory, outside the shared tree. No tokens appear in argv:

```sh
/opt/relay/relayfile-mount \
  --base-url "$RELAYFILE_BASE_URL" \
  --workspace "$RELAYFILE_WORKSPACE" \
  --creds-file /app/relay-private/mount-creds.json \
  --local-dir /app/shared \
  --state-dir /app/relay-private/mount-state \
  --local-layout exact --mode poll --interval 5s
```

The private bundle's `token` field supplies the bearer. The public health
document is `/app/shared/.relay/state.json`; private tracking is under the
chosen state directory. Outbox data remains mount-owned under `.relay`.
Inspect `eventListener`, `pendingWriteback`, `pendingConflicts`, and `outbox`.
`eventListener.status=listening` alone is insufficient; verify fresh file bytes.

## Native probe and real sessions

The desktop distribution supplies `agent-relay-probe`; its public runtime
source lives in `relay/crates/relay-node`, and the desktop adds sign-in/history
plugins. Existing source documentation may still reference the previous layout.
The tested binary was the published Linux x64 **2026.11.3** release:

```text
https://github.com/AgentWorkforce/relay-desktop-releases/releases/download/v2026.11.3/AgentRelay-2026.11.3-Linux-x64-probe.tar.gz
```

Download its adjacent `.sha256`, verify the archive, and extract only
`agent_relay/helpers/agent-relay-probe`. Verify `--version` and `--help` on the
actual sandbox. The release installer expects a systemd user session and a
non-root user; a Blaxel supervisor can run the extracted core directly.

For a person's account, use the installed probe's `setup --help` and secure
browser flow. Confirm the intended workspace and sharing policy. Do not upload
unrelated session history as a side effect of a messaging test.

For an explicitly approved **isolated self-hosted qualification**, the test can
bind a fresh private probe store to the isolated Relaycast workspace. The
desktop's `tests/support/fake_relaycast.rs::sign_in_store` documents its
`cloud: {key, baseURL, workspaceID, name}` workspace binding. Populate it only
through a secure programmatic handoff while that private core is stopped;
leave `autoActivate: false`. This is a fixture workspace binding, not a Cloud
account login. Never overwrite a person's existing store or fabricate an
account session. The retained evidence correctly reports `account=signed_out`
and an independently verified messaging workspace.

Start one core, in an owner-only directory. Commands below use 2026.11.3:

```sh
agent-relay-probe relay serve --headless \
  --socket /app/relay-private/core.sock \
  --app-data-dir /app/relay-private/core

agent-relay-probe relay call status.get --socket /app/relay-private/core.sock --json
agent-relay-probe relay call sessions.list --socket /app/relay-private/core.sock --json
```

Start the actual supported coding harness in `/app/shared`. For Pi, create its
agent home before starting the core so the shipped extension is installed.
An already-open Pi needs `/reload`; a fresh persistent TUI loads it at startup.
RPC/print sessions are not persistent UI sessions for this adapter. Supervise a
real PTY when testing without a human terminal; do not manufacture registry
files. Wait for a live row in `sessions.list`.

Register that discovered target and enable automatic final answers if the
chosen harness cannot send through its own session tools:

```sh
agent-relay-probe relay call agents.register \
  --socket /app/relay-private/core.sock --json \
  --params '{"target":{"kind":"pi","id":"ACTUAL_DISCOVERED_ID"},"name":"agent-a"}'
agent-relay-probe relay call agents.reply_setting \
  --socket /app/relay-private/core.sock --json \
  --params '{"name":"agent-a","enabled":true}'
```

The tested Pi route receives messages and returns automatic final answers; it
does not identify Pi shell subprocesses for the session send socket. Do not
claim arbitrary `agent-relay-probe send` works from Pi. Codex/Claude use their
supported session-scoped send paths after actual caller verification. Refer to
the source project's current harness documentation for those routes.

## Programmatic agents and messaging service

Use `@relaycast/engine` for an approved isolated service and its matching
`@relaycast/sdk` for custom agents. Bootstrap one test messaging workspace over
service loopback, privately retain the returned key, then block anonymous
`/v1/workspaces` creation at the external proxy. Never print bootstrap responses.
Forward both HTTP and WebSocket upgrades; verify the upstream handshake before
calling a downstream connection healthy. Do not blindly forward WebSocket
handshake headers into a newly generated upstream handshake.

The native core handles transport for its registered coding sessions. A custom
agent uses `AgentClient(new HttpClient({apiKey: agentToken, baseUrl}))`, or
`relay.as(agentToken)`. Subscribe before sending, and handle both direct messages
and threaded replies. The SDK negotiates `/v1/node/ws` and delivery ACKs.
Do not put workspace-admin credentials in the custom agent's shared data.

For an application, preserve per-agent ownership or coordinate edits with
messages. Concurrent writes to the same file require explicit conflict handling;
this qualification covers simultaneous edits to different files, not a
distributed locking guarantee or transactional git operations.
