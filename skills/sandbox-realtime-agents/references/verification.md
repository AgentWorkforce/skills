# Correctness checks before timing

Use scratch data in an explicitly authorized shared tree. The helper requires
Python 3.9+ with descriptor-relative operations and `O_NOFOLLOW`.
It rejects symlinks, traversal and `.relay` at any depth. Pinned handles reduce
path races; they are not a security boundary against a malicious same-OS-user
process that can move directories or change process state.

The [file helper](../scripts/file-probe.py) reads a JSON request outside the
shared tree:

```sh
python3 /app/relay-test/file-probe.py \
  --root /app/shared --request /app/relay-test/request.json
```

`write`/`atomic` requests contain `path` and base64 **encoded bytes** in `content`.
`rename` adds `destination`, whose parent must already exist; it uses a real
atomic no-replace rename on Linux/macOS and never creates destination parents.
`delete` names one exact file. `expect` needs either
the expected `sha256` or `absent:true`, with a bounded `timeout`. Confirm that
an existing file fails an absence check before relying on deletion evidence.
Hashing checks its deadline between chunks, including after each read; it does
not promise to interrupt an OS read that is itself blocked in the kernel.

## Fresh runtime dependencies

Obtain the Relayfile source from [AgentWorkforce/relayfile](https://github.com/AgentWorkforce/relayfile)
at the recorded commit, then build/upload the binaries as described in
[runtime setup](runtime.md). On approved fresh VMs with the pinned Node runtime:

```sh
# Service VM:
npm install --prefix /opt/relay-test --no-audit --no-fund @relaycast/engine@8.12.0
# Each peer VM:
npm install --prefix /opt/relay-driver --no-audit --no-fund @relaycast/sdk@8.12.0
npm install --prefix /opt/pi-test --no-audit --no-fund @earendil-works/pi-coding-agent@1.3.0
```

Upload the maintained `scripts/` tree under `/opt/relay-fixtures/scripts`,
preserving relative imports (including `fixture-services.mjs`). Install the
file/message helpers at the `/app/relay-test` paths used below. The historical
source archives are text evidence, not executable setup entry points.

The qualification passed these 17 checks separately on E2B and Freestyle:

1. A → B create and exact SHA-256.
2. B → A 128 KiB binary bytes.
3. A → B overwrite with fresh content.
4. B → A atomic replacement.
5. Renamed destination has expected bytes on the peer.
6. Renamed source is actually absent on the peer.
7. Delete propagates as confirmed peer absence.
8. Simultaneous disjoint A write reaches B.
9. Simultaneous disjoint B write reaches A.
10. B catches up after its mount is stopped and A writes while it is offline.
11. B can upload a fresh write after restarting its mount.
12. B's subsequent delete reaches A.
13. A can recreate the deleted path and B receives new bytes.
14. A's SDK challenge reaches B's genuine native Pi session; its real shell
    hashes the expected peer file and the correlated answer returns.
15. B's challenge reaches A through the same real session/tool route.
16. A finishes listening, with no conflicts, pending writes or failed/attention
    receipts.
17. B finishes with the same healthy, settled state.

For message probes, securely transfer a 0600 owner-owned private file containing
`base_url` and the isolated **agent** `token`. Write a public query file with
these exact keys: `round` (1–128 alphanumeric/underscore/hyphen characters),
`to` (nonempty recipient), `file` (relative path with nonempty components,
no `.`, `..` or `.relay` at any depth), and `expected` (lowercase 64-hex SHA-256).
The maintained probe adds a random nonce to `round` on every invocation; use the
returned effective `round` for correlation. The caller's label is returned as
`request_round`. Run:

```sh
RELAYCAST_SDK_MODULE=/opt/relay-driver/node_modules/@relaycast/sdk/dist/index.js \
  node /app/relay-test/message-probe.mjs \
  /app/relay-test/driver.json /app/relay-test/query.json
```

Retain the matching shell tool call/result from the actual session transcript,
reply ID, sender, round and hash. Do not retain private bundles. A roster entry
alone does not prove message delivery or file convergence.

The maintained [model fixture](../scripts/qualification/model_fixture.py) and
[PTY supervisor](../scripts/qualification/pi_terminal.py) are for isolated
qualification. Their original measured versions are in the
[historical source manifest](evidence/harness-2026-11-07/manifest.json).
They require Pi 1.3.0 under `/opt/pi-test`, the pinned Node PATH, and a private
`/app/relay-test/pi-home` used by both core and Pi. The supervisor refuses
existing config files, keeps the person's HOME untouched and drains final PTY
bytes. Start the loopback model
only inside the VM; it requests real `bash sha256sum`, then produces an ACK from
the actual tool result. This does not qualify paid inference or a customer's
model credentials. Real customer agents use their supported model setup.

For timing, retain this correctness evidence first. Stop the isolated native
sessions and services, archive settled qualification mirrors/state, and start a
fresh filesystem-only Relayfile service and empty mirrors. The benchmark's
[service fixture](../scripts/benchmark/hub.mjs) generates separate short-lived
mount tokens; do not reuse a production signing authority.

Recompute statistics from all raw rows using
[summarize.py](../scripts/benchmark/summarize.py). Preserve warmups and failures,
report partial runs as partial, and clean up only recorded resource IDs.

The review fixes also passed a separate [12-test Linux file-helper check](evidence/review-linux-check.json)
in one 120-second E2B sandbox, deleted immediately with a not-found read after
cleanup. This verifies Linux `renameat2` and the file guards; it is not a new
performance dataset. Local tests additionally cover the real Relayfile/engine
startup, readiness, child failure and cleanup paths.
