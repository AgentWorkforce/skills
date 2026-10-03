---
name: setting-up-agent-relay-sessions
description: Get a person set up for live agent-to-agent session handoff on Agent Relay end-to-end from a running Codex or Claude session, so their agent and a teammate's agent can message each other and read each other's real sessions (prompts, events, tool calls, file edits). Covers verifying desktop setup, installing the agent-sessions cloud MCP before the session starts, confirming the handoff tools loaded, and proving one live round trip. Use when a human asks an agent to "set me up for session handoff", "connect my agent to <teammate>", or finish the onboarding we send new teammates — instead of walking them through the app and the dashboard by hand.
---

# Set Up Agent Relay Session Handoff

Drive the whole onboarding from this agent's own shell and MCP tools. Do **not**
hand the person the six-step Markdown guide and ask them to click through the
app and the dashboard. The finished state is:

- the desktop app is installed, signed in to the **intended workspace**, the
  uploader is healthy, and this session is registered with direct delivery on;
- the **agent-sessions cloud MCP** is installed in this project and loaded by
  this session, so the handoff tools (`list_relay_agents`, `send_relay_message`,
  `read_relay_conversation`, `check_relay_inbox`, `get_shared_session`,
  `get_shared_session_context`, `search_shared_sessions`) are available;
- a live round trip is proven: this agent messages a teammate's agent and reads
  the teammate's **real** session content back (or, when no teammate is online
  yet, the roster and the person's own uploaded session read back cleanly).

## The only human steps

Everything else is automatable; be honest that these are not:

1. **Approve one Google device-login link** — only when no reusable `agent-relay`
   CLI/desktop login exists. A reused login needs zero clicks.
2. **Paste one Bearer token** minted in the dashboard's **"Connect your agent"**
   card. No setup route returns this token by design, so the person mints it and
   hands it to this agent once. Treat it as a secret (below).
3. **Same workspace, both sides.** The teammate (or workspace admin) must have
   invited this person's email to the **shared** workspace — two agents can only
   reach each other inside one workspace. Confirm the workspace id matches on
   both machines; do not guess it.

One structural note so expectations are right: there is **no automatic ack** to
the sender when a handoff is picked up, and **no partial session sharing** — a
session is on-or-off on the relay. Confirm a handoff by activity, not a push.

## How this composes with `setting-up-agent-relay-desktop`

This skill is a thin layer on top of a working desktop. It **reuses**
`setting-up-agent-relay-desktop` for everything up to and including a registered,
signed-in session — verified install (the scriptable macOS DMG and headless
Linux `.deb`/systemd paths), device sign-in, the agent-led defaults, and
self-registration — and owns only what is new here: the agent-sessions cloud MCP
and the live handoff. It does not reimplement the install or the `/setup/*`
contract.

The composition is a **dependency, not a copy**: section 2 checks whether the
desktop prerequisite is met and, if not, **invokes** the desktop skill
(`/setting-up-agent-relay-desktop`) to completion, then returns here. Install
that skill alongside this one (below) so the invocation resolves. Keep the
`/setup/*` details in that one skill; if the contract changes, only the desktop
skill updates and this one still composes.

## Install this skill (and its dependency) for Codex and Claude Code

When the task includes installing this skill, install its canonical Claude
package **and** the desktop skill it depends on, then mirror both unchanged
`SKILL.md` files where Codex loads global skills:

```sh
for pkg in setting-up-agent-relay-sessions setting-up-agent-relay-desktop; do
  npx prpm install "@agent-relay/$pkg" --as claude --global -y
  codex_skill="$HOME/.codex/skills/$pkg"
  mkdir -p "$codex_skill"
  install -m 0644 "$HOME/.claude/skills/$pkg/SKILL.md" "$codex_skill/SKILL.md"
  cmp "$HOME/.claude/skills/$pkg/SKILL.md" "$codex_skill/SKILL.md"
done
```

Do not use prpm's `--as codex` conversion for these packages: it writes under
`~/.agents/skills`, which Codex does not load as its global skill folder, and it
drops explanatory paragraphs from the Markdown workflow. Confirm both final
paths explicitly before continuing.

## Why ordering matters

MCPs load at agent **startup**. The agent-sessions MCP must be installed
**before** the session that will use it starts. A session already running when
the MCP was added has no handoff tools and must be **restarted**. Install the
MCP (section 3) before relying on the tools (sections 4–5); if this very session
predates the MCP, say so and restart it rather than reporting missing tools as a
failure.

## Token handling

Never put the Bearer token, a Cloud token, workspace key, or agent token in a
Relay message, in argv that gets logged, or in the repo. For Codex, keep it in
an environment variable and pass `--bearer-token-env-var`. For Claude Code, pass
it in the `Authorization` header on the one `claude mcp add` call; do not echo
it afterward. If you must hold it on disk briefly, use a mode-0600 file and
delete it when done.

## 1. Confirm the host and this session

Run every command from this agent's own shell tool. The app identifies the
caller from kernel credentials and the Codex/Claude process ancestry, so a
command from an unrelated terminal is rejected with `not_a_relay_session`.

```sh
uname -s; uname -m
test -n "${SSH_CONNECTION:-}" && printf 'transport=ssh\n' || true
test -n "${TMUX:-}" && printf 'session=tmux\n' || true
```

Find the private setup socket without printing private files:

```sh
pointer="$HOME/.agentworkforce/desktop/relay-socket"
if test -r "$pointer"; then relay_socket=$(sed -n '1p' "$pointer"); fi
if test -n "${relay_socket:-}" && ! test -S "$relay_socket"; then unset relay_socket; fi
if test -z "${relay_socket:-}" && test "$(uname -s)" = Linux; then
  relay_socket="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/agent-relay/relay.sock"
fi
test -S "${relay_socket:-/nonexistent}" && printf 'socket=%s\n' "$relay_socket"
```

## 2. Make sure the desktop is set up first

Session handoff needs a signed-in, healthy desktop underneath it. If the socket
is missing, or `/setup/status` returns `404`, or sign-in/uploader/registration
are not in the finished state below, **invoke the `setting-up-agent-relay-desktop`
skill** (`/setting-up-agent-relay-desktop`), let it run to completion, and then
return to section 2's verification. Do not re-implement its install, sign-in, or
`/setup/*` steps here — that skill is the single source of truth for them, and
this skill resumes once it reports a registered, signed-in session.

Verify the desktop state this skill depends on:

```sh
curl -fsS --unix-socket "$relay_socket" http://relay/setup/status | jq '{
  version: .data.version,
  signed_in: .data.signed_in,
  workspace: .data.workspace,
  uploader: .data.uploader,
  direct_delivery: .data.direct_delivery,
  session: .data.session,
  defaults_error: .data.defaults_error
}'
```

Require all of these before continuing, and stop with a clear message if any
fails:

```sh
curl -fsS --unix-socket "$relay_socket" http://relay/setup/status | jq -e '
  .ok
  and .data.signed_in == true
  and (.data.workspace.id | type == "string" and length > 0)
  and .data.uploader.healthy == true
  and .data.direct_delivery == true
  and .data.session.registered == true'
```

Confirm `workspace.id` is the **shared** workspace both sides agreed on. A
healthy uploader is the one non-obvious prerequisite: for a teammate's agent to
read **this** person's session, this machine must have uploaded it. If
`uploader.healthy` is false (paused, or a failed cycle), fix it before promising
anyone can read this session — this is the single most common reason a live
handoff silently fails.

## 3. Install the agent-sessions cloud MCP (before the session uses it)

Get the Bearer token from the person (minted in the dashboard "Connect your
agent" card). Detect which agent CLI this session runs and install accordingly.

Claude Code — the token rides the `Authorization` header:

```sh
# relay_sessions_token holds the pasted token in this shell only; do not echo it.
claude mcp add --transport http agent-relay-sessions \
  https://agentrelay.com/cloud/api/v1/mcp/shared-sessions \
  --header "Authorization: Bearer $relay_sessions_token"
claude mcp list | grep -F agent-relay-sessions
```

Codex — the token stays in an environment variable:

```sh
# Export AGENT_RELAY_SESSIONS_TOKEN in the environment first (do not log it).
codex mcp add agent-relay-sessions \
  --url https://agentrelay.com/cloud/api/v1/mcp/shared-sessions \
  --bearer-token-env-var AGENT_RELAY_SESSIONS_TOKEN
codex mcp list | grep -F agent-relay-sessions
```

Add the MCP at **project** scope where the handoff work will happen, so it loads
for sessions started in that project. If this session was already running before
this step, it has not loaded the MCP: tell the person to restart it (or restart
it yourself), and continue verification in the restarted session. Do not report
the tools as missing without first confirming the session started *after* the
MCP was added.

## 4. Confirm the handoff tools loaded

In the session that started after the MCP was added, confirm the tools are
present before using them. List this session's MCP tools and check for the
agent-sessions set; the authoritative check is that the tools actually appear to
this agent:

```sh
# Claude Code: the tools surface as mcp__agent-relay-sessions__*
claude mcp list | grep -F agent-relay-sessions
```

Then call `list_relay_agents` through the MCP (an MCP tool call, not a shell
command). A successful call that returns the workspace roster proves the MCP is
loaded, the token is valid, and this session can see the shared workspace. If
the call errors with auth, the token is wrong or for another workspace — have
the person re-mint it from the correct workspace's dashboard.

## 5. Prove one live round trip

The real proof is agent-to-agent, so it needs a counterpart. Pick the path that
matches what is available:

**A teammate's agent is online (full round trip).** Ask the person for the
teammate's relay address (e.g. `@manav`), then:

1. `list_relay_agents` — confirm the teammate's address is listed.
2. `send_relay_message` — send a short, uniquely-marked message to that address.
3. The teammate's agent reads this session with `get_shared_session_context` and
   continues; have them reply through the relay.
4. GREEN is the teammate's **real** content appearing in this session and the
   reply landing. There is no automatic ack — confirm by the reply/activity, not
   a push. Because Relay injects an inbound message only when the session is idle
   between turns, **end the turn** after sending and confirm the reply on the
   next turn; do not sleep or poll inside one turn.

**No teammate online yet (self-verify the read path).** Prove the machinery
without a second person:

1. `list_relay_agents` returns the roster — MCP + token + workspace are good.
2. `search_shared_sessions` / `get_shared_session_context` return this person's
   **own** recently uploaded session (real prompts/events plus a dashboard
   citation link) — the uploader→read path works.
3. Record that the two-party round trip still needs the teammate online, and
   name it as the remaining step rather than claiming the handoff is proven.

Never paste the Bearer token or any session token into a `send_relay_message`
body or any artifact.

## 6. Report

Separate verified facts from what still needs a human or a second machine:

- app version, `signed_in`, the signed-in **workspace id and name**;
- uploader `healthy`, this session's `agent@machine` address, direct delivery on;
- agent-sessions MCP installed and its tools confirmed loaded in this session;
- `list_relay_agents` roster seen; and either the full round-trip evidence (the
  teammate's real content + reply) or the self-verified read path plus the named
  remaining step (teammate online).

Do not call the setup complete on a 2xx from `claude mcp add` alone, and do not
count a roster listing as a proven handoff.

## Recovery

- **No handoff tools in the session:** the MCP was added after the session
  started, or at the wrong scope. Reinstall at project scope (section 3) and
  **restart** the session; MCPs load only at startup.
- **`list_relay_agents` auth error:** the token is wrong, expired, or from a
  different workspace. Re-mint it from the intended workspace's "Connect your
  agent" card and re-run `claude mcp add` / `codex mcp add`.
- **Teammate's address missing from the roster:** they are not on the **same**
  workspace, or their session is not on the relay. Have them register their
  session and confirm the shared workspace id.
- **Can't read the teammate's session:** their **uploader** is not healthy
  (paused or a failed cycle). Have them check `/setup/status` shows
  `uploader.healthy == true`, not "Sync paused/offline".
- **Message arrives held, not live:** direct delivery is off for the recipient —
  POST `{"enabled":true}` to `/setup/direct-delivery` on their machine (Codex
  delivers directly by default). A managed Claude policy can block this; report
  it rather than editing managed settings.
- **Remove the MCP:** `claude mcp remove agent-relay-sessions` /
  `codex mcp remove agent-relay-sessions`. This removes only the handoff tools;
  it does not sign the desktop out or stop uploads.

## Relationship to the other skills

- **`setting-up-agent-relay-desktop`** — the layer below this one: install,
  sign-in, agent-led defaults, self-registration. Use it when section 2 is not
  yet satisfied.
- **`relay-connect`** — a lighter, account-free, time-boxed way for two agents to
  share one session via a hand-over link. Prefer it for an ad-hoc pairing;
  prefer this skill for durable teammate-to-teammate handoff inside a shared
  workspace.
