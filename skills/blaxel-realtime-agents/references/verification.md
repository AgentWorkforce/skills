# Qualification and repeatable probes

Run against authorized scratch data. The helpers write/delete files and the
message helper sends a real message. Bootstrap authorization alone does not
authorize those actions. Use a fresh random subdirectory per run so cached
content cannot satisfy a repeated challenge.

## Files

Copy `scripts/file-probe.py` to each participant (POSIX, Python 3.9+).
Requests are JSON files with no shell interpolation. The `content` field for
`write` and `atomic` is **base64**, not raw text; `aGVsbG8K` below encodes
`hello` followed by a newline. For example:

```json
{"op":"write","path":"qualification-UNIQUE/challenge.txt","content":"aGVsbG8K"}
```

```sh
python3 /opt/relay/file-probe.py --root /app/shared --request /tmp/request.json
```

On the other sandbox, use `op: expect` with the exact SHA-256 returned by the
writer. Wait for a deadline-bounded match; a file merely existing is not proof.

```json
{"op":"expect","path":"qualification-UNIQUE/challenge.txt","sha256":"REPLACE_WITH_WRITER_SHA256","timeout":15}
```

Other operations:

- `atomic`: same fields as `write`; commits a temporary file with `os.replace`.
- `rename`: `path` plus `destination`; refuses an existing destination.
- `delete`: `path`; removes only that exact scratch file.
- `expect` with `absent: true`: proves a peer deletion or rename's old path.

The helper rejects symlinks and `.relay` at every path depth. Directory handles
and `O_NOFOLLOW` keep concurrent symlink replacement from redirecting an
operation outside the selected root. The helper is a scratch-data verifier,
not isolation from malicious code with the same operating-system identity.

The included regression tests exercise binary/atomic operations, observed and
concurrently replaced symlinks, nested runtime paths, transient permission
errors, and message validation before any SDK/network work:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s skills/blaxel-realtime-agents/tests -p 'test_*.py' -v
node --test skills/blaxel-realtime-agents/tests/message-probe.test.mjs
```

Run those commands from the skills repository. The message regression uses a
local SDK fixture; it does not replace or rerun the retained live qualification.

Required checks: A→B create/update, B→A binary content, atomic replace, rename
(new bytes and old-path absence), delete, and simultaneous disjoint writes.
Then stop only this session's exact peer mount process, write from the other
node, and restart using the same private tracking/outbox. Verify catch-up AND
a new upload from the restarted node. Recreate a deleted scratch file and
check that it propagates again.

Require both public health documents to have:

```text
eventListener.mode = websocket
eventListener.status = listening
pendingWriteback = 0
pendingConflicts = 0
outbox.pending = 0
outbox.needsAttention = 0
outbox.failed = 0
```

Allow bounded time for receipts to settle. Record the writer's real result and
peer hash; log controller-observed elapsed time separately from the peer wait.
Do not report a near-zero peer wait as propagation latency: delivery may have
completed before that check started. Independent-machine clocks are not a
valid one-way latency measure without calibration.

## Native session request, tool execution, and reply

Use one real session behind each native probe. Ask the receiving agent to
execute `sha256sum` on the mounted challenge file and reply exactly:

```text
ACK ROUND_ID SHA256
```

For a repeatable transport test without paid model credentials, the retained
qualification ran genuine Pi 1.3.0 persistent TUIs with the shipped extension
and a deterministic loopback OpenAI-completions endpoint. The endpoint turns
`E2E_QUERY ROUND_ID RELATIVE_PATH` into a Pi `bash` tool call:
`sha256sum /app/shared/RELATIVE_PATH`. Its final ACK derives from the real tool
result. Only model generation is a fixture; never replace Relayfile, Relaycast,
the probe, session discovery, Pi's extension loader, or its shell tool with
stubs and call the result an end-to-end transport test.

Preserve the received user message, actual tool call, successful tool result,
final answer, native delivery activity, and the sender's realtime reply event.
Use a fresh round ID for every request; SDK reconnects may replay old replies.

The provided SDK helper sends that challenge and verifies the correlated
sender and hash. Install the dependency beside the helper in the sandbox:

```sh
npm install --prefix /opt/relay-driver --no-audit --no-fund @relaycast/sdk@8.12.0
```

Place `message-probe.mjs` at `/opt/relay-driver/message-probe.mjs`. Its private
credential file, handed off through an authorized secure channel, has
`base_url` and `token` fields. It must be owner-only, with mode 0600, outside
the mount. The query file contains no credentials:

```json
{"round":"UNIQUE_ROUND","to":"agent-b","file":"qualification-UNIQUE/challenge.txt","expected":"REPLACE_WITH_WRITER_SHA256"}
```

```sh
node /opt/relay-driver/message-probe.mjs /app/relay-private/driver.json /tmp/query.json
```

Alternatively `RELAYCAST_SDK_MODULE` can name the installed SDK module's
absolute entry file. The helper opens the SDK node connection, sends once with
an idempotency key, and waits up to 45 seconds for the matching answer. It
does not poll history to manufacture a realtime result. Repeat in reverse.
Do not run multiple clients concurrently under the same driver identity:
their node bindings and disconnect presence can interfere. Give concurrent
participants separate identities.

## Evidence and cleanup

Retain only redacted service configuration, version/checksum provenance,
result JSON, native activity, and generated test transcript excerpts. Exclude
credential files, signed bearer values, signing keys, full probe stores, and
bootstrap responses. Check source and generated output for secrets before
committing.

After evidence is durable, remove only exact session-owned sandbox names,
individually. Confirm deletion with a post-delete listing or individual reads
and record the exact command and observed result. Do not delete images, drives,
volumes, account workspaces, or preexisting resources as part of this test.
Deleting the disposable service sandbox removes its isolated credential
authority; test file tokens also have a two-hour expiry. Preserve the person's
Blaxel sign-in and official installed skills.
