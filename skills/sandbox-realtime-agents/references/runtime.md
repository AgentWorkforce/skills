# Relayfile and native Agent Relay runtime

```text
agent A + native probe + /app/shared mirror
       | messages                 | files
       v                          v
   Relaycast                  Relayfile
       ^                          ^
       |                          |
agent B + native probe + /app/shared mirror
```

These are independent disks replicated through Relayfile, not a shared volume.
The qualification used a third disposable VM for both real services. Reuse an
authorized existing service when appropriate; do not bootstrap a messaging
workspace on every node.

## Relayfile

Build the real server and mount from the same checkout, or use an appropriate
published executable. The tested binaries came from Relayfile
`5c13009ac26684a7b48a19811456fe949a899f80`, Go 1.26.1:

```sh
env GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -o /tmp/relayfile-server ./cmd/relayfile
env GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -o /tmp/relayfile-mount ./cmd/relayfile-mount
```

Upload executables to the appropriate VMs; local `/tmp` paths do not exist
remotely until transferred. The tested mount path was `/tmp/relayfile-mount`,
mode 0755. Its version was `0.10.56-blaxel-5c13009a`; the build label identifies
the reused executable, not a Blaxel dependency. Match architecture with
`uname -m` before uploading.

A self-hosted service needs a strong internal HMAC secret, trusted JWKS and
RS256 bearer tokens with audience `relayfile`, matching workspace and expiration,
and scopes **`fs:read`, `fs:write`, `ops:read`**. `ops:read` is required for
receipt settlement even when bytes already converge. Keep signing authority on
the service and give each participant a separate private scoped bundle.

On each peer, create an empty shared tree and a 0700 private directory. Securely
transfer a 0600 credential bundle with a `token` field, outside the shared tree:

```sh
/tmp/relayfile-mount \
  --base-url "$RELAYFILE_BASE_URL" --workspace "$RELAYFILE_WORKSPACE" \
  --creds-file /app/relay-test/mount-creds.json \
  --local-dir /app/shared --state-dir /app/relay-test/mount-state \
  --local-layout exact --mode poll --interval 5s --startup-jitter 0s
```

The `poll` mode materializes a mirror with local filesystem notifications and
WebSocket downloads; FUSE is unnecessary. Five seconds is maintenance/fallback
cadence, not the realtime write path. Inspect `/app/shared/.relay/state.json`,
pending writes/conflicts and the outbox, then verify fresh hashes.
`lastAppliedRevision` is a full-snapshot delete-reconciliation watermark, not
the highest per-file revision applied through every transport.

The isolated raw-file test used `RELAYFILE_EXTERNAL_WRITEBACK=false`, allowing
the OSS built-in no-op provider writer to settle receipts. It did not mutate
GitHub, Slack or another provider. A real provider deployment must have its
actual executor; do not disable it to mask pending/failed production receipts.

Expose only necessary ports through the provider's HTTPS ingress. Verify file
operations return 401 without an application bearer. Public preview transport
does not supply the application's access policy.

## Native probe and actual sessions

The tested native Linux x64 release was **2026.11.3** from
[Agent Relay Desktop releases](https://github.com/AgentWorkforce/relay-desktop-releases/releases/tag/v2026.11.3).
Verify the adjacent published SHA-256, extract
`agent_relay/helpers/agent-relay-probe`, upload it and chmod its executable path.
Both tested providers used glibc linux/amd64; Alpine/musl is incompatible with
this published probe. Verify `--version` and `--help` before copying commands.

Create the supported harness home before starting the core so its shipped
extension can be installed. Start one core in a fresh private directory:

```sh
/tmp/agent-relay-probe relay serve --headless \
  --socket /app/relay-test/core.sock --app-data-dir /app/relay-test/core
/tmp/agent-relay-probe relay call status.get --socket /app/relay-test/core.sock --json
/tmp/agent-relay-probe relay call sessions.list --socket /app/relay-test/core.sock --json
```

This prefix matches 2026.11.3; newer releases may use `serve/call` directly.
For a person's account, use its secure setup/sign-in flow and chosen workspace.
Do not replace an existing store or upload unrelated session history.

Start a genuine supported coding session with cwd `/app/shared`. A fresh Pi
persistent TUI loads the extension; an already-open session needs `/reload`.
Pi print/RPC invocation does not substitute for persistent UI session discovery.
The qualification supervised a real PTY, then registered the returned live
target and enabled automatic final answers:

```sh
/tmp/agent-relay-probe relay call agents.register \
  --socket /app/relay-test/core.sock --json \
  --params '{"target":{"kind":"pi","id":"ACTUAL_DISCOVERED_ID"},"name":"agent-a"}'
/tmp/agent-relay-probe relay call agents.reply_setting \
  --socket /app/relay-test/core.sock --json \
  --params '{"name":"agent-a","enabled":true}'
```

For explicitly authorized **isolated self-hosted tests only**, a stopped fresh
core can receive a private `injectable-agents.json` binding with
`autoActivate:false` and `cloud:{key,baseURL,workspaceID,name}` from the actual
new messaging workspace. This is a fixture binding, not Cloud account login.
The retained evidence reports `account=signed_out` and independently verified
messaging workspaces. Never fabricate account identity or overwrite a person's
existing sign-in. The per-provider retained service sources demonstrate the
test signing authority and loopback-only workspace bootstrap.

## Messaging transport and supervision

The isolated service used `@relaycast/engine@8.12.0` behind an HTTP/WebSocket
proxy. Create the fixture workspace on service loopback, retain its key privately,
and block external anonymous `/v1/workspaces` creation. Forward WebSocket
upgrades correctly: do not copy `sec-websocket-*` headers into a newly generated
upstream handshake.

A programmatic test identity uses matching `@relaycast/sdk@8.12.0` with
`AgentClient(new HttpClient({apiKey:agentToken,baseUrl}))`. It negotiates
`/v1/node/ws`; raw `/v1/ws` with an agent token is not the tested route.
Subscribe before sending; match a fresh challenge, intended sender and expected
file hash on both `dm.received` and **`thread.reply`**. Reject replayed replies.
Do not connect multiple concurrent SDK clients using the same driver identity.

Pi's tested path receives requests and sends automatic final answers. It does
not prove arbitrary session-scoped `agent-relay-probe send` from a Pi shell
subprocess. Other harnesses must use their supported caller-verification routes.

Use the provider's verified process lifetime controls. The runs used consistent
root HOME/PATH, `nohup`, closed stdin, private logs and exact PID files, bounded
by sandbox expiry or explicit cleanup. Verify liveness after command return.
Concurrent writes to different files were qualified; same-file locking and
distributed transactional filesystem semantics were not.
