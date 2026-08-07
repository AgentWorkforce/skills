---
name: multi-host-live-mount
description: Use when one Relayfile workspace must be mounted on several machines at once and an agent is placed on a remote host to work inside that live-mounted tree with nothing cloned. Covers what the placed agent sees, repo surfaces vs provider surfaces, per-node credentials and path scopes, joining an existing workspace with `relayfile workspace join`, composing fleet enrollment with placement, and — above all — proving the remote mirror is actually current, because a live daemon pid, a `lag: 0s` status line, and presence in `agent-relay fleet nodes` are all false positives.
---

# One Workspace, Many Hosts, Nothing Cloned

Take a fresh machine to a state where it mounts an **existing** Relayfile
workspace, joins the fleet, and hosts a placed agent that does its work inside
the live-mounted tree — no `git clone`, no copy of the data.

This skill is the composition of three primitives that are documented
separately and lie to you when combined:

| Primitive | Owning skill | What it does NOT tell you |
|---|---|---|
| `relayfile setup` / mount | `setting-up-relayfile` | how a **second** host joins a workspace that already exists |
| `agent-relay fleet` enroll / spawn | `orchestrating-agent-relay` | whether the node's **mount** is current |
| mount layout / `LAYOUT.md` | `workspace-layout` | that the file you just read may be days stale |

**The load-bearing section is [Proving the mirror is current](#proving-the-mirror-is-current).**
Everything before it is setup. If you read one section, read that one.

## The model

- **One workspace, many mirrors.** A workspace (`rw_<8hex>`) lives in the
  cloud. Each host runs its own `relayfile-mount` daemon projecting some
  **scope** of that workspace into a local directory. The cloud is the single
  writer of record; every local tree is a **cache**.
- **A mirror is a cache, and caches go stale silently.** There is no
  self-healing guarantee and no loud failure. A mount daemon can be alive,
  connected, and reporting `lag: 0s` while serving two-day-old bytes. Verified
  live — see [the observed failure](#the-observed-failure-daemon-alive-lag-0s-two-days-stale).
- **Hosts are not symmetric.** Two hosts mounting the same workspace routinely
  hold *different* scopes, *different* credentials, and *different* write
  permissions. "Host B sees what host A sees" is a claim to test, never assume.
- **Placement and mounting are independent.** `agent-relay` places an agent
  onto a node. `relayfile` mounts data on that node. Neither checks the other.
  A perfectly placed agent on a node with a dead mount fails in the most
  confusing way available: it reads plausible, wrong, old files and never errors.

```text
                    cloud workspace rw_7ccfea89          ← single source of truth
                   /            |            \
        host A (--write)   host B (ro)   host C (ro, /linear only)
        /linear /github    /digests       scoped mirror
        creds: node-A      creds: node-B  creds: node-C
             ↑                  ↑              ↑
        placed agent       placed agent   placed agent
        works in-tree      works in-tree  works in-tree
```

## Verified against

| Component | Version |
|---|---|
| `relayfile` | 0.10.39 |
| `agent-relay` | 11.4.2 |

Re-verify with `relayfile --version` / `agent-relay --version`; probe the
installed binary rather than trusting this table, since flags have moved before.

## Repo surface vs provider surface

The most common wrong turn is mounting the wrong kind of thing. Decide first:

| | **Repo surface** (git) | **Provider surface** (relayfile mount) |
|---|---|---|
| Holds | source code, tests, build config | Linear issues, GitHub PR metadata, Notion pages, Slack messages, digests |
| Get it by | `git clone` / worktree | `relayfile workspace join` + `relayfile mount` |
| Write by | commit + push + PR | writing a file in a writable resource dir → writeback |
| Consistency | explicit fetch; staleness is visible in `git status` | **implicit poll; staleness is invisible** |
| Multi-host | every host has a full independent copy | every host has a partial, scoped, possibly-stale cache |

**Do not mount source code.** The GitHub adapter surfaces PR/review *metadata*,
not a working tree. An agent that must compile, test, or edit code needs a real
checkout. An agent that must read a Linear issue, comment on a PR, or summarize
a Notion page needs the mount, and cloning nothing is the correct outcome.

A "nothing cloned" host is therefore only coherent when the agent's work is
entirely **provider-surface** work. State that in the task prompt, because an
agent that discovers it needs source will otherwise clone one silently and
diverge from the design.

## Step 1 — Join the existing workspace (the second-host primitive)

`relayfile setup` **creates** a workspace. On host two through host N you must
not run it — you will end up with two workspaces and a mystery about why the
hosts disagree. The primitive is `join`:

```bash
relayfile workspace join WORKSPACE_ID [--name NAME] [--write]
```

```bash
# On the fresh machine, after `relayfile login`:
relayfile login --server https://agentrelay.com/cloud   # or --api-key for self-hosted
relayfile workspace join rw_7ccfea89 --name shared-ws    # read-only by default
relayfile workspace list                                  # '*' marks the active one
relayfile workspace current --verbose
```

- **`--write` is opt-in and it is the whole permission model for this host.**
  Omit it and the host mirrors read-only; writes never become provider
  mutations. Grant it only to hosts whose agents are meant to mutate providers.
- `WORKSPACE_ID` is the `rw_<8hex>` form. Do not substitute a UUID — most
  internal surfaces use UUIDs for the same workspace and they are not
  interchangeable (see `setting-up-relayfile` G5).
- Joining registers the workspace locally in `~/.relayfile/workspaces.json`. It
  does **not** start a mount.

## Step 2 — Mount a scope, with this node's own credentials

```bash
relayfile mount rw_7ccfea89 /path/to/mirror --background
relayfile status rw_7ccfea89
```

That is the simple form. Real multi-host deployments run the scoped form. This
is the actual argv of a live production mount (secrets elided) — it is the
shape to copy:

```text
relayfile-mount
  --base-url    https://file.agentrelay.com
  --workspace   rw_7ccfea89
  --local-dir   /Users/you/Projects/thing/senses
  --local-layout scoped
  --creds-file  /Users/you/Projects/thing/.agentworkforce/relayfile/<node>-mount.json
  --state-dir   /Users/you/Projects/thing/.agentworkforce/relayfile/state
  --mode        poll
  --interval    30s
  --websocket=true
  --remote-path /linear
  --remote-path /github
  --remote-path /notion
  --remote-path /digests
```

The four flags that make multi-host work:

- **`--remote-path` (repeatable) — the node's scope.** Each occurrence adds one
  subtree to this host's projection. A host that only needs Linear mounts
  `/linear` and never materializes the rest. This is the main lever for keeping
  a mirror small enough to actually stay current.
- **`--creds-file` — this node's credential, not the human's.** Per-node
  credentials live under `~/.relayfile/delegated/<shard>/<id>.json` (with
  `.lock` siblings). Scoping credentials per node means revoking one host does
  not disturb the others.
- **`--state-dir` — per-mount sync state.** Two mounts sharing a state dir
  corrupt each other's revision tracking. One state dir per mount, always.
- **`--local-layout scoped`** — lay the tree out to match the scope rather than
  the full workspace root.

> **Credential hazard, observed live.** Broker-spawned agents receive
> `rk_live_…` workspace keys and `at_live_…` agent tokens **as command-line
> arguments**, which makes them readable by any local user via `ps auxww`. On a
> shared or multi-tenant host, treat every token handed to a placed agent as
> disclosed. Prefer per-node delegated credentials with the narrowest scope, and
> rotate anything that has appeared in a process listing or a transcript.

### Scope and write-permission are per host — check, don't assume

```bash
relayfile integration list --workspace rw_7ccfea89 --json    # which providers this host sees
pgrep -fl relayfile-mount                                    # which --remote-path scopes are live
```

A file being absent on host B may mean it does not exist, or may mean host B
simply does not mount that scope. Those are different bugs. Distinguish them
with a cloud-side read (`relayfile tree`), which is scope-independent.

## Proving the mirror is current

This is the section that matters.

> **`lag: 0`, `pending: 0`, a live daemon process, and a `.relay/state.json`
> whose mtime is ticking *right now* are all simultaneously compatible with
> content that is days stale. Every one of those signals measures the daemon's
> own activity, not the freshness of the bytes it serves. Only a
> content-level assertion — comparing mounted content against a fact you know
> to be true at this moment — proves currency.**

The daemon can poll forever, rewrite its state file every 30 seconds, report
zero lag and zero pending writebacks, and never reconcile a single content file.
That is not a hypothetical; it is [the observed
failure](#the-observed-failure-every-health-signal-green-content-days-stale).

### What is NOT proof

Every one of these was true on a host serving two-day-old content:

| Non-proof | Why it fails |
|---|---|
| `pgrep -fl relayfile-mount` returns a pid | Proves a process exists. Says nothing about whether its last sync cycle succeeded. |
| `relayfile supervisor status` | Independent of mount health, and often not installed at all — a healthy mount here reported `Could not find service "com.relayfile.listen"`. |
| `relayfile status` shows **`lag: 0s`** | **The single most dangerous false positive.** Observed printing `lag: 0s` for *every* provider simultaneously — including one flagged `lagging  reason: no sync cursor or watermark` and one whose last event was 1486 hours earlier. `lag: 0s` is not a measurement of mirror freshness. |
| `pending writebacks: 0` | That is the **outbound** queue. It says nothing about inbound freshness. |
| `.relay/state.json` mtime is seconds old | **The most seductive non-proof**, because it looks like liveness with a timestamp. Measured on the stale host: all four per-provider `state.json` files rewritten within ~4 minutes of the check, while the newest actual content file was 1h31m old and `digests/today.md` was two days old. The daemon writes its state file every cycle whether or not the cycle reconciled anything. |
| Some content files updated recently | Partial reconciliation is the norm in this failure. On the stale host, 9 content files had changed within 3h — and `today.md`, the file that changes most, had not moved in two days. Freshness is per-path, never global. |
| Node appears in `agent-relay fleet nodes` | Fleet registration is about the relay node, not the mount. Disjoint subsystems. |
| Node shows `status: online`, `live: true` | Registration fields, not liveness of the mount. |
| The file you read had plausible content | Stale files are perfectly well-formed. That is the entire problem. |

### What IS proof

Two assertions. Run both.

#### Assertion A — `mirror-matches-cloud` (read-side currency)

`relayfile tree` is a **live cloud-side** listing carrying authoritative
`revision`, `size`, and `updatedAt` per file. Compare it against the bytes on
local disk: the cloud is the oracle, the local daemon is the thing under test.

**First, the trap that makes a naive version of this assertion pass by
omission.** `relayfile tree` is paginated, and the pagination is not usable:

| Call | File rows returned |
|---|---|
| `tree /linear --depth 20` | **100** |
| `tree /linear --depth 3` | **325** |
| `tree /linear --depth 3 --json` | **596** entries, plus `nextCursor` |
| files actually present locally under `/linear` | **3072** |

- Deeper `--depth` returned *fewer* rows — a per-response row cap interacts with
  traversal, so a high `--depth` is actively worse.
- The **human-readable form truncates silently.** Only `--json` reveals the
  `nextCursor` field that tells you the listing was incomplete.
- **`--cursor` is not implemented** (`error: flag provided but not defined:
  -cursor`). The CLI hands you a cursor it cannot consume, so a single `tree`
  call is a **page, not a tree**.

The workaround is to narrow the path instead of deepening it: walk directory by
directory at `--depth 1`, and **report coverage** so a partial verification can
never read as a clean pass.

```bash
#!/usr/bin/env bash
# assert-mirror-current.sh — read-side currency proof, coverage-explicit.
# usage: assert-mirror-current.sh <workspace> <local-mirror-dir> <remote-scope>
set -uo pipefail
WS="${1:?workspace}"; MIRROR="${2:?local mirror dir}"; SCOPE="${3:-/}"

python3 - "$WS" "$MIRROR" "$SCOPE" <<'PY'
import json, os, subprocess, sys
ws, mirror, scope = sys.argv[1], sys.argv[2].rstrip('/'), sys.argv[3]

def page(path):
    """One cloud-side page. `tree` returns nextCursor but the CLI has no
    --cursor flag, so a page is all you get for this path."""
    r = subprocess.run(["relayfile", "tree", ws, path, "--depth", "1", "--json"],
                       capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        return [], None, r.stderr.strip()[:120]
    try:
        d = json.loads(r.stdout[r.stdout.index('{'):])
    except (ValueError, json.JSONDecodeError) as e:
        return [], None, f"unparseable: {e}"
    return d.get("entries", []), d.get("nextCursor"), None

match = stale = missing = 0
bad, truncated, errors = [], [], []
queue, seen = [scope], set()

while queue:
    path = queue.pop(0)
    if path in seen:
        continue
    seen.add(path)
    entries, cursor, err = page(path)
    if err:
        errors.append((path, err)); continue
    if cursor:
        truncated.append(path)          # this directory was NOT fully listed
    for e in entries:
        p, typ = e.get("path"), e.get("type")
        if typ == "dir":
            queue.append(p); continue
        if typ != "file":
            continue
        size, rev = e.get("size"), e.get("revision")
        lp = mirror + p
        if not os.path.exists(lp):
            missing += 1; bad.append(("MISSING", p, size, None, rev))
        elif os.path.getsize(lp) == size:
            match += 1
        else:
            stale += 1; bad.append(("STALE", p, size, os.path.getsize(lp), rev))

checked = match + stale + missing
local_total = sum(len(f) for _, _, f in os.walk(mirror + scope)) if os.path.isdir(mirror + scope) else 0
ok = not (stale or missing or truncated or errors)

print(f"ASSERT mirror-matches-cloud: {'PASS' if ok else 'FAIL'}")
print(f"  checked={checked} match={match} stale={stale} missing={missing}")
print(f"  coverage: {checked} cloud files verified; {local_total} files exist locally under {scope}")
if truncated:
    print(f"  INCOMPLETE: {len(truncated)} dir(s) returned nextCursor and were only "
          f"partially listed — currency NOT proven for them: {truncated[:3]}")
if errors:
    print(f"  ERRORS: {errors[:3]}")
for b in bad[:10]:
    print("   ", b)
sys.exit(0 if ok else 1)
PY
```

Non-zero exit ⇒ **the mirror is not current; do not place an agent on this
host.** Read the `coverage:` line every time — `checked` far below the local
file count means you verified a corner of the tree, not the tree.

The walk is serial and one HTTP call per directory, so a deep scope (`/github`,
`/linear`) takes minutes. Run it against the **scope the agent will actually
read**, not the whole workspace. For a byte-exact check on one file that matters:

```bash
diff <(relayfile read "$WS" /digests/today.md) "$MIRROR/digests/today.md" && echo CURRENT
```

#### Assertion B — `cross-host-write-visible` (the real end-to-end proof)

Read-side currency on one host does not prove two hosts agree. The only proof
that host A and host B share one live workspace is a **write on A observed on
B**, through the cloud, within a bounded time.

Direction matters: run it **both ways**, because `--write` is per host and an
asymmetric grant is invisible until you test the direction that lacks it.

```bash
# ---- on HOST A (the writer; must have joined with --write) ----
MARK="xhost-$(date -u +%Y%m%dT%H%M%SZ)-$$"
echo "$MARK" > "$MIRROR_A/<writable-resource-dir>/probe-$MARK.json"   # or a scratch page body
relayfile writeback status "$WS" --json | jq '{pending, deadLettered: (.deadLettered|length)}'
echo "marker: $MARK"

# ---- on HOST B (the reader) — bounded poll, never an unbounded wait ----
MARK="<paste from host A>"
for i in $(seq 1 12); do            # 12 × 10s = 120s ceiling
  if grep -rqF "$MARK" "$MIRROR_B" 2>/dev/null; then
    echo "ASSERT cross-host-write-visible: PASS after ~$((i*10))s"; break
  fi
  [ "$i" = 12 ] && { echo "ASSERT cross-host-write-visible: FAIL (120s)"; }
  sleep 10
done
```

Rules that make this assertion honest:

- **Bound the wait.** An unbounded poll turns a failed assertion into a hang,
  which reads as "still working" instead of "broken."
- **Use a unique marker per run.** A previous run's marker still on disk turns
  the assertion into a tautology that always passes.
- **Write into a resource the adapter actually accepts**, discovered from
  `.adapter.md` / `.schema.json` (see `writeback-as-files`). Never write under
  `<local-dir>/.relay/` — it is reserved daemon state.
- **Prefer a throwaway record.** This probe emits a *real provider mutation*.
  Do not aim it at a live issue, page, or channel that people read.
- **A pass proves the pair, at that moment, for that scope.** It is not
  transitive: A↔B passing says nothing about host C, which may mount a
  different scope entirely.

> In harnessed environments a bare foreground `sleep` in a wait loop is often
> blocked. Run the poll backgrounded, or with the harness's Monitor/until-loop.

#### Assertion C — `known-true-now` (the content-level proof)

Assertions A and B compare the mount against the cloud. If the **cloud
projection itself** is behind the provider, both can pass while the agent still
reads stale reality. The only defense is to anchor on a fact you know is true
right now, independently of the mount.

Pick something whose existence you can confirm out-of-band — an issue you just
filed, a PR number you can see in the provider UI, a message you just posted —
then assert the mount contains it:

```bash
# Anchor: a GitHub issue you KNOW exists right now (confirm out-of-band first).
KNOWN=2949
NEWEST=$(ls "$MIRROR"/github/repos/<owner>__<repo>/issues/by-id/*.json 2>/dev/null \
         | xargs -n1 basename | sed 's/\.json$//' | sort -n | tail -1)
echo "newest projected: #$NEWEST | known-true-now: #$KNOWN"
[ -f "$MIRROR/github/repos/<owner>__<repo>/issues/by-id/$KNOWN.json" ] \
  && echo "ASSERT known-true-now: PASS" \
  || echo "ASSERT known-true-now: FAIL — #$KNOWN absent; projection is behind reality"
```

A gap between `newest projected` and `known-true-now` is a **projection**
failure, upstream of your mirror. Assertion A cannot see it, because local and
cloud agree — on stale data.

**Uncertified is not a verdict.** A scope you did not assert against is neither
current nor stale; it is *unknown*. Say so. Reporting "the mount is fine" on the
strength of one certified scope is the same error as `lag: 0s`, one level up.

### The observed failure: every health signal green, content days stale

Recorded on a live production host, and the reason this skill exists:

```text
$ ps -o pid,etime -p 2429        →  daemon up 3h06m               ← "healthy"
$ relayfile status rw_7ccfea89   →  mode: poll   lag: 0s          ← "healthy"
                                    pending writebacks: 0          ← "healthy"
$ find . -name state.json -mmin -5 →  all 4 provider state files   ← "healthy"
                                      rewritten minutes ago
$ relayfile supervisor status    →  service not found (never installed)

$ ./assert-mirror-current.sh rw_7ccfea89 ./senses /digests
  ASSERT mirror-matches-cloud: FAIL
    checked=80 match=78 stale=2 missing=0
    coverage: 80 cloud files verified; 84 files exist locally under /digests
     ('STALE', '/digests/this-week.md', 169047, 70301, 'rev_1553124')
     ('STALE', '/digests/today.md',      38416, 10112, 'rev_1553123')

$ stat -f%Sm senses/digests/today.md   →  Aug  5 16:07     (wall clock: Aug 7 12:58)
```

Cloud says `today.md` is ~38KB and climbing; disk holds 10,112 bytes last
written **two days earlier**. Repeated sampling showed the cloud `revision`
advancing (`rev_1553031` → `rev_1553123` → `rev_1553124`) while the local size
never moved — so this is a wedged mirror, not a sampling race.

The mount was **not idle**, which is what makes this failure so hard to see:

| Signal | Measured |
|---|---|
| all 4 per-provider `.relay/state.json` | rewritten within ~4 min of the check |
| content files changed in last 3h | 9 — but newest mtime **1h31m** old |
| `digests/today.md` | **2 days** old, cloud revision still advancing |
| `github` projection | newest projected cloud issue `#2935`; issue `#2949` known to exist and absent — the **cloud projection** is behind the provider, not just the mirror |
| `linear`, `notion` | **uncertified** — not asserted, therefore neither current nor stale |

Every status surface reported healthy throughout. An agent placed on this host
would have read a two-day-old digest, produced confident and wrong output, and
nothing would have errored.

The `github` row is the one to internalize: it is a **projection** gap, so
Assertion A would have *passed* — local and cloud agreed with each other, on
stale data. Only Assertion C catches that class. (GitHub projection gap
contributed by Chief; state-tick and content-mtime figures measured directly.)

`today.md` is also the worst possible file to have stale — the failure
concentrates in exactly the files that change most.

## Composing enrollment, placement, and the mount

Order matters. Mount **before** placing, verify **between**.

```bash
# 1. Fleet must be enabled for the workspace before a node is brought up.
agent-relay fleet enable

# 2. Enroll the fresh machine as a node (mint on control plane, redeem on node).
#    Script + authoritative README: dev-stack/fleet-node-bootstrap/ in the
#    AgentWorkforce/cloud repo — not shipped with this skill.
read -r -s -p 'Enrollment token: ' RELAY_ENROLLMENT_TOKEN; printf '\n'
trap 'unset RELAY_ENROLLMENT_TOKEN' EXIT
RELAY_ENROLLMENT_TOKEN="$RELAY_ENROLLMENT_TOKEN" \
RELAY_ENROLLMENT_URL='https://<app>/api/v1/fleet/register' \
RELAY_NODE_NAME='<node>' \
  sandbox-node-bootstrap.sh preflight && sandbox-node-bootstrap.sh enroll

# 3. Join + mount + SCOPE on that machine (Steps 1–2 above).
relayfile workspace join rw_7ccfea89 --name shared-ws     # add --write only if it must mutate
relayfile mount rw_7ccfea89 "$MIRROR" --background

# 4. GATE: prove the mirror before anything is placed here.
./assert-mirror-current.sh rw_7ccfea89 "$MIRROR" /digests || exit 1

# 5. Only now place the agent, with --cwd inside the live mount.
agent-relay fleet spawn claude --name worker-1 --node <node> --channel general \
  --task "Work inside the mounted tree at $MIRROR. Do not clone any repository."
```

> **Never skip `preflight` on a machine that already runs brokers.**
> `agent-relay node up` kills every broker whose CWD resolves to the same
> project root; a `$HOME`-rooted workdir reaps every `$HOME`-rooted broker
> (relay#1328, a real production incident). Pin `AGENT_RELAY_PROJECT` to a
> unique per-instance dir and drop a physical `.agentworkforce/relay` marker.

Step 4 is the step everyone skips. Placement succeeds against a stale mount and
reports success.

### Fleet node lists are partial — absence is not evidence

Measured on a live workspace, same binary, minutes apart:

| Query | Records | Live |
|---|---|---|
| `agent-relay fleet nodes` (default) | **3** | 3 |
| `agent-relay fleet nodes --all` | **400** (exactly, on 3/3 consecutive runs) | 20, 20, **21** |
| `agent-relay fleet nodes --all --capability spawn:claude` | 33 | 4 |

What this means in practice:

- **The default view omitted a live, spawn-capable node.** `sf-mini` was
  `status: online`, `live: true`, advertising `spawn:claude|codex|gemini|opencode`
  — and absent from the default 3. Never conclude a node is missing from the
  default view.
- **`--all` returns exactly 400 and there is no `--limit` flag.** 400 on every
  run is a server-side cap, not a coincidence. Beyond it, records are silently
  dropped. A capability-filtered query returned 33, well under the cap — which
  is why filtering is the reliable form.
- **The live subset changes between consecutive calls** (20 → 20 → 21) as
  sessions come and go, while the id set held stable across those three runs.
  Do not build logic on a node count.
- Most of the `--all` bulk is `node_direct_*` session records, not placement
  targets. `spawn:*` capability is what makes a node spawnable.

The reliable placement query, and the parse that survives the output format:

```bash
# Redirect, never pipe: output truncates at 64KB through a pipe.
agent-relay fleet nodes --all --capability spawn:claude > /tmp/nodes.raw
python3 - <<'PY'
import json, re
raw = open('/tmp/nodes.raw').read()
m = re.search(r"^\{", raw, re.M)          # skip any human-readable preamble
if not m:
    raise SystemExit("No JSON. Raw:\n" + raw[:500])
for n in json.loads(raw[m.start():]).get("nodes", []):
    if n.get("live"):
        print(n["name"], n["id"], n.get("status"),
              [c["name"] for c in n.get("capabilities", [])])
PY
```

Compare `dispatchedNodeId` from a spawn against the **`id`** (`node_…`), not the
name. And per `orchestrating-agent-relay`, dispatch recorded by the control
plane still is not execution — confirm with `pgrep` **on the target host**.

## What the placed agent sees, and what to tell it

The agent gets an ordinary directory. `Read`, `Write`, `Edit`, `Glob`, `Grep`
all behave normally, which is precisely why staleness is invisible to it.

Put this in the task prompt:

```text
You are working inside a live Relayfile mount at <MIRROR>. It is a mounted
projection of a shared cloud workspace, not a checkout.

- Do NOT clone any repository. Everything you need is in the mounted tree.
- Start at <MIRROR>/LAYOUT.md and each <provider>/LAYOUT.md. Use the by-*
  alias indexes rather than find/grep -r across the tree.
- This host mounts only these scopes: <list>. A path outside them is not
  missing — it is unmounted. Confirm with `relayfile tree <ws> <path>` before
  concluding anything does not exist.
- Before you rely on any file whose freshness matters, verify it against the
  cloud: `diff <(relayfile read <ws> <path>) <MIRROR><path>`. A local file can
  be days stale while every status command reports healthy.
- To write back, read the resource's .adapter.md and .schema.json first, then
  write the JSON to a non-canonical filename in the resource dir. Never write
  under <MIRROR>/.relay/ — it is reserved daemon state.
- Writes here become REAL provider mutations. No dry run exists.
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Second host created its own workspace | Ran `relayfile setup` instead of `relayfile workspace join <rw_id>`. Delete the stray local registration and join the real id. |
| Agent's writes never reach the provider | Host joined without `--write`. Re-join with `--write`; confirm with a `cross-host-write-visible` run. |
| File exists on host A, missing on host B | Almost always scope, not sync. Compare `--remote-path` sets; confirm existence cloud-side with `relayfile tree`. |
| `lag: 0s` but content is old | Expected — `lag` is not a freshness measurement. Run `mirror-matches-cloud`. |
| Provider row reads `lagging  reason: no sync cursor or watermark` | That provider never established a sync cursor; its subtree may never have populated. Do not treat its absence as data. |
| Two mounts corrupting each other's state | Shared `--state-dir`. Give every mount its own. |
| `delegated credential workspace "<id>" was not uniquely resolved` warning | Multiple/alias shards in `~/.relayfile/workspaces.json`; the CLI falls back to probing. Harmless to reads, but pin the exact workspace id in scripts. |
| Writebacks stuck / dead-lettered | `relayfile writeback list --state dead --json`, inspect `<mirror>/.relay/dead-letter/<opId>.json`, fix cause, `relayfile writeback retry --opId <op> <ws>`. `relayfile writeback skip-stuck` as a last resort. |
| Mirror never converges; sync cycle repeats "forcing full reconcile" | Adapter emitted one path as both file and directory — POSIX cannot hold both, so bootstrap never completes. Adapter-side fix; see `setting-up-relayfile`. |
| `relayfile tree` shows fewer files than exist | It is paginated and capped per response; higher `--depth` returns *fewer* rows. Use `--json` (only it exposes `nextCursor`), walk `--depth 1` per directory, and never treat one call as a complete listing. `--cursor` is not implemented. |
| A currency assertion "passed" but the mirror was stale | It verified a truncated page. Always print and read the `coverage:` line — `checked` well below the local file count means the pass covers a corner of the tree. |
| Placed agent cloned a repo anyway | Task prompt did not forbid it. Use the prompt block above. |
| Node missing from `agent-relay fleet nodes` | Default view omits live spawn-capable nodes. Use `--all --capability spawn:<harness>`, redirected to a file. |

## Named assertions

Report these by name. A run that did not execute an assertion must say so
rather than implying it passed.

| Assertion | Proves | Fails when |
|---|---|---|
| `workspace-joined-not-created` | host registers the *existing* `rw_*` id | `relayfile workspace list` shows a new id |
| `scope-declared` | this host's `--remote-path` set is known and intentional | scope inferred rather than read from the live daemon argv |
| `mirror-matches-cloud` | local bytes equal cloud `size`/`revision` for the scope | any file `MISSING` or `STALE` |
| `listing-coverage-reported` | the currency check states how much of the tree it actually verified | any directory returned `nextCursor`, or coverage went unreported |
| `known-true-now` | mounted content contains a fact confirmed true out-of-band right now | the anchor record is absent — the projection is behind the provider |
| `uncertified-scopes-named` | every scope the agent will read was asserted, or is explicitly listed as unknown | an unasserted scope is reported as current (or as stale) |
| `cross-host-write-visible` | A→B and B→A visibility through the cloud, bounded | marker not observed within the ceiling |
| `write-permission-matches-intent` | `--write` granted exactly to hosts meant to mutate | a read-only host mutates, or a writer silently cannot |
| `placement-target-live` | target carries `spawn:<harness>` and `live: true` | read from the default `fleet nodes` view |
| `placement-executed` | `dispatchedNodeId` == target `id` **and** `pgrep` on the target host | either half alone |
| `nothing-cloned` | no `.git` created under the mount or the agent's cwd | agent cloned to get source |

## Related skills

- `setting-up-relayfile` — first-time setup, OAuth, integrations, writeback recovery
- `orchestrating-agent-relay` — broker lifecycle, spawning, fleet enrollment, placement proof
- `workspace-layout` — navigating a mount via `LAYOUT.md` and `by-*` indexes
- `writeback-as-files` — the file-creation writeback contract
- `using-agent-relay` — participant-side messaging for the placed agent
