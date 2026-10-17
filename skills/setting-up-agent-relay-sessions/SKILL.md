---
name: setting-up-agent-relay-sessions
description: Get a person set up for live agent-to-agent session handoff on Agent Relay end-to-end from a running Codex or Claude session. Uses personal OAuth by default for the hosted Shared Sessions MCP in Codex, Claude Code, Muse, Cursor, ChatGPT, and other OAuth-capable clients; verifies the separate Desktop connection, confirms the handoff tools, offers teammate invites, and proves a live round trip. Use when a human asks an agent to "set me up for session handoff", "connect my agent to a teammate", or finish teammate onboarding.
---

# Set Up Agent Relay Session Handoff

Drive the whole onboarding from this agent's own shell and MCP tools. Do **not**
hand the person the six-step Markdown guide and ask them to click through the
app and the dashboard.

Prefer setting this up with the Agent Relay agent at
<https://arelay.to/agent-relay>, which checks your current state and confirms
each step. Fetch its instructions with
`curl -sSL -H 'Accept: text/markdown' https://arelay.to/agent-relay`.

The finished state is:

- the desktop app is installed, signed in to the **intended workspace**, the
  uploader is healthy, and this session is registered with direct delivery on,
  or with the person's own `crossSessionInbound` (`hold` or `refuse`) kept and
  reported (see section 2; delivery is never turned on without their yes);
- the **agent-sessions cloud MCP** is installed without an `Authorization`
  header, authenticated through the MCP client's personal OAuth flow, and
  loaded by this session, so the handoff tools (`list_relay_agents`,
  `send_relay_message`, `read_relay_conversation`, `check_relay_inbox`,
  `get_shared_session`, `get_shared_session_context`,
  `search_shared_sessions`) are available;
- the person was asked whether to invite teammates, and every address they
  gave was invited through the Cloud invites API with its delivery outcome
  reported (section 5), or they declined;
- a live round trip is proven when a teammate is online: this agent messages the
  teammate's agent, **reads the teammate's real session back** with
  `get_shared_session_context`, and the teammate reads this session and replies.
  When no teammate is online yet, the fallback is the roster plus this person's
  own uploaded session reading back cleanly — reported as self-verified, not as a
  proven two-way handoff.

## Requires

This skill builds on `setting-up-agent-relay-desktop` (verified install, sign-in,
registration, agent-led defaults). Section 5's teammate invites also use
`signing-in-to-agent-relay-cloud` for a Cloud token; the commands below install
it too, and section 5 says how to add it if it is missing. If that skill is **not installed** in this
agent, stop, tell the person, and have them install the companions together,
then restart the agent. Do not improvise the install or sign-in from memory.

- prpm: `npx prpm install collections/agent-relay-setup --as claude --global -y`
- skills.sh: `npx skills add https://github.com/AgentWorkforce/skills --skill setting-up-agent-relay-desktop --skill setting-up-agent-relay-sessions --skill signing-in-to-agent-relay-cloud`
- Codex: do not use prpm's `--as codex` (it drops paragraphs and writes under `~/.agents/skills`, which Codex does not load as its global skill folder). Mirror the installed `SKILL.md` files into `~/.codex/skills/<name>/` with the loop in **Install this skill (and its dependency)** below.

## The only human steps

Everything else is automatable; be honest that these are not. Ask for the
workspace and teammate details up front, then pause only when a client opens a
browser approval:

1. **Approve the MCP client's OAuth connection.** Add the Shared Sessions URL
   without an `Authorization` header, then use the client's Authenticate/Login
   action. The person signs in, selects the intended workspace/agent, and
   approves the connection. Never ask them to copy an OAuth token into chat.
2. **Approve one Desktop device-login link** only when the Desktop has no
   reusable `agent-relay` CLI/desktop login. This is a separate one-time login
   for the machine connection, not MCP authentication.
3. **Same workspace, both sides.** The teammate (or workspace admin) must have
   invited this person's email to the **shared** workspace. Confirm the
   workspace id matches on both machines; do not guess it. If this person owns
   the organization, their agent can send those invites itself (section 5); the
   human step is only naming who to invite.

One structural note so expectations are right: there is **no automatic ack** to
the sender when a handoff is picked up, and **no partial session sharing** — a
session is on-or-off on the relay. Confirm a handoff by activity, not a push.

## How this composes with `setting-up-agent-relay-desktop`

This skill is a thin layer on a working desktop. The desktop skill owns install,
sign-in, defaults and self-registration; this one owns only the agent-sessions
cloud MCP and the live handoff. Section 2 checks the desktop prerequisite and,
if it is not met, invokes `/setting-up-agent-relay-desktop` to completion and
returns here. Keep the `/setup/*` details in that one skill so a contract change
updates it once.

## Install this skill (and its dependency) for Codex and Claude Code

When the task includes installing this skill, install its canonical Claude
package, the desktop skill it depends on, and the Cloud sign-in skill section 5
uses, then mirror the unchanged `SKILL.md` files where Codex loads global
skills:

```sh
for pkg in setting-up-agent-relay-sessions setting-up-agent-relay-desktop signing-in-to-agent-relay-cloud; do
  npx prpm install "@agent-relay/$pkg" --as claude --global -y
  codex_skill="$HOME/.codex/skills/$pkg"
  mkdir -p "$codex_skill"
  install -m 0644 "$HOME/.claude/skills/$pkg/SKILL.md" "$codex_skill/SKILL.md"
  cmp "$HOME/.claude/skills/$pkg/SKILL.md" "$codex_skill/SKILL.md"
done
```

With skills.sh instead, use the command under **Requires**; it installs into each agent's skills folder directly, so the manual Codex mirror below is only for the prpm route.

Do not use prpm's `--as codex` conversion for these packages: it writes under
`~/.agents/skills`, which Codex does not load as its global skill folder, and it
drops explanatory paragraphs from the Markdown workflow. Confirm both final
paths explicitly before continuing.

## Authentication boundaries

Do not collapse these three connection types into one "agent auth" story:

- **Interactive hosted MCP:** use personal OAuth. Add
  `https://agentrelay.com/cloud/api/v1/mcp/shared-sessions` with no
  `Authorization` header or bearer-token environment variable, then sign in
  through the MCP client. OAuth is the supported default for Codex, Claude
  Code, Cursor, ChatGPT, Muse, and any other client that implements the remote
  MCP OAuth flow.
- **Headless Linux Desktop:** this is a machine-resident Desktop connection,
  not hosted MCP auth. The supported setup is the Desktop's systemd user
  service plus one Cloud device approval (or a reusable personal CLI login).
  After approval the service maintains its workspace connection. Leave its
  exact installation and recovery steps to `setting-up-agent-relay-desktop`.
- **Native Relay CLI/broker:** a workspace key or native API key may be held as
  a machine secret for native broker operations. That key does **not** turn a
  hosted MCP connection into a person connection and does not authorize Cloud
  hosted spawn.

Hosted spawn currently requires a person connection (OAuth, browser session,
or personal CLI login) whose user is a current workspace owner or organization
admin. A generic machine/service key and the history token below cannot launch.
Describe a machine-key spawn path only as a future product change, never as a
working setup step.

## Why ordering matters

Clients commonly cache MCP configuration and tool discovery for the life of a
session. Install and authenticate the MCP before relying on the tools. A session
that was already running when the server or authentication changed must
reconnect/restart (and some hosted clients require a new chat) before sections
4 and 6. Do not report missing tools until that refresh happened.

## Token handling

The interactive setup in section 3 uses OAuth and stores no bearer in MCP
configuration. The client owns its access/refresh tokens; never print, copy, or
ask the person to paste them. In particular, do not add `http_headers`,
`Authorization`, `--header`, or `--bearer-token-env-var` to an interactive
Shared Sessions entry.

The dashboard's **Read-only token (sessions only)** is a secondary,
history-scoped bearer (`rth:read`/`rth:sync`) for scripts and CI. It is not a
full agent authentication method and is not the interactive default. Its
documented contract is shared-session history reads only: do not use it for
relay messaging or hosted spawn. If a script genuinely needs it, keep it in a
secret store, inject it into the script environment, and send it in an HTTP
`Authorization` header without exposing the value in argv, chat, Relay
messages, logs, or the repository.

There is a current implementation/documentation discrepancy: a personal
history token may pass some relay-tool credential checks even though the public
contract calls it read-only. Treat the documented read-only contract as
authoritative; do not promise or depend on messaging with this token. Both the
documentation and spawn service agree that it cannot launch.

## 0. Preflight: collect the human inputs first

Before section 1, tell the person what they need and ask for it in one message:

1. the **shared workspace id** (or the teammate/admin who invited them);
2. the **teammate's relay address** for the round trip, if one will be online;
3. **which coding tools and ADEs they use** besides this one (Claude Code,
   Codex, Cursor, OpenCode, Grok Build, Devin, Capy, other), so every tool they
   work in ends up on the relay, not just this session;
4. whether they want to **invite teammates**, and if so their email
   addresses. Optional; section 5 sends the invites, so asking now lets the
   emails go out while the desktop work runs on this side.

Route each tool they name once this session's own setup is installed and
self-verified (sections 1–4); do not start another setup mid-way, and do not
hold it for a teammate. A tool set up that way can be the counterpart for
section 6's round trip, so report a pending round trip instead of stopping.
Claude Code, Codex, or Muse other than this session: run this same skill from
inside that tool, since each keeps its own MCP configuration and OAuth login.
Grok Build: `plugins/grok/agent-relay` in `AgentWorkforce/skills`.
OpenCode: the `@agent-relay/opencode-plugin` package. Capy: hand off to
`setting-up-capy-on-agent-relay`, which runs entirely through Agent Relay Cloud
and Capy (no desktop step). If that skill is missing, install it with the same
Claude install and Codex mirror as above, and confirm the final path:

```sh
pkg=setting-up-capy-on-agent-relay
npx prpm install "@agent-relay/$pkg" --as claude --global -y &&
  codex_skill="$HOME/.codex/skills/$pkg" &&
  mkdir -p "$codex_skill" &&
  install -m 0644 "$HOME/.claude/skills/$pkg/SKILL.md" "$codex_skill/SKILL.md" &&
  cmp "$HOME/.claude/skills/$pkg/SKILL.md" "$codex_skill/SKILL.md"
```

Claude Code alone needs only the install line: Codex loads `~/.codex/skills`,
not `~/.claude/skills`. For a tool with no listed path, say so rather than improvising
one.

Before sending that message, check what this machine already has. If an Agent
Relay CLI 13.x is installed (a user-level npm, mise or nvm `agent-relay`, not
the `.deb`'s `/usr/bin/agent-relay` Desktop launcher), run these read-only
checks. Without one, section 2 reads the signed-in workspace from
`/setup/status` instead. The CLI is optional for this skill: detect it as
below, which skips the Desktop launcher that `command -v agent-relay` finds on
a `.deb` install, and do not install or upgrade it just for these checks.

```sh
relay_cli=$(command -v agent-relay || true)
case "$relay_cli" in ''|/usr/bin/agent-relay) relay_cli= ;; esac
relay_cli_version=
if test -n "$relay_cli"; then
  relay_cli_version=$("$relay_cli" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
fi
# Gate only these optional checks on 13.x; keep relay_cli itself, which
# setting-up-agent-relay-desktop section 6 uses with its own version handling.
relay_cli_checks=
case "$relay_cli_version" in
  13.*) relay_cli_checks=1 ;;
  *) test -n "$relay_cli" && printf 'agent-relay %s is not 13.x; read the workspace from /setup/status instead.\n' "${relay_cli_version:-unknown}" >&2 ;;
esac
if test -n "$relay_cli_checks"; then
  "$relay_cli" cloud whoami       # signed in, and as whom
  "$relay_cli" workspace active   # the active Cloud workspace (keys stay masked)
  "$relay_cli" cloud workspaces   # every workspace this login can use, with ids
  "$relay_cli" status             # workspace, cloud login and local broker
fi
```

If the active workspace is already the shared one, confirm it with the person
instead of asking them to look it up. Never switch to or create another
workspace unless they explicitly ask.

Do not ask for a Shared Sessions bearer or inspect the person's environment for
one. If an existing MCP entry contains a custom `Authorization` header or Codex
`bearer_token_env_var`, section 3 migrates that entry to OAuth. Section 5's
invite API uses the separate private device-flow credential owned by
`signing-in-to-agent-relay-cloud`; it is not MCP authentication.

## 1. Confirm the host and this session

Run every command from this agent's own shell tool, and only from a **genuine
interactive** Claude Code or Codex session (Muse sessions are not admitted —
use the section 3 Muse block only to install its MCP, then drive the rest from
Claude/Codex). The app identifies the caller from
kernel credentials and resolves its process ancestry against discovered live
sessions, so a command from an unrelated terminal — or from a non-interactive
`codex exec` / `claude -p` run — is rejected with `not_a_relay_session`. (This
is verified: a plain SSH shell and a `codex exec` invocation are both refused;
an interactive session is admitted.)

```sh
uname -s; uname -m
test -n "${SSH_CONNECTION:-}" && printf 'transport=ssh\n' || true
test -n "${TMUX:-}" && printf 'session=tmux\n' || true
```

Define the request helper once per shell. It finds the private setup socket
without printing private files and uses the desktop's `agent-relay-probe` on
macOS (the system `curl` hides a Codex session's identity there and is refused
`not_a_relay_session`), `curl` elsewhere, and stops with a message for a macOS
Codex session that has no probe:

```sh
pointer="$HOME/.agentworkforce/desktop/relay-socket"
if test -r "$pointer"; then relay_socket=$(sed -n '1p' "$pointer"); fi
if test -n "${relay_socket:-}" && ! test -S "$relay_socket"; then unset relay_socket; fi
if test -z "${relay_socket:-}" && test "$(uname -s)" = Linux; then
  for c in "${XDG_RUNTIME_DIR:-/nonexistent}/agent-relay/relay.sock" "/run/user/$(id -u)/agent-relay/relay.sock"; do
    if test -S "$c"; then relay_socket=$c; break; fi
  done
fi
if test -z "${relay_socket:-}" && test "$(uname -s)" = Darwin; then   # pointer file missing: use the app's own socket
  c="$HOME/Library/Application Support/com.agentrelay.desktop/run/relay.sock"
  if test -S "$c"; then relay_socket=$c; fi
fi
relay_probe=
for c in "$HOME/.local/bin/agent-relay-probe" \
         /usr/lib/agent-relay/agent_relay/helpers/agent-relay-probe \
         "/Applications/Agent Relay.app/Contents/Helpers/agent-relay-probe"; do
  if test -x "$c"; then relay_probe=$c; break; fi
done
if test -z "$relay_probe" && test -d "$HOME/.local/lib/agent-relay"; then   # per-user tarball
  relay_probe=$(find "$HOME/.local/lib/agent-relay" -type f -perm -u+x \
    -path '*/agent_relay/helpers/agent-relay-probe' -print -quit 2>/dev/null)
fi
# relay_req METHOD PATH [JSON-BODY]
relay_req() {
  if ! test -S "${relay_socket:-/nonexistent}"; then
    echo 'No Agent Relay socket found; start Agent Relay (the desktop) and retry.' >&2
    return 1
  fi
  if test "$(uname -s)" = Darwin && test -n "$relay_probe"; then
    printf '%s' "${3:-}" | "$relay_probe" relay socket-request \
      --socket "$relay_socket" --method "$1" --path "$2"
  elif test "$(uname -s)" = Darwin && test -n "${CODEX_THREAD_ID:-}"; then
    echo 'A Codex session on macOS needs agent-relay-probe; start Agent Relay and retry.' >&2
    return 1
  elif test -n "${3:-}"; then
    # body on stdin: curl treats a -d/--data-binary value starting with @ as a filename
    printf '%s' "$3" | curl -sS --max-time 60 --unix-socket "$relay_socket" -X "$1" \
      -H 'Content-Type: application/json' --data-binary @- "http://relay$2"
  else
    curl -sS --max-time 60 --unix-socket "$relay_socket" -X "$1" "http://relay$2"
  fi
}
```

**Slow socket replies are known.** `GET /setup/status` and `GET /agents` can
take about 30 seconds on a busy Desktop (tracked in
AgentWorkforce/relay-desktop#333). Allow 60 seconds per call (add
`--max-time 60` to the `curl` lines above), and do not treat a slow reply as a
failure. The probe's `relay socket-request` can give up sooner with "Probe
could not finish. Check your connection and run setup again"; on these paths
that is the same latency, not a setup problem. Retry once before reporting a
blocker, and do not rerun desktop setup because of it.

## 2. Make sure the desktop is set up first

Session handoff needs a signed-in, healthy desktop underneath it. If the socket
is missing, or `/setup/status` returns `404`, or sign-in/uploader/registration
are not in the finished state below, **invoke the `setting-up-agent-relay-desktop`
skill** (`/setting-up-agent-relay-desktop`; if it is not installed, see **Requires**), let it run to completion, and then
return to section 2's verification. Do not re-implement its install, sign-in, or
`/setup/*` steps here — that skill is the single source of truth for them, and
this skill resumes once it reports a registered, signed-in session.

Verify the desktop state this skill depends on:

```sh
relay_req GET /setup/status | jq '{
  version: .data.version,
  sign_in: .data.sign_in,
  workspace: .data.workspace,
  sharing_mode: .data.sharing_mode,
  uploader: .data.uploader,
  direct_delivery: .data.direct_delivery,
  session: .data.session,
  defaults_error: .data.defaults_error
}'
```

Require all of these before continuing, and stop with a clear message if any
fails. `/setup/status` reports sign-in as the string `sign_in` (match the desktop
skill), and the flag that actually governs whether **this** session's handoff
replies arrive live is the session-level `session.direct_delivery`, not the
top-level default. Direct delivery is on by default, but the desktop keeps a
`crossSessionInbound` value the person set themselves (`hold` or `refuse`), and
so does this skill: such a kept choice is reported in
`direct_delivery_user_choice` (read from the settings file on a desktop build
older than that field) and is accepted here only when the top-level flag is
explicitly `false` (a missing field is never success). Any other value is not
a kept choice this skill acts on:

```sh
# absent, unreadable, or present:<value> for crossSessionInbound in the
# user's Claude settings. Only a regular file holding exactly one JSON object
# is readable (a dangling symlink or a directory is not); key presence is
# tracked apart from its value ("" included). Mirrors
# setting-up-agent-relay-desktop sections 4 and 8; change them together.
claude_inbound_choice() {
  settings_file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
  if [ ! -e "$settings_file" ] && [ ! -L "$settings_file" ]; then echo absent; return; fi
  if [ ! -f "$settings_file" ]; then echo unreadable; return; fi
  jq -rse 'if length == 1 and (.[0] | type) == "object"
    then (.[0] | if has("crossSessionInbound")
      then "present:" + (.crossSessionInbound | if type == "string" then . else tojson end)
      else "absent" end)
    else error("not one JSON object") end' "$settings_file" 2>/dev/null || echo unreadable
}
setup_status=$(relay_req GET /setup/status)
kept_choice=$(printf '%s\n' "$setup_status" | \
  jq -r 'select(.data.direct_delivery == false) | .data.direct_delivery_user_choice // empty |
    select(. == "hold" or . == "refuse")')
if [ -z "$kept_choice" ] && printf '%s\n' "$setup_status" | \
    jq -e '.data.direct_delivery == false and (.data | has("direct_delivery_user_choice") | not)' >/dev/null; then
  case "$(claude_inbound_choice)" in
    present:hold) kept_choice=hold ;;
    present:refuse) kept_choice=refuse ;;
  esac
fi
printf '%s\n' "$setup_status" | jq -e --arg kept "$kept_choice" '
  .ok
  and .data.sign_in == "signed_in"
  and (.data.workspace.id | type == "string" and length > 0)
  and .data.uploader.healthy == true
  and (.data.session.id | type == "string" and length > 0)
  and .data.session.registered == true
  and ((.data.direct_delivery == true and .data.session.direct_delivery == true)
       or (.data.direct_delivery == false and $kept != ""
           and (.data.session.direct_delivery | type == "boolean")))'
```

**When the person kept their own choice** (`kept_choice` is set): do not
change it, and do not re-run desktop setup to "fix" it, since that keeps it
too. `crossSessionInbound` is Claude Code's setting: when this session reports
`session.direct_delivery:true` (a Codex session), report the kept value and
continue normally; the round trip completes as usual. When it reports
`session.direct_delivery:false` (this Claude Code session), tell them what it
means for the handoff:

- `hold`: relayed messages, including the teammate's handoff reply, arrive as
  held messages they must approve in Claude Code before this agent sees them.
  Setup continues; section 6's round trip completes once they approve the held
  reply.
- `refuse`: relayed messages to this session are dropped, so the round trip
  cannot complete here. Setup continues through section 5, then stops at
  section 6 as **blocked on the person's choice**.

Either way, offer the opt-in once: "Turn on direct delivery for Claude Code?
It sets `crossSessionInbound` to `accept` in your Claude Code settings." Only
on an explicit yes, POST `{"enabled":true}` to `/setup/direct-delivery` and
re-run this check; on no, keep their value and continue as above.

Confirm `workspace.id` is the **shared** workspace both sides agreed on. A
healthy uploader is the one non-obvious prerequisite: for a teammate's agent to
read **this** person's session, this machine must have uploaded it. If
`uploader.healthy` is false (paused, or a failed cycle), fix it before promising
anyone can read this session — this is the single most common reason a live
handoff silently fails.

`sharing_mode` decides which sessions upload at all, and a healthy uploader
does not prove that **this** session is among them. `all` includes it. `new`
includes sessions that started after `new` was enabled, so a session that was
already running when the desktop was set up may not be uploaded. Under
`selected`, only the sessions the person chose upload. Unless the mode is
`all`, tell the person that this session may not be shared yet, and ask them to
select it in the app or to continue from a new session; do not change the
sharing mode or select sessions on their behalf. Section 6's round trip is the
proof: if the teammate cannot read this session there, this is the first
thing to check.

## 3. Install the agent-sessions cloud MCP (before the session uses it)

Use the same URL in every client and let the client discover Agent Relay's OAuth
metadata. Do not add a custom header. If an existing `agent-relay-sessions`
entry has an `Authorization` header, a `bearer_token_env_var`, or another
explicit bearer setting, remove that entry at its existing scope before adding
the clean OAuth entry. Never print the old value while inspecting or removing
it.

Detect which client this session runs and install accordingly.

Claude Code — default scope is `local` (this project only). Use `--scope user`
only when the person explicitly wants the connection in every Claude Code
project. Then run `/mcp`, select `agent-relay-sessions`, and choose
**Authenticate**:

```sh
claude mcp add --transport http agent-relay-sessions \
  https://agentrelay.com/cloud/api/v1/mcp/shared-sessions
claude mcp get agent-relay-sessions
```

Codex — its MCP entry is user-wide, so confirm that scope with the person. Add
only the URL, then start Codex's OAuth login:

```sh
codex mcp add agent-relay-sessions \
  --url https://agentrelay.com/cloud/api/v1/mcp/shared-sessions
codex mcp login agent-relay-sessions
codex mcp get agent-relay-sessions
```

Muse — verified with Muse Code 1.4.10: the configuration key is camelCase
`mcpServers`, and OAuth login is `muse mcp login <server>`. There is no MCP add
subcommand, so merge a headerless, user-global entry into
`~/.config/muse/settings.json`, then log in. Confirm user-wide scope first.
`mode: optional` keeps a disconnected server to a warning instead of aborting
the run. The snippet tolerates a missing file or directory, keeps
`schema_version`, removes the obsolete snake_case entry if the earlier guidance
created one, and replaces the file atomically; malformed JSON still errors:

```sh
python3 - <<'EOF'
import json, os, stat, tempfile
p = os.path.expanduser('~/.config/muse/settings.json')
os.makedirs(os.path.dirname(p), exist_ok=True)
mode = stat.S_IMODE(os.stat(p).st_mode) if os.path.exists(p) else 0o600
try:
    with open(p) as f:
        d = json.load(f)
except FileNotFoundError:
    d = {}
d.setdefault('schema_version', 1)
legacy = d.get('mcp_servers')
if isinstance(legacy, dict):
    legacy.pop('agent-relay-sessions', None)
    if not legacy:
        d.pop('mcp_servers', None)
d.setdefault('mcpServers', {})['agent-relay-sessions'] = {
    "transport": "streamable_http",
    "url": "https://agentrelay.com/cloud/api/v1/mcp/shared-sessions",
    "mode": "optional"
}
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p))
try:
    with os.fdopen(fd, 'w') as f:
        json.dump(d, f, indent=2)
    json.load(open(tmp))  # validate before replacing
    os.replace(tmp, p)
    os.chmod(p, mode)
finally:
    if os.path.exists(tmp):
        os.unlink(tmp)
EOF
python3 -m json.tool ~/.config/muse/settings.json > /dev/null && echo config-ok
muse mcp login agent-relay-sessions
```

Scope limit: the desktop admits only Claude/Codex sessions (`POST /register`
discovers the nearest live Codex or Claude ancestor), so a Muse-driven session
cannot pass section 2's registration checks. The Muse block installs MCP tools
only; drive the rest of this skill — and any promised two-way handoff — from a
Claude/Codex session.

Cursor and ChatGPT (and other OAuth-capable hosted clients) — add the Shared
Sessions URL as a remote MCP server/custom connector with **no custom
Authorization header**, choose OAuth/Authenticate, and approve the Agent Relay
connection in the browser. Use the client's supported refresh/new-chat action
after connection so it rediscovers tools.

Restart or reconnect the current client after adding or changing the entry.
Existing running MCP sessions do not inherit changed configuration or a newly
completed login automatically.

## 4. Confirm the handoff tools loaded

In the refreshed session, confirm the tools are present before using them. The
authoritative check is that the tools actually appear to this agent:

```sh
# Claude Code: the tools surface as mcp__agent-relay-sessions__*
claude mcp get agent-relay-sessions
# Codex
codex mcp get agent-relay-sessions
# Muse: run /mcp in an interactive session and check that
# agent-relay-sessions appears connected
```

Then call `list_relay_agents` through the MCP (an MCP tool call, not a shell
command). A successful roster proves the MCP and OAuth work, but not by itself
that OAuth selected the same workspace as Desktop. Require the exact
`agent@machine` address from section 2's `.data.session` in the roster and, when
the roster declares its session, require that `session_id` to equal section 2's
session id. If either disagrees, stop and reconnect OAuth to the Desktop's
reported workspace.

When the current Desktop session is included by the person's sharing mode,
also call `get_shared_session_context` for that exact session id and require
real content plus a dashboard citation. That is the strongest check that the
Desktop uploader and hosted MCP read path meet in the same workspace. Under
`new` or `selected`, the current session may legitimately be absent as section
2 explains; report that read-path proof as pending instead of treating another
workspace's valid roster as success.

If a call errors with auth, reconnect OAuth for the intended workspace (`/mcp`
Authenticate in Claude Code, `codex mcp login agent-relay-sessions`, or
`muse mcp login agent-relay-sessions`) and refresh the session. Do not fall back
to the dashboard history token.

## 5. Offer to invite teammates

A handoff needs a teammate in the same organization. If none is there yet, this
agent can send the invites itself. Ask once, and accept "no" as an answer:

> Do you want me to invite teammates to *<organization name>*? Give me their
> email addresses and I'll send each one an invite.

Invite only addresses the person typed in this conversation. Never take them
from a roster, a repo, git history, or a provider mount. Before sending, read
the list back and wait for a yes: "I'll invite a@example.com and
b@example.com as members of *<organization name>*. Send?"

**This section does not depend on sections 3–4.** It uses neither the hosted
MCP connection nor its OAuth credentials, only the separate Cloud device-flow
sign-in. Run it as soon as the person answers preflight item 4. A pending MCP
authentication or client restart must never hold back invites they asked for.

**What an invite grants.** Invites are scoped to the **organization**, not a
single workspace. Accepting one makes the teammate a member of the
organization, with access to every workspace in it. Tell the person that before
sending. Agents can invite **members** only. Making someone an owner stays a
dashboard decision, and the API refuses `role: "owner"` from an agent.

**Credential.** The invites API accepts a Cloud access token from the device
flow in `signing-in-to-agent-relay-cloud`, held as `CLOUD_API_ACCESS_TOKEN` in
that skill's private session. In the agent-driven signup, Part 1 already did
this sign-in. If this skill runs on its own, sign in with that skill first. If
it is not installed, install it with
`npx prpm install @agent-relay/signing-in-to-agent-relay-cloud --as claude --global -y`,
then read `~/.claude/skills/signing-in-to-agent-relay-cloud/SKILL.md` and
follow it directly. It is a plain HTTP device flow, so no restart is needed.
The dashboard's Read-only sessions token will not work for invites, and an MCP
client's OAuth tokens must never be extracted or reused here. Never print any
credential.

**Check ownership first.** Only organization owners can invite. Call
`GET /api/v1/auth/whoami` and check `currentOrganization.role`. If it is not
`owner`, do not try. Tell the person to ask an owner to invite their teammates
from **Settings → Members** in the dashboard, then continue to section 6.

**Never print an invite link into this session.** The uploader shares this
session with the person's teammates, and every invite response carries an
`acceptUrl`. So the response goes to a private temp file, and only the fields
the person needs are printed.

**Send.** Make one `POST /api/v1/invites` per address. Pass the token on stdin
so it never reaches process argv. The body carries no secret:

```sh
resp=$(mktemp) && hdrs=$(mktemp) && chmod 600 "$resp" "$hdrs"
code=$(printf 'Authorization: Bearer %s\n' "$CLOUD_API_ACCESS_TOKEN" |
  curl -sS --max-time 30 -X POST "${CLOUD_API_URL:-https://agentrelay.com/cloud}/api/v1/invites" \
    -H @- -H 'Content-Type: application/json' \
    --data '{"email":"teammate@example.com","role":"member"}' \
    -D "$hdrs" -o "$resp" -w '%{http_code}')
# Print the outcome only; acceptUrl stays in the temp file, which is deleted.
python3 -I - "$resp" "$code" <<'PY'
import json, sys
try:
    body = json.load(open(sys.argv[1]))
except ValueError:
    body = {}
invite = body.get("invite") or {}
print("HTTP", sys.argv[2], "| email:", invite.get("email"),
      "| delivery:", invite.get("emailDelivery"), "| expires:", invite.get("expiresAt"),
      "| error:", body.get("error"), "| code:", body.get("code"))
PY
grep -i '^retry-after:' "$hdrs" || true
rm -f "$resp" "$hdrs"
```

Report each address by `emailDelivery`:

| `emailDelivery` | Meaning | Tell the person |
| --- | --- | --- |
| `sent` | The email went out | "Invite emailed to …" |
| `failed` | The invite exists, but the email was not sent | Copy that teammate's link from **Settings → Members** in the dashboard, and send it to them directly |
| `not_configured` | Email is off in this environment; nothing was sent | Same: copy the link from **Settings → Members** |

Do not report an invite as emailed unless the response says `sent`. An invite
link only works when signed in with the invited email address, and it expires
after 7 days (`expiresAt`). The person copies it from the dashboard and sends
it straight to that teammate: not in this session, a `send_relay_message`
body, a shared channel, or any artifact.

| Status | Meaning | Do |
| --- | --- | --- |
| 400 with `error` | For example, the address is already a member, or it is not an email | Report the `error` text for that address and continue with the rest |
| 401 | The token is missing or expired, or it is not a device-flow token | Refresh it with `signing-in-to-agent-relay-cloud` and retry once |
| 403 `not_org_owner` | This person is not an owner | Stop and route them to an owner, as above |
| 403 `agent_invite_role_forbidden` | `role` was not `member` | Send `"role":"member"` |
| 429 `agent_invite_rate_limited` | The per-person cap for agent-sent invites was hit | Wait for `Retry-After`; do not loop |

Re-inviting an address that already has a pending invite cancels the old link
and sends a new one. Do not resend just to check whether the first one worked.
To confirm, call `GET /api/v1/invites`, with the same auth, as an owner. It
lists pending invites. Its response also carries each `acceptUrl`, so filter it
the same way and print only each invite's `email` and `expiresAt`.

Invited teammates join by accepting the invite, then running this same
onboarding on their own machine. Once one is online, they are the counterpart
for section 6. Do not hold this person's setup open waiting for them.

## 6. Prove one live round trip

The real proof is agent-to-agent, so it needs a counterpart. Pick the path that
matches what is available:

**A teammate's agent is online (full round trip).** Ask the person for the
teammate's relay address (e.g. `@manav`), then:

1. `list_relay_agents` — confirm the teammate's address is listed.
2. **Prove the reverse read path first:** call `get_shared_session_context` on
   the teammate's session and confirm it returns their **real** content (prompts/
   events + a dashboard citation link). If it errors or is empty, their uploader
   is unhealthy — stop and have them fix it; do not declare GREEN, because this
   side cannot actually read their work yet.
3. `send_relay_message` — send a short, uniquely-marked message to that address.
4. The teammate's agent reads this session with `get_shared_session_context` and
   continues; have them reply through the relay.
5. GREEN requires **both directions**: this agent read the teammate's real
   content (step 2) **and** the teammate's reply lands here. There is no
   automatic ack — confirm by the reply/activity, not a push. Because Relay
   injects an inbound message only when the session is idle between turns, **end
   the turn** after sending and confirm the reply on the next turn; do not sleep
   or poll inside one turn.
6. Only when this session reports `session.direct_delivery:false` (a Claude
   Code session with a kept choice): with `hold`, the reply arrives as a held
   message; ask the person to approve it, then confirm it on the next turn.
   With `refuse` and no yes to the opt-in, the reply is dropped: report setup
   as **blocked on the person's choice**, naming the opt-in, not as complete,
   and not as failed. A session reporting `true` follows steps 1–5 unchanged.

**No teammate online yet (self-verify the read path).** Prove the machinery
without a second person:

1. `list_relay_agents` returns the roster — MCP OAuth + workspace are good.
2. `search_shared_sessions` / `get_shared_session_context` return this person's
   **own** recently uploaded session (real prompts/events plus a dashboard
   citation link) — the uploader→read path works.
3. Record that the two-party round trip still needs the teammate online, and
   name it as the remaining step rather than claiming the handoff is proven.
   Setup is not complete until the full round trip succeeds.

Never paste any bearer, OAuth token, session token, workspace key, or API key
into a `send_relay_message` body or any artifact.

## 7. Report

Separate verified facts from what still needs a human or a second machine:

- app version, `signed_in`, the signed-in **workspace id and name**;
- uploader `healthy`, this session's `agent@machine` address, and direct
  delivery on, or the person's kept `crossSessionInbound` value and what it
  does (held for approval, or dropped), with the opt-in they were offered;
- agent-sessions MCP installed without a custom auth header, OAuth connected,
  and its tools confirmed loaded in this session;
- teammate invites: each address with its `emailDelivery` outcome (and, for
  any not `sent`, that the person was pointed to **Settings → Members** to copy
  the link), or that they
  declined, or that only an owner can invite and who to ask;
- `list_relay_agents` roster seen; and either the full round-trip evidence (the
  teammate's real content + reply) or the self-verified read path plus the named
  remaining step (teammate online);
- the other tools they named in preflight item 3, each with its next step from
  the routing list there (or that it has no setup path yet).

Do not call the setup complete on a 2xx from `claude mcp add` alone, and do not
count a roster listing as a proven handoff.

## Recovery

- **`not_a_relay_session` from `/setup/*`:** the caller is not inside a discovered
  interactive session. Run it from this agent's own shell inside an **interactive**
  Claude Code or Codex session — a non-interactive `codex exec` or `claude -p` run
  is not admitted, and neither is an unrelated terminal, nor (currently) any Muse
  session. In tmux/SSH, confirm the
  agent process and shell share the pane's process tree.
- **No handoff tools in the session:** the MCP was added after the session
  started, is at the wrong scope, or the client cached tool discovery. Reinstall
  at the right scope (section 3 — project-local by default for Claude,
  user-global for Codex and Muse), authenticate, then reconnect/restart or open
  a new chat as the client requires.
- **`list_relay_agents` auth error:** confirm the entry has the URL only and no
  custom `Authorization`/bearer setting. Reconnect personal OAuth for the
  intended workspace (`/mcp` Authenticate in Claude Code,
  `codex mcp login agent-relay-sessions`, or
  `muse mcp login agent-relay-sessions`), then refresh the session. Do not fix
  an interactive client by minting the dashboard's Read-only sessions token.
- **Spawn tools refuse the connection:** `list_relay_spawn_targets` and the
  other hosted launch tools require a person OAuth/browser/personal-CLI
  connection whose current user is a workspace owner or organization admin.
  History tokens and machine/service/workspace keys cannot launch. Reconnect
  with OAuth or correct the person's role; do not invent a machine-key setup.
- **Invited teammate never got the email:** check the invite's
  `emailDelivery`. If it is not `sent`, the email never left; have the person
  copy the link from **Settings → Members** and send it to that teammate. If it is `sent`, have the
  teammate check spam for mail from `noreply@agentrelay.com`. Only re-invite to
  replace an expired link.
- **Teammate's address missing from the roster:** they are not on the **same**
  workspace, or their session is not on the relay. Have them register their
  session and confirm the shared workspace id.
- **Can't read the teammate's session:** their **uploader** is not healthy
  (paused or a failed cycle). Have them check `/setup/status` shows
  `uploader.healthy == true`, not "Sync paused/offline".
- **Message arrives held, not live:** direct delivery is off for the recipient
  (Codex delivers directly by default). If their `/setup/status` shows a
  `direct_delivery_user_choice`, they chose it: tell them, and POST
  `{"enabled":true}` to `/setup/direct-delivery` on their machine only when
  they say yes. Otherwise apply the default the way
  `setting-up-agent-relay-desktop` section 4 does: `{"default":true}`, which
  never overrides a choice, and on an older build that answers
  `invalid_enabled`, its settings-file check before any `{"enabled":true}`. A managed Claude policy can block this; report it
  rather than editing managed settings.
- **Remove the MCP:** remove Claude Code at the scope where it was installed:
  `claude mcp remove --scope local agent-relay-sessions` (default setup) or
  `claude mcp remove --scope user agent-relay-sessions` (user-wide setup);
  `codex mcp logout agent-relay-sessions && codex mcp remove agent-relay-sessions`
  or `muse mcp logout agent-relay-sessions` and delete the
  `agent-relay-sessions` key under `mcpServers` in
  `~/.config/muse/settings.json`. This removes only the hosted handoff tools;
  it does not sign the Desktop out or stop uploads.

## Relationship to the other skills

- **`setting-up-agent-relay-desktop`** — the layer below this one: install,
  sign-in, agent-led defaults, self-registration. Use it when section 2 is not
  yet satisfied.
- **`relay-connect`** — a lighter, account-free, time-boxed way for two agents to
  share one session via a hand-over link. Prefer it for an ad-hoc pairing;
  prefer this skill for durable teammate-to-teammate handoff inside a shared
  workspace.
