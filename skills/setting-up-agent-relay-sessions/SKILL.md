---
name: setting-up-agent-relay-sessions
description: Get a person set up for live agent-to-agent session handoff on Agent Relay end-to-end from a running Codex or Claude session, so their agent and a teammate's agent can message each other and read each other's real sessions (prompts, events, tool calls, file edits). Also installs the same MCP for Muse Code (tools only — the desktop admits only Claude/Codex sessions, so live handoff still needs a Claude/Codex-driven session). Covers verifying desktop setup (browser sign-in through the desktop app), minting the Sessions MCP token from the desktop app and installing the agent-sessions cloud MCP before the session starts, confirming the handoff tools loaded, offering to invite the person's teammates to their organization, and proving one live round trip. Use when a human asks an agent to "set me up for session handoff", "connect my agent to <teammate>", or finish the onboarding we send new teammates — instead of walking them through the app and the dashboard by hand.
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
- the **agent-sessions cloud MCP** is installed in this project and loaded by
  this session, so the handoff tools (`list_relay_agents`, `send_relay_message`,
  `read_relay_conversation`, `check_relay_inbox`, `get_shared_session`,
  `get_shared_session_context`, `search_shared_sessions`) are available;
- the person was asked whether to invite teammates, and either every address
  they gave was invited through the Cloud invites API with its delivery outcome
  reported, or they were given the dashboard's Members link to invite from
  (section 5), or they declined;
- a live round trip is proven when a teammate is online: this agent messages the
  teammate's agent, **reads the teammate's real session back** with
  `get_shared_session_context`, and the teammate reads this session and replies.
  When no teammate is online yet, the roster plus this person's own uploaded
  session reading back cleanly completes setup, reported as **self-verified**
  rather than as a proven two-way handoff, with the teammate round trip named as
  the next step once one joins (section 5's invites bring them in).

## Requires

This skill builds on `setting-up-agent-relay-desktop` (verified install, sign-in,
registration, agent-led defaults). If that skill is **not installed** in this
agent, stop, tell the person, and have them install the companions together,
then restart the agent. Do not improvise the install or sign-in from memory.

- prpm: `npx prpm install collections/agent-relay-setup --as claude --global -y`
- skills.sh: `npx skills add https://github.com/AgentWorkforce/skills --skill setting-up-agent-relay-desktop --skill setting-up-agent-relay-sessions`
- Codex: do not use prpm's `--as codex` (it drops paragraphs and writes under `~/.agents/skills`, which Codex does not load as its global skill folder). Mirror the installed `SKILL.md` files into `~/.codex/skills/<name>/` with the loop in **Install this skill (and its dependency)** below.

## The only human steps

Everything else is automatable; be honest that these are not. **Tell the
person about all of them up front, before touching anything:**

1. **Sign in with Google in the browser the desktop app opens** — only when no
   reusable desktop or `agent-relay` CLI login exists. A reused login needs zero
   clicks. The desktop skill drives this (its section 3).
2. **Restart the agent once** after section 3, from an environment that exports
   `AGENT_RELAY_SESSIONS_TOKEN`. MCPs load only at startup. The token itself
   needs nothing from the person: this agent obtains it from the desktop app's
   `POST /setup/sessions-token` and writes it straight into private storage
   (see **Token handling**). The token belongs to the workspace the app is
   signed in to, so the MCP and the desktop always share a workspace.
3. **Same workspace, both sides.** The teammate (or workspace admin) must have
   invited this person's email to the **shared** workspace — two agents can only
   reach each other inside one workspace. Confirm the workspace id matches on
   both machines; do not guess it. If this person owns the organization, they
   can invite teammates themselves (section 5); the human step is only naming
   who to invite.

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
package and the desktop skill it depends on, then mirror the unchanged
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

With skills.sh instead, use the command under **Requires**; it installs into each agent's skills folder directly, so the manual Codex mirror below is only for the prpm route.

Do not use prpm's `--as codex` conversion for these packages: it writes under
`~/.agents/skills`, which Codex does not load as its global skill folder, and it
drops explanatory paragraphs from the Markdown workflow. Confirm both final
paths explicitly before continuing.

## Why ordering matters

MCPs load at agent **startup**. The agent-sessions MCP must be installed
**before** the session that will use it starts. A session already running when
the MCP was added has no handoff tools and must be **restarted**. Install the
MCP (section 3) before relying on the tools (sections 4 and 6); if this very session
predates the MCP, say so and restart it rather than reporting missing tools as a
failure.

## Token handling

The token is a read-only Sessions MCP token (`cld_at_…`) for the desktop
app's signed-in workspace. `POST /setup/sessions-token` returns it once, and
section 3 writes it from the response straight into private storage. It must
never land in the agent conversation, in a log, in a Relay message, in process
argv, in `~/.claude.json`, or in the repo. Three places leak it, and this skill
avoids all three:

- **The chat and logs** — this session is uploaded and teammate-readable, so a
  token printed by any command leaks to the workspace. Section 3 pipes the
  response into storage with `jq` and prints only the workspace and MCP URL;
  the agent only ever refers to the variable **name**.
- **Process argv** — a token interpolated into `claude mcp add --header
  "... Bearer $TOKEN"` is visible to `ps` and gets written literally into
  `~/.claude.json`. Pass the unexpanded placeholder `${AGENT_RELAY_SESSIONS_TOKEN}`
  instead; Claude Code expands `${VAR}` in MCP headers from the environment at
  launch, so the stored config holds only a reference and argv holds only the
  literal `${…}`. **This expansion exists only in Claude Code ≥ 2.1.119** — an
  older client sends the placeholder literally and auth fails, so check the
  version first (section 3) and update Claude rather than inlining the token.
- **The launching environment** — all three CLIs read the token from an environment
  variable (`${VAR}` for Claude, `--bearer-token-env-var` for Codex, `${VAR}`
  interpolation in Muse server configs), so the
  variable must exist in the environment that **launches the agent**, not in a
  transient shell-tool subprocess (which cannot alter its parent or a later
  process).

Use the single variable name `AGENT_RELAY_SESSIONS_TOKEN` throughout:

- **Storage:** a mode-0600 file at
  `${XDG_CONFIG_HOME:-$HOME/.config}/agent-relay/sessions-token`, with the
  workspace it was minted for beside it in `sessions-token.json`. Section 3
  writes both; the file is the one source every launcher reads, so a fresh
  mint reaches the next launch without touching anything else.
- **Supply:** the environment that launches the agent exports it
  **non-interactively** from that file. Put this line in the person's shell
  profile or a dedicated launcher they start the agent from, with their yes
  (the agent can add it itself), in place of any line that sets the variable
  another way (the keychain, or a literal value):

  ```sh
  export AGENT_RELAY_SESSIONS_TOKEN="$(cat "${XDG_CONFIG_HOME:-$HOME/.config}/agent-relay/sessions-token" 2>/dev/null)"
  ```

The agent never prints the value; verify presence only with
`test -n "${AGENT_RELAY_SESSIONS_TOKEN:-}"` or `test -s` on the file.

## 0. Preflight: collect the human inputs first

Before section 1, tell the person what they need and ask for it in one message:

1. the **shared workspace id** (or the teammate/admin who invited them);
2. that they will sign in with Google in the browser the desktop app opens
   (only without a reusable login), and restart this agent once after
   section 3; no token or dashboard visit is needed from them;
3. the **teammate's relay address** for the round trip, if one will be online.
4. **which coding tools and ADEs they use** besides this one (Claude Code,
   Codex, Cursor, OpenCode, Grok Build, Devin, Capy, other), so every tool they
   work in ends up on the relay, not just this session.
5. whether they want to **invite teammates**, and if so their email
   addresses. Optional; section 5 handles it, so asking now lets the invites
   go out while the desktop work runs on this side.

Route each tool they name once this session's own setup is installed and
self-verified (sections 1–4); do not start another setup mid-way, and do not
hold it for a teammate. A tool set up that way can be the counterpart for
section 6's round trip, so report a pending round trip instead of stopping. Claude Code or Codex other than this session: run this
same skill from inside that tool, since each configures its own MCP and token
path. Grok Build: `plugins/grok/agent-relay` in `AgentWorkforce/skills`.
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
Relay CLI 13.0.0 or newer is installed (a user-level npm, mise or nvm `agent-relay`, not
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
# Gate only these optional checks on >= 13; keep relay_cli itself, which
# setting-up-agent-relay-desktop section 6 uses with its own version handling.
relay_cli_checks=
relay_cli_major=${relay_cli_version%%.*}
if test -n "$relay_cli_major" && test "$relay_cli_major" -ge 13; then
  relay_cli_checks=1
elif test -n "$relay_cli"; then
  printf 'agent-relay %s is older than 13.0.0; read the workspace from /setup/status instead.\n' "${relay_cli_version:-unknown}" >&2
fi
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

Check presence without printing the value:

```sh
test -n "${AGENT_RELAY_SESSIONS_TOKEN:-}" && echo token=in-environment || echo token=not-in-environment
test -s "${XDG_CONFIG_HOME:-$HOME/.config}/agent-relay/sessions-token" && echo token=stored || echo token=not-stored
```

Section 3 reuses a stored token only when it was minted for the workspace the
desktop is signed in to, and mints one otherwise, or when the tools answer with
an auth error. Minting needs a signed-in desktop, so it happens in section 3,
after section 2. The MCP config stores only a `${AGENT_RELAY_SESSIONS_TOKEN}`
reference, never the value, so the person restarts the agent **once**, after
section 3, from an environment that exports the token; that single restart both
loads the MCP and supplies the credential. Sections 4 and 6 are gated on that
restart. Section 5 is not, so handle any invites the person asked for before
asking for that restart.

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
does not prove that **this** session is among them. A registered session
uploads in every mode: under `selected` (**Only sessions I choose**, the
default), registering it or turning on its **Receive messages** chooses it.
If `/setup/status` does not show this session registered, tell the person that
it may not be shared yet; do not change the sharing mode or select sessions on
their behalf. Section 6's round trip is the
proof: if the teammate cannot read this session there, this is the first
thing to check.

## 3. Install the agent-sessions cloud MCP (before the session uses it)

### Obtain the token from the desktop app

Ask the signed-in desktop app for a Sessions MCP token with section 1's
`relay_req`. The response carries the token once, plus the workspace it belongs
to and the MCP URL:

```json
{"ok":true,"data":{"token":"cld_at_…","workspace":{"id":"…","name":"…"},"mcp_url":"https://agentrelay.com/cloud/api/v1/mcp/shared-sessions"}}
```

The token is bound to the workspace it was minted for. Next to the token file,
a mode-0600 `sessions-token.json` records that workspace id and the `mcp_url`
(no secret). The block reuses the stored token only when that workspace is the
one `/setup/status` reports now, and mints otherwise, or when
`sessions_force_mint=1` is set (section 4's auth-error recovery). A mint writes
the token from a private temp file straight into storage without printing it,
and shows only the workspace and URL:

```sh
sessions_dir="${XDG_CONFIG_HOME:-$HOME/.config}/agent-relay"
sessions_token_file="$sessions_dir/sessions-token"
sessions_meta_file="$sessions_dir/sessions-token.json"   # workspace id + mcp_url, no secret
desktop_workspace=$(relay_req GET /setup/status | jq -r '.data.workspace.id // empty')
if test -z "$desktop_workspace"; then
  echo 'Could not read the signed-in workspace; finish section 2 first.' >&2
  exit 1
fi
sessions_mcp_url=
if test -z "${sessions_force_mint:-}" && test -s "$sessions_token_file" &&
   test "$(jq -r '.workspace_id // empty' "$sessions_meta_file" 2>/dev/null)" = "$desktop_workspace"; then
  sessions_mcp_url=$(jq -r '.mcp_url // empty' "$sessions_meta_file")
  echo "token=reused workspace=$desktop_workspace"
else
  mkdir -p "$sessions_dir" && chmod 700 "$sessions_dir"
  sessions_resp=$(mktemp) && chmod 600 "$sessions_resp"
  if ! relay_req POST /setup/sessions-token '{}' >"$sessions_resp"; then
    echo 'The Agent Relay socket request failed; nothing was stored.' >&2
  elif jq -e '.ok == true and (.data.token | type == "string" and startswith("cld_at_"))' \
      "$sessions_resp" >/dev/null 2>&1; then
    if (umask 077 &&
        jq -j '.data.token' "$sessions_resp" >"$sessions_token_file.tmp" &&
        jq '{workspace_id: .data.workspace.id, workspace_name: .data.workspace.name, mcp_url: .data.mcp_url}' \
          "$sessions_resp" >"$sessions_meta_file.tmp") &&
       mv "$sessions_token_file.tmp" "$sessions_token_file" &&
       mv "$sessions_meta_file.tmp" "$sessions_meta_file"; then
      sessions_mcp_url=$(jq -r '.mcp_url // empty' "$sessions_meta_file")
      jq . "$sessions_meta_file"
    else
      echo 'Could not store the Sessions token; nothing was installed.' >&2
    fi
  else
    # Only the code and message: never the whole reply.
    jq -c '{code: .error.code, message: .error.message}' "$sessions_resp" >&2 ||
      echo 'No readable reply from Agent Relay.' >&2
  fi
  rm -f "$sessions_resp" "$sessions_token_file.tmp" "$sessions_meta_file.tmp"
fi
if test -z "$sessions_mcp_url"; then
  echo 'No Sessions token for this workspace; resolve the refusal below before adding the MCP.' >&2
  exit 1
fi
```

The minted workspace is the one `/setup/status` reported in section 2; report
its name and id. Refusals, read from `.error.code`:

| Code | Meaning | Do |
| --- | --- | --- |
| `not_signed_in` (409) | The desktop is signed out | Run `setting-up-agent-relay-desktop` section 3, then run this block again |
| `sessions_token_unavailable` (502) | Cloud did not issue a token | Retry once shortly; then report it as a blocker |
| `sessions_token_limit` (409) | The workspace holds its maximum number of Sessions tokens | Ask the person to revoke a Sessions token they no longer use in the dashboard, then run this block again |
| `sessions_token_rate_limited` (429) | Too many mints | Wait the seconds `.error.message` names, then retry once; do not loop |

Each mint creates another token, so the block reuses a stored token for the same
workspace. Shell variables do not survive between tool calls: run this
section's blocks in one shell. In a new shell, run this block again; it reuses
the stored token and restores `sessions_mcp_url` without minting.

### Point the launcher at the stored token

The launcher must export the token from the file the block just wrote, so a
later mint takes effect on the next restart. Check whether this session was
launched that way, without printing either value:

```sh
if test -n "${AGENT_RELAY_SESSIONS_TOKEN:-}" &&
   test "$AGENT_RELAY_SESSIONS_TOKEN" = "$(cat "$sessions_token_file")"; then
  echo launcher=current
else
  echo launcher=needs-update
  # File names only: a matching line may hold a literal token.
  grep -l AGENT_RELAY_SESSIONS_TOKEN ~/.zshrc ~/.zprofile ~/.bashrc ~/.bash_profile ~/.profile 2>/dev/null || true
fi
```

On `needs-update`, with the person's yes, put the export line from **Token
handling** in their shell profile or launcher. If a listed file already sets
`AGENT_RELAY_SESSIONS_TOKEN` another way (the keychain, or a literal value),
replace that line rather than adding a second one, without printing it. A
line that already reads the `sessions-token` file needs no change: the restart
picks up the new token. A launcher the person maintains elsewhere gets the same
line from them.

### Add the MCP

In production `mcp_url` is
`https://agentrelay.com/cloud/api/v1/mcp/shared-sessions`; use the value the
mint returned, which follows the Cloud the desktop is signed in to. Detect which
agent CLI this session runs and install accordingly.

Claude Code — pass the **unexpanded** placeholder so the token stays out of argv
and out of `~/.claude.json`; Claude expands `${VAR}` in MCP headers from the
environment at launch. This expansion requires **Claude Code ≥ 2.1.119**, so
verify the version first and update rather than inlining the token on an older
client. Single-quote the header so the shell does not expand it here. Default
scope is `local` (this project only), which is what you want:

```sh
claude_ver=$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if test -z "$claude_ver" || test "$(printf '%s\n2.1.119\n' "$claude_ver" | sort -V | head -1)" != 2.1.119; then
  echo "Claude Code $claude_ver does not expand \${VAR} in MCP headers (need >= 2.1.119); update Claude Code before adding this server." >&2
  exit 1
fi
claude mcp add --transport http agent-relay-sessions \
  "${sessions_mcp_url:?set sessions_mcp_url to the mint response mcp_url}" \
  --header 'Authorization: Bearer ${AGENT_RELAY_SESSIONS_TOKEN}'
claude mcp list | grep -F agent-relay-sessions
```

Codex — `codex mcp add` records the **variable name**, not the value, and writes
to user-level `~/.codex/config.toml`, so the server is enabled for **all** Codex
projects (Codex has no project-scoped MCP). Confirm the person is OK with
user-wide access before adding it:

```sh
codex mcp add agent-relay-sessions \
  --url "${sessions_mcp_url:?set sessions_mcp_url to the mint response mcp_url}" \
  --bearer-token-env-var AGENT_RELAY_SESSIONS_TOKEN
codex mcp list | grep -F agent-relay-sessions
```

Muse — there is no `mcp add` command; merge the server into the user-global
`~/.config/muse/settings.json` under the `mcp_servers` block (snake_case —
`mcpServers` is not read), so the server is enabled for **all** Muse projects.
Confirm the person is OK with user-wide access before adding it, as with Codex.
Muse interpolates `${VAR}` in server configs at launch, so store the
placeholder, never the value. `mode: optional` keeps a down server to a warning
instead of aborting the run. The snippet tolerates a missing file or directory,
keeps `schema_version` (Muse requires it), and replaces the file atomically so
an interrupted write cannot truncate a working config; malformed existing JSON
still errors out instead of being overwritten:

```sh
SESSIONS_MCP_URL="${sessions_mcp_url:?set sessions_mcp_url to the mint response mcp_url}" python3 - <<'EOF'
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
d.setdefault('mcp_servers', {})['agent-relay-sessions'] = {
    "transport": "streamable_http",
    "url": os.environ["SESSIONS_MCP_URL"],
    "headers": {"Authorization": "Bearer ${AGENT_RELAY_SESSIONS_TOKEN}"},
    "mode": "optional",
    "enabled": True
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
```

Scope limit: the desktop admits only Claude/Codex sessions (`POST /register`
discovers the nearest live Codex or Claude ancestor), so a Muse-driven session
cannot pass section 2's registration checks. The Muse block installs MCP tools
only; drive the rest of this skill — and any promised two-way handoff — from a
Claude/Codex session.

Because MCPs load at startup, the running session must be **restarted** to pick
up the server — and because all three CLIs read the token from the environment at
launch, the restarted process must **inherit** `AGENT_RELAY_SESSIONS_TOKEN`.
That is why the export line belongs in the shell profile / launcher, not a
transient shell-tool subprocess: an `export` in this agent's shell tool cannot
reach the parent or a freshly launched session. After the restart, re-verify presence with
`test -n "${AGENT_RELAY_SESSIONS_TOKEN:-}"` before using the tools, and do not
report the tools as missing without first confirming the session started *after*
the MCP was added and with the variable set.

## 4. Confirm the handoff tools loaded

In the session that started after the MCP was added, confirm the tools are
present before using them. List this session's MCP tools and check for the
agent-sessions set; the authoritative check is that the tools actually appear to
this agent:

```sh
# Claude Code: the tools surface as mcp__agent-relay-sessions__*
claude mcp list | grep -F agent-relay-sessions
# Muse has no mcp list; run /mcp in an interactive session and check
# agent-relay-sessions appears with its tools connected
```

Then call `list_relay_agents` through the MCP (an MCP tool call, not a shell
command). A successful call that returns the workspace roster proves the MCP is
loaded, the token is valid, and this session can see the shared workspace. If
the call errors with auth, the token is wrong, revoked, or for another
workspace: run section 3's token block with `sessions_force_mint=1` set (it
overwrites the stored file), run its launcher check, then restart the agent so
it reads the new value.

## 5. Offer to invite teammates

A handoff needs a teammate in the same organization. If none is there yet,
help the person invite them. Ask once, and accept "no" as an answer:

> Do you want to invite teammates to *<organization name>*? Give me their
> email addresses and I'll get each one an invite.

**This section does not depend on sections 3–4.** It uses neither the
agent-sessions MCP nor `AGENT_RELAY_SESSIONS_TOKEN`. Run it as soon as the
person answers preflight item 5, and in any case before asking them to restart
for section 3. A pending restart must never hold back invites they asked for.

**Pick the path by credential.** The invites API needs a Cloud access token,
held as `CLOUD_API_ACCESS_TOKEN` (for example from
`signing-in-to-agent-relay-cloud` earlier in this session). Check for it
without printing it:

```sh
test -n "${CLOUD_API_ACCESS_TOKEN:-}" && echo cloud_token=present || echo cloud_token=missing
```

- **No Cloud access token:** do not start a Cloud sign-in for this. Give the
  person the dashboard's Members page, where an owner invites by email:
  `https://agentrelay.com/cloud/dashboard/settings#members` (the dashboard's
  **Settings → Members**; on a local or staging Cloud, the same path on that
  base). Read back the addresses they named so they can enter them there, tell
  them what an invite grants (below), and continue to section 6.
- **A Cloud access token is present:** send the invites through the API as
  follows. `AGENT_RELAY_SESSIONS_TOKEN` will not work: it is a read-only MCP
  token, and the invites API answers it with 401. Never print either token.

Invite only addresses the person typed in this conversation. Never take them
from a roster, a repo, git history, or a provider mount. Before sending, read
the list back and wait for a yes: "I'll invite a@example.com and
b@example.com as members of *<organization name>*. Send?"

**What an invite grants.** Invites are scoped to the **organization**, not a
single workspace. Accepting one makes the teammate a member of the
organization, with access to every workspace in it. Tell the person that before
sending. Agents can invite **members** only. Making someone an owner stays a
dashboard decision, and the API refuses `role: "owner"` from an agent.

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
| 401 | The token is missing or expired, or it is not a device-flow token | If this session can refresh it (`signing-in-to-agent-relay-cloud`'s refresh step), refresh and retry once; otherwise give the person the Members link above |
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

1. `list_relay_agents` returns the roster — MCP + token + workspace are good.
2. `search_shared_sessions` / `get_shared_session_context` return this person's
   **own** recently uploaded session (real prompts/events plus a dashboard
   citation link) — the uploader→read path works.
3. Setup is complete and reported as **self-verified**: the roster and this
   session's own read path work, and the two-party round trip is not yet
   proven. Name the teammate round trip as the next step once a teammate joins
   (section 5's invites bring one in); never report a self-verified setup as a
   proven handoff.

Never paste the Bearer token or any session token into a `send_relay_message`
body or any artifact.

## 7. Report

Separate verified facts from what still needs a human or a second machine:

- app version, `signed_in`, the signed-in **workspace id and name**;
- uploader `healthy`, this session's `agent@machine` address, and direct
  delivery on, or the person's kept `crossSessionInbound` value and what it
  does (held for approval, or dropped), with the opt-in they were offered;
- the Sessions MCP token minted for that workspace and stored (never its
  value), the agent-sessions MCP installed, and its tools confirmed loaded in
  this session;
- teammate invites: each address with its `emailDelivery` outcome (and, for
  any not `sent`, that the person was pointed to **Settings → Members** to copy
  the link), or that the person was given the Members link to invite from, or
  that they declined, or that only an owner can invite and who to ask;
- `list_relay_agents` roster seen; and either the full round-trip evidence (the
  teammate's real content + reply), or the self-verified read path with the
  teammate round trip named as the next step;
- the other tools they named in preflight item 4, each with its next step from
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
  started, or at the wrong scope. Reinstall at the right scope for the CLI
  (section 3 — project scope for Claude, user-global for Codex and Muse) and
  **restart** the session; MCPs load only at startup.
- **`list_relay_agents` auth error:** the token is wrong, revoked, or from a
  different workspace. Run section 3's token block with `sessions_force_mint=1`
  set, which overwrites the stored file, then its launcher check: the launcher
  must read that file, so replace a keychain or literal-value export with the
  file export line. Then **restart** the agent so it re-reads it. Because the MCP config stores only a
  **reference** to `AGENT_RELAY_SESSIONS_TOKEN`, re-running `claude mcp add` /
  `codex mcp add` alone changes nothing. If the desktop is signed in to the
  wrong workspace, fix that first with `setting-up-agent-relay-desktop`
  section 3. On Claude, also confirm the client is ≥ 2.1.119 (older clients
  send the `${VAR}` placeholder literally).
- **Invited teammate never got the email:** check the invite's
  `emailDelivery`. If it is not `sent`, the email never left; have the person
  copy the link from **Settings → Members** and send it to that teammate. If it is `sent`, have the
  teammate check spam for mail from `noreply@mail.agentrelay.com`. Only re-invite to
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
- **Remove the MCP:** `claude mcp remove agent-relay-sessions` /
  `codex mcp remove agent-relay-sessions` / delete the `agent-relay-sessions`
  key under `mcp_servers` in `~/.config/muse/settings.json`. This removes only
  the handoff tools; it does not sign the desktop out or stop uploads.

## Relationship to the other skills

- **`setting-up-agent-relay-desktop`** — the layer below this one: install,
  sign-in, agent-led defaults, self-registration. Use it when section 2 is not
  yet satisfied.
- **`relay-connect`** — a lighter, account-free, time-boxed way for two agents to
  share one session via a hand-over link. Prefer it for an ad-hoc pairing;
  prefer this skill for durable teammate-to-teammate handoff inside a shared
  workspace.
