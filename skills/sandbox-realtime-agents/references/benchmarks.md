# Confirmed filesystem sync across sandbox providers

On November 7, 2026 UTC, E2B and Freestyle each completed **600 measured
transfers plus 60 warmups, with zero failed transfers**. Before timing, each
provider passed 17 real file, native-session, shell-tool and recovery checks.
Maritime account access worked, but sandbox creation required a billing plan;
there are no Maritime measurements.

## Results

Each row pools 100 A → B trials and 100 B → A trials for that payload. Times
are write-to-full-peer-SHA-256-confirmation, including the returning HTTPS ACK.

| Provider | Payload | Measured | Failures | p50 | p95 | p99 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| E2B | 1 KiB | 200 | 0 | 162.1 ms | 179.5 ms | 187.6 ms | 190.4 ms |
| E2B | 64 KiB | 200 | 0 | 175.5 ms | 198.3 ms | 207.9 ms | 220.4 ms |
| E2B | 1 MiB | 200 | 0 | 257.6 ms | 298.3 ms | 307.5 ms | 320.4 ms |
| Freestyle | 1 KiB | 200 | 0 | 133.1 ms | 199.4 ms | 215.6 ms | 238.7 ms |
| Freestyle | 64 KiB | 200 | 0 | 150.7 ms | 216.7 ms | 269.1 ms | 316.0 ms |
| Freestyle | 1 MiB | 200 | 0 | 266.7 ms | 345.7 ms | 388.6 ms | 500.5 ms |

All raw rows are retained, including 10 warmups per direction/size. No outliers
were removed. Percentiles use nearest rank on successful measured trials;
there were no failed trials in these runs. The per-direction values and counts
are in each summary below. With 100 samples per direction, p99 is a small-sample
tail observation; these runs do not establish a service-level guarantee.

## Relationship to the earlier Blaxel result

| Environment | 1 KiB p50 / p95 | 64 KiB p50 / p95 | 1 MiB p50 / p95 |
| --- | ---: | ---: | ---: |
| Blaxel | 161.8 / 177.5 ms | 184.5 / 206.8 ms | 282.2 / 328.9 ms |
| E2B | 162.1 / 179.5 ms | 175.5 / 198.3 ms | 257.6 / 298.3 ms |
| Freestyle | 133.1 / 199.4 ms | 150.7 / 216.7 ms | 266.7 / 345.7 ms |

The [published Blaxel dataset](https://github.com/AgentWorkforce/skills/tree/66702ab/skills/blaxel-realtime-agents/references/benchmarks/2026-11-07)
used the same original runtime timing harness, six-cell order and sample counts. These
are separate workload measurements. Resource sizes, runtimes, images, placement
and run time differ, preventing a controlled provider performance ranking.

| Environment | Configured CPUs / memory per VM | Image | Placement evidence |
| --- | --- | --- | --- |
| Blaxel | 2,048 MiB; CPU allocation not separately set | `blaxel/base-image:0.2.77`, Alpine 3.23.8 | `us-pdx-1` returned |
| E2B | 2 vCPUs / 512 MiB | Public `base`, template `rki5dems9wqfm4r03t7g`, Debian 12 | Physical region not returned |
| Freestyle | 2 vCPUs / 4,096 MiB | Snapshot `sh-3556b17912bc4dfc83142b4dcddf3fe5`, Ubuntu 24.04.5 | Physical region not returned |

Blaxel used Node 24.22.2/Python 3.12.16; E2B used Node 22.23.2/Python 3.11.6;
Freestyle used Node 22.23.2/Python 3.12.3. Exact binary, harness and environment
evidence is retained. E2B's template ID does not pin a captured immutable build
revision; Freestyle's actual source snapshot ID was captured on all three VMs.
Do not infer a physical region from an ingress hostname or manager identifier.

## Method

Two independent peer VMs replicated local disks through a real Relayfile service
on a third VM. No shared drive, FUSE or shared volume was used. After correctness
qualification, native Pi sessions, model fixtures, probes, mounts and the
combined messaging/file service were stopped. Settled qualification state was
archived. A fresh filesystem-only Relayfile service and empty mirrors were then
started on those same VMs, using the archived original benchmark service fixture.

Each trial follows these steps:

1. Before timing, generate exact-size content, compute its SHA-256, and arm the
   peer observer over authenticated HTTPS.
2. Start the writer's `time.monotonic_ns()` immediately before ordinary
   `open('wb')`, write and close.
3. The peer watches inode/mtime/size, sleeping 1 ms between attempts, and hashes
   the full contents whenever the file changes to the expected size.
4. On an exact digest match, send an authenticated HTTPS ACK carrying the fresh
   round and digest. Stop the writer's clock when that matching ACK is received.

One clock avoids inter-machine clock synchronization error. Timing includes
local writes, watcher settling, upload, real server processing, WebSocket
notification/download, peer observation/hash work, and the return ACK's
transport/TLS/preview ingress. Observer arming, controller calls and the 100 ms
inter-trial sleep are outside the timed interval. No callback overhead was
estimated or subtracted. This is confirmed peer content time, not isolated
one-way replication latency.

Payloads are a unique round header plus repeated bytes 0–255, truncated to
1,024, 65,536 or 1,048,576 bytes. They are deterministic and compressible;
compression was not controlled. One outstanding transfer runs at a time,
overwriting one dedicated file per direction/size. There is no `fsync` barrier.
The fixed, nonrandomized order is A/1KiB, B/1MiB, A/64KiB, B/1KiB, A/1MiB,
B/64KiB. Every cell has 10 warmups followed by 100 measured writes, with a
30-second ACK wait after writing (the original arming request had its own
35-second timeout). All published cells completed with 110 successful rows.

Mounts used exact layout, `--mode poll --interval 5s --startup-jitter 0s`, local
filesystem notifications and WebSocket downloads. The isolated OSS service
used `RELAYFILE_EXTERNAL_WRITEBACK=false`, a fresh private JSON state file and
its no-op provider writer; no external provider mutation occurred. Final
listeners were active, conflicts/writebacks were zero, and outboxes had zero
pending/attention/failed receipts. Public file and callback endpoints rejected
unauthenticated requests with 401.

Freestyle A reported 331 settled operation receipts for its 330 writer trials.
The extra operation was not attributed before deletion and the operation ledger
was not retained. The observed counter is preserved in the health artifact;
receipts are not equated with unique transfer rounds. Transfer counts and
percentiles come from the raw sample rows, not receipt counters.

Historical messaging boundary checks covered the proxy only. Its original
engine listened on all interfaces, and direct upstream-port confinement was
not verified. Those disposable VMs are deleted; maintained qualification
fixtures now force the engine to loopback before it binds. The historical check
does not establish complete upstream ingress isolation.

No model inference, native messaging or agent reasoning occurs inside this
timing interval. The separate native qualification proves those session/tool
paths. Cross-region performance, concurrent throughput, high-entropy bulk
transfer, large trees, same-file conflicts, disk durability, paid models,
production integrations, cold start and suspend/resume remain unqualified.

## Evidence and recomputation

| Provider | Qualification | Native tools | Raw timing | Summary | Environment | Health | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E2B | [17 checks](evidence/e2b/qualification.json) | [real Pi/bash](evidence/e2b/native-tool-proof.json) | [660 rows](evidence/e2b/benchmark/samples.jsonl) | [percentiles](evidence/e2b/benchmark/summary.json) | [versions/hashes](evidence/e2b/environment.json) | [receipts](evidence/e2b/benchmark/health.json) | [exact IDs](evidence/e2b/cleanup.json) |
| Freestyle | [17 checks](evidence/freestyle/qualification.json) | [real Pi/bash](evidence/freestyle/native-tool-proof.json) | [660 rows](evidence/freestyle/benchmark/samples.jsonl) | [percentiles](evidence/freestyle/benchmark/summary.json) | [versions/hashes](evidence/freestyle/environment.json) | [receipts](evidence/freestyle/benchmark/health.json) | [exact IDs](evidence/freestyle/cleanup.json) |
| Maritime | [blocked before creation](evidence/maritime/blocker.json) | Unverified | Unmeasured | Unmeasured | Account/CLI verified | Unverified | No sandbox created |

From the skill directory, with Python 3.9+:

```sh
python3 scripts/benchmark/summarize.py references/evidence/e2b/benchmark/samples.jsonl
python3 scripts/benchmark/summarize.py references/evidence/freestyle/benchmark/samples.jsonl
```

Output reproduces the committed summaries exactly. The raw `local_write_ms`
field is diagnostic and already included in `write_to_ack_ms`; do not add or
subtract it. Warmup rows are retained but excluded from percentiles.

The [historical source manifest](evidence/harness-2026-11-07/manifest.json) maps
the original executable hashes to immutable text archives. Maintained `scripts/`
include review fixes for failure exits, concurrent cells, callback origins,
private modes, subprocess lifecycle, path checks and isolated Pi homes. Those
changes were locally regression-tested after measurement; the published 600-trial
cloud datasets have not been rerun with the revised harness. Do not relabel old
samples as results from the revised scripts. The old driver had a 600-second
request limit and could exit zero on failure; published counts instead verify
all 110 successful rows per cell. The new driver returns nonzero for any failure
and budgets 110 × (30 + 0.1) + 60 seconds, with arming and ACK inside each trial's
30-second total budget. Arming remains outside the measured write-to-ACK interval.

## Reproduce a live run

After obtaining the task's nonproduction resource and isolated test-credential
authorization, follow the provider guide to create fresh participants and
service ingress. Record exact IDs, versions, resource sizes, placement evidence
and lifecycle limits before starting.

1. Run the [correctness qualification](verification.md) and retain actual native
   session/tool evidence and settled receipts.
2. Stop those isolated sessions and services. Archive their settled data/state;
   start the maintained [filesystem-only service](../scripts/benchmark/hub.mjs)
   on the service VM with `/tmp/relayfile-server` executable and a fresh
   `/app/bench-private` directory (0700). Preserve its relative helper import by
   uploading the scripts tree as described in [runtime setup](runtime.md).
   It generates scoped two-hour mount
   bundles for workspace `ws_relayfile_benchmark`.
3. Privately transfer the matching `mount-a.json` / `mount-b.json` bundle to each
   peer as `/app/bench-private/mount-creds.json` (0600). Start new mirrors with
   those bundles, empty `/app/shared`, private state and the recorded flags.
4. Generate a new unpredictable callback token programmatically and a new
   unique run ID for every run. Securely write 0600 `config.json` in each peer's
   private directory with `run`, `role`, `peer_role`, `peer_url` (other peer's
   HTTPS callback origin), and `callback_token`. Never reuse this dataset's IDs
   or files, or put tokens in command arguments/shared data/evidence.
5. Upload the maintained [peer server](../scripts/benchmark/peer.py) and
   [cell driver](../scripts/benchmark/cell.py) there. Start `peer.py` on both
   nodes at port 9092 and verify unauthenticated requests return 401. Require
   HTTPS origins for network callbacks; only `cell.py` uses loopback HTTP.
6. Run `python3 /app/bench-private/cell.py SIZE` in the writer for each of the
   six cells in order. Wait for actual process completion and success before
   advancing. A submitted/running process with default exit code zero is not
   completion proof. Keep the provider and command timeouts long enough for a
   whole cell, while retaining a bounded overall sandbox lifetime.
   The maintained driver allows 3,371 seconds per cell; for that full budget,
   use at least `--timeout-ms 3371000` with Freestyle and ensure the VM has enough
   authorized lifetime remaining. Ordinary published cells were much faster.
7. Retrieve both `samples.jsonl` files, concatenate their rows and recompute.
   Keep incomplete/failed trials. A timeout stops its cell; an exception before
   a row is written is a harness/run failure, not an excluded success.
8. Check listeners/conflicts/writebacks and settled receipts; retain redacted
   proof, then remove only the exact session-owned VMs and ingress rules.

Initial setup failures are retained separately from measured transfer trials:
E2B's first Node 24 native dependency build hit its memory constraint and its
exact VM was removed. Freestyle's initial larger command-check VM was removed
before the smaller three-VM run. Maritime's failed create made no sandbox and
requires a human billing decision. None of these are silently discarded
transfer samples.
