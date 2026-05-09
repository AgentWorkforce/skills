---
name: setting-up-relayfile
description: Use when an agent or human needs to set up relayfile end-to-end so agents can read and write provider files through a local mount. Covers `relayfile setup` for Notion, Linear, Slack, and GitHub, the cloud-login and Nango OAuth flow, mount verification, `RELAYFILE_LOCAL_DIR` handoff, writeback status and retry commands, and key May 2026 cloud-mount gotchas.
---

# Setting Up Relayfile (Mount + Writeback for Agents)

## Overview

Relayfile mounts a provider (Notion, Linear, Slack, GitHub, and other adapter-backed integrations) as ordinary files on disk so an agent can read and write through the filesystem instead of calling APIs. This skill is the canonical setup recipe. Follow it top-to-bottom for first-time setup; jump to **Recovering from breakage** if a working mount has gone wrong.

## When to use this skill

- An agent needs read access to a provider (e.g., "summarize this Notion database").
- An agent needs to write back to a provider (e.g., "post a review on this Notion page", "update this Linear issue").
- A human is setting up a mount before delegating work to an agent.
- A mount stopped reflecting changes and you need to diagnose where.

## What you get

After setup, files appear under `<local-dir>/<provider>/...`:

```
~/relayfile-mount/notion/
├── databases/
│   ├── <slug>--<id>/
│   │   ├── metadata.json     ← database schema (read-only)
│   │   └── pages/
│   │       ├── <slug>--<id>.json     ← page metadata
│   │       └── <slug>--<id>/
│   │           ├── content.md        ← page body (READ + WRITE)
│   │           └── blocks/<id>.json  ← raw Notion block tree
└── pages/                            ← top-level pages (not in a database)
```

Read = `cat`. Write = overwrite, create, or remove files in writable adapter resource directories. The mount daemon picks up the change, queues a writeback, and the cloud delivers to the provider's API.

## Prerequisites

- Recent `relayfile` CLI on `$PATH`. Verify: `relayfile --help` should list `setup`, `integration`, `writeback` subcommands.
- A modern macOS or Linux shell with `jq` for JSON inspection. AWS CLI access is optional and only needed for internal cloud log diagnostics.
- Network access to `agentrelay.com/cloud` (cloud control plane), `api.relayfile.dev` (relayfile API), `connect.nango.dev` (OAuth).

## Step 1 — Run setup (interactive happy path)

```bash
relayfile setup \
  --provider notion \
  --workspace my-agent \
  --local-dir ~/relayfile-mount \
  --no-open
```

What this does, in order:

1. **Cloud login.** Opens a localhost callback server, prints a URL to `agentrelay.com/cloud/api/v1/cli/login?...`. You complete the login in the browser; the cloud redirects back to `127.0.0.1:<port>/callback` with an access token. The CLI stores cloud credentials in `~/.relayfile/cloud-credentials.json` and the active Relayfile workspace token in `~/.relayfile/credentials.json`.
2. **Workspace create.** POSTs `/api/v1/workspaces` with `{"name": "my-agent"}`. Returns `{ workspaceId: "rw_<8hex>", relaycastApiKey, relayfileUrl, ... }`. The workspace ID is the prefix-style `rw_*` format — not a UUID.
3. **Integration connect.** Mints a Nango Connect URL like `https://connect.nango.dev/?session_token=nango_connect_session_<hash>` and opens it (or prints, with `--no-open`). You complete the provider's OAuth there. Nango fires a webhook back to the cloud, which inserts a row into `workspace_integrations` and queues an initial sync.
4. **Initial sync.** The cloud nango-sync-worker pulls page metadata + content from the provider and writes it to relayfile. Takes ~30s for a small workspace.
5. **Mount.** Starts a local daemon that polls `api.relayfile.dev/v1/workspaces/<id>/sync/status` every 30s and reflects changes into `<local-dir>/<provider>/`.

**Use `--no-open` if you're an agent**: the wizard otherwise tries to open a browser, which usually fails in headless environments and burns the OAuth state.

## Step 2 — Verify the mount is healthy

```bash
relayfile status my-agent
```

Healthy output:
```
workspace rw_xxxxxxxx (my-agent)   mode: poll   lag: 4s

local mirror: /Users/you/relayfile-mount
daemon: running (pid 12345)

  notion       ready    214 files    last event 2s ago

pending writebacks: 0    failed: 0    dead-lettered: 0
```

What each row means:

- `lag: <N>s` — how stale the mirror is relative to the cloud. >60s means investigate.
- `daemon: not running` — the mount poller exited. Start it with `relayfile mount my-agent ~/relayfile-mount &`.
- `pending writebacks` — local writes queued for upload. Should drain to 0 within ~30s.
- `failed` — lifetime counter of non-2xx responses from the cloud's PUT endpoint. **Informational; don't gate on this.**
- `dead-lettered` — count of writebacks that exhausted retries and got persisted under `<local-dir>/.relay/dead-letter/<opId>.json`. **Gate on this.**

If `dead-lettered > 0`, see **Recovering from breakage** below.

## Step 3 — Hand off to an agent

Two patterns, depending on where the agent runs:

### Pattern A: local agent (Claude Code, scripts, Cursor)

The agent reads files directly:

```bash
export RELAYFILE_LOCAL_DIR=~/relayfile-mount
# point Claude Code at the dir or `cd` in
```

Mental model for the agent: ordinary files. Use `Read`, `Write`, `Edit`, `Glob`, `Grep` — same as any project directory. Writes propagate within ~30s.

### Pattern B: remote agent / SDK access (no disk mirror)

Use `@relayfile/sdk` against the workspace token:

```ts
import { RelayFileClient } from "@relayfile/sdk";

const token = process.env.RELAYFILE_TOKEN;  // from ~/.relayfile/credentials.json
const client = new RelayFileClient({ token, server: "https://api.relayfile.dev" });

// Read
const file = await client.getFile("rw_xxxxxxxx", "/notion/pages/xxx/content.md");

// Write — triggers writeback automatically
await client.putFile("rw_xxxxxxxx", "/notion/pages/xxx/content.md", {
  content: "# New body\n\n…",
  contentType: "text/markdown",
});
```

The token issued by `relayfile setup` carries (as of May 2026): `fs:read`, `fs:write`, `sync:read`, `sync:trigger`, `ops:read`. The last two were added so agents can introspect the writeback pipeline (`relayfile pull`, `relayfile ops list`, `GET /v1/workspaces/<id>/ops/<opId>`).

## Step 4 — Verify writeback works (optional but recommended)

Skip-able if the agent only reads. Required if the agent will write.

1. Pick a throwaway page in the provider.
2. Write a marker:
   ```bash
   echo "[writeback test $(date -u +%FT%TZ)]" > ~/relayfile-mount/notion/pages/<throwaway-page>/content.md
   ```
3. Wait 30s.
4. Open the provider's web UI; the marker should appear.
5. Run `relayfile writeback status` — `dead-lettered` should still be 0.

If the marker doesn't appear in step 4, see **Recovering from breakage**.

## Discover writeback contracts before writing

Do not guess writeback shapes and do not use a magic `new.json` filename. Current relayfile adapters ship discovery documents for writable resources:

- First check which writeback contract the mounted workspace exposes. Run `find "$RELAYFILE_LOCAL_DIR" \( -name '.adapter.md' -o -name '.schema.json' -o -name 'new.json' \) | head -40`. If discovery files are absent and `new.json` templates are present, the mounted workspace is still on the pre-file-native adapter bundle; do not apply the create-by-filename flow until the cloud/adapter deployment has refreshed that workspace.
- Read the provider `.adapter.md` first. In mounted workspaces this may appear under the provider tree or under `<local-dir>/discovery/<provider>/.adapter.md`; if unsure, run `find "$RELAYFILE_LOCAL_DIR" -path '*/.adapter.md'`.
- Read the resource `.schema.json` before writing JSON. It is JSON Schema draft 2020-12 for the full synced record. Fields with `"readOnly": true` are server-managed and must not be written. Common schema paths are resource-local, such as `/linear/issues/.schema.json`; packaged adapters also carry a discovery copy under `discovery/<provider>/...`.
- For creates, start from the sibling `.create.example.json`. The create example intentionally omits read-only fields.
- For edits, write only mutable fields to a canonical `<id>.json`; omitted fields are left alone.
- For creates, write a valid JSON document to any non-canonical filename in the resource directory, such as `draft-message.json` or `create issue.json`. The adapter creates the provider record at the real `<id>.json` and rewrites the draft file as a receipt/pointer.
- For deletes, remove the canonical `<id>.json` only when the resource's `.adapter.md` says delete is supported.

The `<id>` pattern is resource-specific. A Linear issue ID is a UUID; a Slack message ID is a timestamp-like token; GitHub and many CRM IDs are integers. The `.adapter.md` ID pattern section is the source of truth for whether a filename routes to PATCH/DELETE or CREATE.

## Path conventions per provider

| Provider | Read paths | Write paths |
|---|---|---|
| Notion | `/notion/pages/<slug>--<id>/content.md`, `/notion/databases/<id>/pages/.../content.md`, `<slug>.json` (metadata) | same paths overwrite the body / properties |
| Slack | `/slack/channels/<id>/messages/` plus `.adapter.md` / `.schema.json` discovery | create by writing a valid message JSON to `/slack/channels/<id>/messages/<non-canonical>.json`; edit/delete canonical message files when supported |
| Linear | `/linear/issues/<id>.json`, comments under issue resources, plus `.adapter.md` / `.schema.json` discovery | create by writing a valid issue/comment JSON to a non-canonical filename; edit/delete canonical issue files when supported |
| GitHub | `/github/repos/<owner>/<repo>/pulls/<n>/metadata.json`, `files.json`, plus `.adapter.md` / `.schema.json` discovery | create a review by writing the review JSON to a non-canonical file under the reviews resource |

`new.json` is not special in the file-native adapter contract. If a current `.adapter.md` and `.schema.json` are present, translate older examples using `/messages/new.json` or `/comments/new.json` to "write the create payload to any non-canonical filename in the resource directory." If the live mount only exposes `new.json`, treat that as an older deployment surface and follow the mounted template or wait for the workspace to refresh onto the new adapter version.

`<local-dir>/.relay/` is reserved — never write there. Anything you put under it gets ignored or treated as daemon state.

## Adding more integrations after setup

```bash
relayfile integration connect linear --workspace my-agent
relayfile integration connect slack  --workspace my-agent
relayfile integration list           --workspace my-agent
```

Each provider gets its own subtree under `<local-dir>/`. Disconnect with `relayfile integration disconnect <provider>` — leaves a marker at `.relay/disconnected/<provider>.json` and removes the provider's tree from the mirror.

## Common gotchas

### G1 — Cold-start 500 on workspace create

`POST /api/v1/workspaces` sometimes 500s on the first call after the cloud Lambda has been idle. Retry once before doing anything diagnostic. **Verified May 2026**: same call succeeded immediately on retry.

If it 500s twice in a row, check `aws logs tail /aws/lambda/clou-production-AgentRelayCloudWebServerUseast1Function-<suffix> --since 5m --follow` for the actual stack trace.

### G2 — OAuth callback timing trap

The wizard prints the cloud-login URL, opens a localhost callback server, then waits. If you complete the login *after* the wizard has timed out (or if you click the callback URL by hand later), the redirect-to-localhost won't load — that's expected. The login already completed; the wizard just isn't listening anymore. Re-run `relayfile setup` from scratch.

Same trap on the Nango Connect URL: it has a ~30 minute TTL. If the wizard exited and you click it later, you may need to mint a fresh one:

```bash
curl -sS -X POST "https://agentrelay.com/cloud/api/v1/workspaces/<id>/integrations/connect-session" \
  -H "Authorization: Bearer $(cat ~/.relayfile/credentials.json | jq -r .token)" \
  -H "Content-Type: application/json" \
  -d '{"allowedIntegrations":["notion"]}'
```

### G3 — Workspace ID format

Workspaces created by the productized cloud-mount flow are `rw_<8hex>`. Older workspaces (and most internal API surfaces) use UUIDs. Most schema columns still type `workspace_id` as `uuid` — see `docs/architecture/workspace-id-unification.md` in the cloud repo for the broader migration. **For this skill: don't substitute a UUID workspace id when the CLI gave you `rw_*`.** They are not interchangeable.

### G4 — Mount mirror dir conventions

```
<local-dir>/
├── <provider>/...                     ← actual files
├── .relay/
│   ├── state.json                     ← daemon's live state (workspaceId, lag, counters, remoteRoot)
│   ├── integrations/<provider>.json   ← per-integration metadata
│   ├── dead-letter/<opId>.json        ← failed writebacks (Phase 1 dead-letter)
│   ├── disconnected/<provider>.json   ← marker after `integration disconnect`
│   └── conflicts/<resolved-conflicts>
└── .relayfile-mount-state.json        ← sync revisions per file
```

The `dead-letter` dir is the agent's primary debugging surface for stuck writebacks. Each file is a JSON record with `{ opId, path, attempts, lastStatus, lastBody, ts }`.

## Recovering from breakage

### Symptom: file edits don't appear in the provider

Run:

```bash
relayfile writeback status my-agent --json | jq
```

Three cases:

**Case 1 — `dead-lettered` is non-empty.**
The mount tried, retried, gave up. Inspect the dead-letter records:

```bash
ls ~/relayfile-mount/.relay/dead-letter/
cat ~/relayfile-mount/.relay/dead-letter/op_*.json | jq '{opId, path, lastStatus, lastBody, attempts}'
```

`lastStatus` tells you what the cloud rejected with. `lastBody` is truncated to 1KB. Once you've fixed the underlying issue (e.g. the file had bad JSON properties, or the page was archived in the provider), retry:

```bash
relayfile writeback retry --opId <opId> my-agent
```

The dead-letter file gets removed if the retry succeeds.

**Case 2 — `pending` is non-zero and not draining.**
The daemon enqueued a writeback but isn't getting through to the cloud. Check the daemon log:

```bash
relayfile logs my-agent | tail -40
```

Look for `WARN writeback request failed` lines (Phase 1 logging contract). Most common cause: token expired. Fix:

```bash
relayfile login --server https://agentrelay.com/cloud
```

then re-run mount.

**Case 3 — counts are zero but provider isn't updating.**
The write didn't make it past the local file system into the daemon's queue. Verify:

- File mtime updated (`stat <file>`)
- Daemon is actually running (`pgrep -fl "relayfile mount"`)
- Path is under a writable subtree (e.g. `content.md` paths are write-enabled; `metadata.json` paths sometimes aren't, depending on the adapter)

If the daemon exited, restart:

```bash
relayfile mount my-agent ~/relayfile-mount &
```

### Symptom: `relayfile setup` hangs at "Connect notion: <URL>"

The wizard is polling the cloud's `/integrations/<provider>/status` endpoint waiting for OAuth to complete. Either:

- Open the URL and complete the OAuth (the wizard will detect and proceed within ~5s of the Nango webhook firing).
- Cancel with Ctrl-C and run `relayfile integration connect notion --workspace my-agent --no-open` separately so the wizard isn't blocked on the OAuth step.

### Symptom: `relayfile writeback status` exits non-zero but I don't see why

The CLI exit code is non-zero only when there are **dead-lettered ops** (not just because the lifetime `failedWritebacks` counter is non-zero — that's by design as of May 2026). Run with `--json` and look at `deadLettered.length`. If it's 0, the non-zero exit is a regression — file a bug.

## Cleaning up

When you're done with a mount and want to tear down:

```bash
# 1. stop the daemon
relayfile stop my-agent

# 2. disconnect each integration (revokes OAuth, removes <provider>/ tree)
relayfile integration disconnect notion --workspace my-agent --yes

# 3. remove the local workspace registration
relayfile workspace delete my-agent --yes

# 4. delete the mirror dir
rm -rf ~/relayfile-mount
```

The cloud-side workspace persists indefinitely — there's no public DELETE endpoint as of May 2026. It's an inert orphan.

## What this skill does NOT cover

- **Self-hosted relayfile** (running your own `relayfile-server` Go binary against a private Nango). For most agent use-cases the managed cloud at `agentrelay.com` is the right choice; self-hosted is for environments where data residency rules out the cloud.
- **Multi-workspace agents.** A single agent talking to multiple workspaces simultaneously needs careful token handling that's out of scope here.
- **GitHub-via-relayfile** for source code. The GitHub adapter exists but the productized cloud-mount workflow is heavier-weight than `git clone`; only use it if the agent specifically benefits from filesystem-shaped access to PR metadata, reviews, etc.

## Quick reference

| Command | Purpose |
|---|---|
| `relayfile setup --provider <p> --workspace <name> --local-dir <path>` | First-time setup |
| `relayfile status <workspace>` | Health overview |
| `relayfile mount <workspace> <local-dir>` | Restart the daemon |
| `relayfile stop <workspace>` | Stop the daemon |
| `relayfile integration list --workspace <name> --json` | List connected providers |
| `relayfile integration connect <provider> --workspace <name>` | Add another provider |
| `relayfile integration disconnect <provider> --workspace <name> --yes` | Remove a provider |
| `relayfile tree <workspace> <path>` | Live cloud-side directory listing |
| `relayfile read <workspace> <path>` | Live cloud-side file read |
| `relayfile writeback status <workspace> [--json]` | Pending / failed / dead-lettered counts |
| `relayfile writeback retry --opId <op> <workspace>` | Re-enqueue a dead-lettered op |
| `relayfile pull --workspace <name>` | Force a refresh from provider |
| `relayfile ops list --workspace <name> --json` | Cloud-side operation log |
| `relayfile workspace delete <name> --yes` | Remove from local registry |
