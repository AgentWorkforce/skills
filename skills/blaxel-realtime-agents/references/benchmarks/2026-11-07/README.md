# Relayfile cross-sandbox confirmed sync benchmark

Across two independent Blaxel sandboxes, 600 measured file transfers completed
with matching peer SHA-256 hashes and zero timeouts. The median confirmed sync
time was **162 ms for 1 KiB**, **184 ms for 64 KiB**, and **282 ms for 1 MiB**.
These times include the acknowledgement returning to the writer.

Measured November 7, 2026 UTC (November 6 in Los Angeles). This is a single
controlled run in `us-pdx-1`, not a service-level guarantee or a comparison with
another product.

## Results

Each payload has 200 measured trials: 100 A → B and 100 B → A. The pooled
percentiles below combine those equally sized directional samples.

| Payload | Measured | Failures | p50 | p95 | p99 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 KiB | 200 | 0 | 161.8 ms | 177.5 ms | 191.2 ms | 211.6 ms |
| 64 KiB | 200 | 0 | 184.5 ms | 206.8 ms | 224.3 ms | 234.6 ms |
| 1 MiB | 200 | 0 | 282.2 ms | 328.9 ms | 498.3 ms | 622.3 ms |

| Direction | Payload | p50 | p95 | p99 |
| --- | --- | ---: | ---: | ---: |
| A → B | 1 KiB | 157.5 ms | 178.2 ms | 187.7 ms |
| B → A | 1 KiB | 165.3 ms | 177.0 ms | 191.2 ms |
| A → B | 64 KiB | 183.9 ms | 199.2 ms | 209.4 ms |
| B → A | 64 KiB | 184.9 ms | 207.6 ms | 227.8 ms |
| A → B | 1 MiB | 301.3 ms | 336.1 ms | 498.3 ms |
| B → A | 1 MiB | 275.7 ms | 308.8 ms | 337.1 ms |

An additional 10 warmups per direction and size passed: 60 warmups total. All
660 trials remain in [samples.jsonl](samples.jsonl); no outliers were removed.
Percentiles use the nearest-rank method on successful measured trials. There
were no failed trials in this run. With 100 observations per direction, p99 is
only a small-sample tail observation; more independent runs are needed to
characterize tail reliability.

## What the clock measures

1. Before timing, the writer generates unique content, calculates its SHA-256,
   and arms an observer on the other sandbox over authenticated HTTPS.
2. The writer starts `time.monotonic_ns()` immediately before ordinary
   `open('wb')`, write, and close on its local mirror.
3. The peer polls the target's inode/mtime/size, sleeping 1 ms between attempts,
   and hashes the full contents whenever the file changes to the expected size.
4. Only a matching SHA-256 triggers an authenticated HTTPS acknowledgement.
   The writer stops its clock when the matching round and digest arrive.

Both timestamps come from the same writer clock. Clock synchronization is not
required. The timed path includes local write/close, Relayfile's local watcher,
upload, service processing, WebSocket notification/download, peer observation
and hashing, and the HTTPS acknowledgement's return path. Callback requests use
Python `urllib`; fresh request/TLS/preview ingress costs are included. No control
machine request latency is inside the timed interval. Arming and the 100 ms
inter-trial sleep are outside it.

This is **write-to-peer-content-confirmation time**, not isolated one-way
replication latency. A successful row proves the peer read matching bytes; it
does not assert an `fsync` durability barrier or that a provider writeback had
settled at that exact instant. Both mounts' outboxes were checked after the run
and had zero pending, attention-needed, or failed receipts.

## Environment and workload

- Three disposable VMs, each configured for 2,048 MiB: two mirrors and a third
  running the real Relayfile service. Independent disks; no Agent Drive or
  shared volume. All three reported `us-pdx-1`.
- Fixed image `blaxel/base-image:0.2.77`, Alpine 3.23.8, linux/amd64, Python
  3.12.16. Blaxel's [release build workflow](https://github.com/blaxel-ai/sandbox/blob/8d349c13bb9744bef29da3530fbd95c5344725b7/.github/workflows/build.yaml)
  publishes immutable version tags. The control plane reported the versioned
  reference; a resolved image digest was not returned/captured.
- Relayfile source `5c13009ac26684a7b48a19811456fe949a899f80`, static Go 1.26.1
  binaries. Mount reports `0.10.56-blaxel-5c13009a`. Exact executable hashes and
  the build's `vcs.modified=true` provenance limitation are in
  [environment.json](environment.json).
- Exact mirror layout, `--mode poll --interval 5s --startup-jitter 0s`, with
  filesystem notifications for uploads and WebSocket events for downloads.
  Polling is maintenance/fallback, not a five-second wait on each write.
  Processes used `keep_alive=true`, `timeout=0`; standby was excluded.
- One writer and one outstanding transfer at a time. Each direction/size reuses
  one dedicated file. Six cells ran in a recorded fixed order, not randomized.
- Deterministic binary payload: unique round header plus repeated bytes 0–255,
  truncated to the stated size. This is compressible content; compression was
  not controlled. It does not characterize high-entropy bulk transfer speed.
- Isolated bearer-protected Relayfile service, local JSON state, and its built-in
  OSS no-op provider writer (`RELAYFILE_EXTERNAL_WRITEBACK=false`). No external
  integrations, model inference, native probes, or agent reasoning in this
  filesystem benchmark. The separate [qualification](../../qualification.md)
  covers native session messaging.

This run does not establish concurrent throughput, cross-region latency,
same-file conflict behavior, large-tree performance, cold start, suspend/resume,
or production-provider performance. It replaces neither the earlier four-case
qualification timings nor the need to benchmark a customer's own workload.

## Recompute the published table

Python 3.9+ suffices; this command creates no resources and uses no credentials:

```sh
python3 summarize.py samples.jsonl
```

Its output matches [summary.json](summary.json). `warmup: true` rows are retained
but excluded from percentiles. `local_write_ms` is diagnostic and is already
included in `write_to_ack_ms`; do not add or subtract it.

## Repeat on fresh sandboxes

The retained [peer.py](peer.py), [cell.py](cell.py), and [hub.mjs](hub.mjs) are
the exact runtime harness files used for this dataset. They are a controlled
scratch-workload fixture, not a customer-facing service. Provisioning is manual
or agent-operated using the [setup reference](../../setup.md); this is not a
one-command infrastructure installer.

1. With resource/test-credential authorization, create three **fresh** sandbox
   names in one approved region, using the fixed image above, 2,048 MiB and a
   two-hour `ttl-max-age`. The service needs port 9090; each peer needs port
   9092. Create HTTPS previews for those ports. Ports 8080/80/443 are reserved.
   This filesystem-only test uses static Go and does not need the glibc image
   required by the native messaging probe.
2. Build the server and mount from the recorded Relayfile checkout with
   `GOOS=linux GOARCH=amd64 CGO_ENABLED=0` and `go build -trimpath`, or securely
   supply those exact recorded executables. Upload/install the server at
   `/tmp/relayfile-server` on the service VM and mount at `/tmp/relayfile-mount`
   on each peer, mode 0755. Keep all private fixture files under
   `/app/bench-private` (0700), outside `/app/shared`.
3. Upload `hub.mjs` to `/app/bench-private/hub.mjs` and start
   `node /app/bench-private/hub.mjs` with keep-alive and no process timeout.
   It generates a fresh isolated signing authority and two scoped two-hour
   mount bundles. Privately copy `mount-a.json` / `mount-b.json` from that VM
   to the matching peer as `/app/bench-private/mount-creds.json`, mode 0600,
   through the authenticated sandbox filesystem API. Never print their contents.
4. Start both mounts with the flags in `environment.json`, the service's HTTPS
   preview as `--base-url`, workspace `ws_relayfile_benchmark`, and private
   credential files. Wait for both listeners to report `listening`. Verify an
   unauthenticated file-tree request returns 401.
5. Generate a new unpredictable callback token programmatically, for example
   `secrets.token_urlsafe(32)`, and a unique run ID for **every** new run. Do not
   reuse this dataset's ID, files, or running processes. Through the secure
   filesystem API, write 0600 `config.json` on each peer with keys `run`, `role`
   (`a` or `b`), `peer_role`, `peer_url` (other peer's HTTPS preview), and
   `callback_token`. The token belongs only in these private files. Do not put
   it in command arguments, a shared mount, agent configuration, or evidence.
6. Upload the two Python harness files to `/app/bench-private`. Start
   `python3 /app/bench-private/peer.py` on both peers with keep-alive and no
   process timeout. Verify unauthenticated POSTs to `/run` return 401.
7. Run `python3 /app/bench-private/cell.py SIZE` inside the writer using a
   supervised process with no timeout. Run cells sequentially in the recorded
   order: A/1024, B/1048576, A/65536, B/1024, A/1048576, B/65536. Wait for each
   process to **complete**, with exit code zero, before starting the next.
   A running Blaxel process can already expose `exitCode: 0`; that field alone
   does not establish completion. Each cell includes 10 warmups and 100 trials.
8. Retain both private `samples.jsonl` files through the secure filesystem API,
   concatenate their rows, and run `summarize.py`. Keep failed/incomplete trials;
   the harness stops a cell on the first 30-second timeout. An exception before
   writing a row is a harness/run failure, not a successful or excluded trial.
   Inspect final listeners, conflicts, and receipt settlement. Record exact
   image/version/hash/configuration and any differences from this environment.
9. Delete only the three exact sandboxes created for that run, one per command.
   Use `bl get sandboxes --all -o json` to check those exact names across pages.
   Never sweep a workspace. Do not publish private configuration or credentials.

## Evidence and cleanup

- [Raw samples](samples.jsonl), [computed summary](summary.json), and
  [environment](environment.json).
- [Final health and cell process timestamps](health.json), including
  unauthenticated-request rejection and drained outboxes.
- [Cleanup proof](cleanup.json): all three benchmark VMs deleted individually;
  none of the exact names remained in an all-pages listing.
