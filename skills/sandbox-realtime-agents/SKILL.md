---
name: sandbox-realtime-agents
description: Connect agents in E2B, Freestyle, or Maritime sandboxes using Relayfile filesystem mirrors and native Agent Relay probes; verify file convergence and real session replies, then benchmark confirmed sync time.
---

# Realtime files and agent messaging across sandboxes

Use one Relayfile workspace for replicated files and one Agent Relay messaging
workspace for session communication. Each sandbox has an independent local disk,
a materialized mirror, and a native probe. Shared drives are not required.

## Choose the requested provider

Read only the relevant setup reference:

- [E2B](references/e2b.md): official command-line lifecycle, execution and piped
  file transfers; qualified on three independent sandboxes.
- [Freestyle](references/freestyle.md): official command-line lifecycle,
  execution, file copying and HTTPS routes; qualified on three independent VMs.
- [Maritime](references/maritime.md): official command-line setup and the exact
  billing gate encountered. Runtime integration and benchmarks remain unverified.

Then read [runtime setup](references/runtime.md) for Relayfile and native probes,
and [verification](references/verification.md) before reporting success.
The [benchmark report](references/benchmarks.md) separates measured results from
provider differences and untested behavior.

For Blaxel, use the separately available `blaxel-realtime-agents` skill.

## Scope and credentials

Honor the user's existing authorization. A concrete integration/benchmark task
can cover necessary disposable nonproduction services and test files; tool
bootstrap alone does not authorize cloud resources or project edits. Preserve
any separately reserved approvals for credentials, billing, access, production,
or destructive changes.

Use existing command-line sign-in or securely supplied environment credentials.
Never ask for secrets in chat, print token values, or copy account credentials
into sandboxes. Read-only status and an authenticated listing establish account
access, not sandbox-creation entitlement. Within an authorized nonproduction
task, verify one bounded create before proceeding; billing gates remain human-owned.

Open the official browser approval flow when necessary. Account creation, plan
activation, payment details and workspace access changes stay with the human
unless specifically authorized. A `plan_required` error is a billing gate, not
a reason to mint keys, invent a workspace, or use another person's resources.

Private runtime bundles belong in a 0700 owner-only directory outside the shared
tree, with 0600 credential files. Generate isolated fixture credentials only when authorized.
Transfer them through the authenticated file channel; keep values out of argv,
logs, transcripts and evidence. Do not expose an account key to a coding agent.

Record every exact resource ID immediately upon creation, including ingress
rules. Bound lifetimes where supported. Delete only session-owned disposable
resources by their recorded exact IDs, one at a time, and verify cleanup. Never
kill a provider's whole sandbox list or reassign an existing name/slug.

## Qualification and measurement

Create a real supported coding session, discover it through the native probe,
and register the returned target. Do not fabricate session registries or use
a synthetic message responder as proof of native session delivery. The isolated
test used a deterministic loopback model to request real `bash`/`sha256sum`
execution by Pi; model generation was synthetic, sessions and tools were real.

Verify bidirectional hashes and correlated replies, restart/catch-up, uploads
after restart, confirmed deletes and recreation, and final receipt settlement.
Listening processes and a connected roster are insufficient evidence.

Use the [file probe](scripts/file-probe.py) and
[message probe](scripts/message-probe.mjs) for bounded checks. Preserve mount
runtime state and unsettled outboxes. Files under `.relay` are not test data.

When benchmarking, use the retained [runtime harness](scripts/benchmark/peer.py)
and [cell driver](scripts/benchmark/cell.py). Start one clock immediately before
the writer's file operation; stop it when a matching full peer SHA-256 ACK
returns. Report that acknowledgement overhead, sample counts, warmups, failures,
payload entropy, resource sizes, placement and exact versions. Preserve raw
samples. Do not call it pure one-way latency, throughput, an SLA, or a controlled
provider ranking when environments differ.
