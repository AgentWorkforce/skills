# Blaxel qualification — 2026-11-07 UTC

**Passed:** 14 main checks and four checks of the packaged helpers across two
independent agent sandboxes and a third sandbox hosting the real services.
The test resources were disposable; see [cleanup.json](evidence/cleanup.json)
for their final disposition. No production workspace or provider was changed.

## Evidence

- [results.json](evidence/results.json): bidirectional create/update, 128 KiB
  binary content, atomic save, rename plus old-path absence, deletion,
  simultaneous disjoint writes, offline mount catch-up, two native session
  round trips, and both listener/outbox checks.
- [helper-results.json](evidence/helper-results.json): upload from a restarted
  peer, delete/recreate with identical bytes, and two round trips using the
  skill's packaged message helper.
- [native-session-proof.json](evidence/native-session-proof.json): actual Pi
  user entries, `bash` calls, successful `sha256sum` tool results, final ACKs,
  and matching sender-side WebSocket events with fresh challenge IDs.
- [A final state](evidence/a-final-mount-state.json) and
  [B final state](evidence/b-final-mount-state.json): `ready`, WebSocket
  `listening`, zero pending writes/conflicts, zero pending/attention/failed
  outbox records.
- [provenance.json](evidence/provenance.json): exact versions, source commit,
  archive checksum, binary hashes, region, and session-owned sandbox names.

The original snapshots are retained unchanged. Their `lastAppliedRevision:
rev_12` is a full-snapshot delete-reconciliation watermark, not the maximum
revision received over WebSocket/incremental updates. In the qualified source,
only `applyRemoteSnapshotDeletesRev` advances it after a successful snapshot
pass; individual files can therefore report later ready revisions such as
`rev_46`. See [the qualified implementation](https://github.com/AgentWorkforce/relayfile/blob/5c13009a/internal/mountsync/syncer.go#L9563).
Fresh peer hashes and empty outboxes provide the convergence evidence.

Image reproducibility is limited: the historical participants used the moving
tag `blaxel/ts-app:latest`, and its immutable digest was not recorded before
the sandboxes were removed. Future runs must capture an immutable image version.
The cleanup verification used `bl get sandboxes -o json` and checked that none
of the five exact names remained in that listing; it was not five individual
GET requests. The evidence now names that observation explicitly.

The four main writer/check operations took **335–651 ms** as observed by the
controller, including remote command and verification overhead. This is a
small functional sample, not a latency benchmark. The main native session
round trips took **7.55–8.22 seconds**. Near-zero peer wait times mean the file
had already arrived when verification started; they are not propagation times.

## What was real

The Go server and mounts came from Relayfile commit `5c13009a`. Each mount
used a separate VM disk, Linux filesystem notifications, HTTPS service calls,
and a listening WebSocket. No Blaxel Agent Drive or shared local filesystem
was used.

Published probe `2026.11.3` used its shipped Pi extension, real process/session
discovery, native delivery queue, and automatic final-answer transport.
Pi `@earendil-works/pi-coding-agent@1.3.0` ran in persistent PTYs. The receiving
Pi's actual `bash` tool computed each file hash. Custom sending agents used
`@relaycast/sdk@8.12.0` against the real `@relaycast/engine@8.12.0` service;
their matching answers arrived as `thread.reply` over `/v1/node/ws`.

Only model generation was replaced by a deterministic loopback endpoint that
requested the shell tool and formed an ACK from its actual result. No paid
model inference or copied model login was involved. The isolated Relayfile
server used its built-in default provider writer, which makes no external
provider mutation. This does not qualify external-provider integrations,
paid-model access, same-file conflict resolution, scale, or standby/resume.

## Setup problems resolved

1. `.json` files were silently skipped by `bl apply`; `.yaml` manifests worked.
   The accepted expiration type was `ttl-max-age`, not `ttl`.
2. Alpine plus `gcompat` could not run the glibc probe. The agent participants
   used the official `blaxel/ts-app:latest` image instead.
3. The released probe required the `relay` command prefix. The locally
   installed later beta had already dropped it.
4. Files initially converged with only filesystem scopes, but receipt reads
   failed. Adding `ops:read` and retesting in fresh private mount state resolved
   the authorization problem; earlier outboxes were retained as diagnostics.
5. The standalone server defaults to external writeback consumption. The
   isolated test needed `RELAYFILE_EXTERNAL_WRITEBACK=false` so its built-in
   worker could settle operations. Both final outboxes drained to zero.
6. Raw agent-token connections to `/v1/ws` failed with 401. The SDK's direct-node
   transport established the intended real-time path. The verifier also needed
   to accept threaded automatic answers and reject stale replayed rounds.
7. Long-running processes started with keep-alive and an implicit timeout were
   killed after 600 seconds. Explicit `timeout: 0` was required for the service,
   model fixture, probe, session supervisor, and mount. The packaged-helper
   checks passed after correcting those supervisors.

No Relayfile or probe source changes were needed. The skill's file helper also
passed local binary/mutation, absence, negative-deadline, and path-confinement
checks. The skill structure validator passed.
