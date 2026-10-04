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
- a live round trip is proven when a teammate is online: this agent messages the
  teammate's agent, **reads the teammate's real session back** with
  `get_shared_session_context`, and the teammate reads this session and replies.
  When no teammate is online yet, the fallback is the roster plus this person's
  own uploaded session reading back cleanly — reported as self-verified, not as a
  proven two-way handoff.

## Requires

This skill builds on `setting-up-agent-relay-desktop` (verified install, sign-in,
registration, agent-led defaults). If that skill is **not installed** in this
agent, stop, tell the person, and have them install the companions together,
then restart the agent. Do not improvise the install or sign-in from memory.

- prpm: `npx prpm install collections/agent-relay-setup --as claude --global -y`
- skills.sh: `npx skills add https://github.com/AgentWorkforce/skills --skill setting-up-agent-relay-desktop --skill setting-up-agent-relay-sessions`
- Codex: do not use prpm's `--as codex` (it drops paragraphs and writes under `~/.agents/skills`, which Codex does not load as its global skill folder). Mirror the installed `SKILL.md` files into `~/.codex/skills/<name>/` using the script in `setting-up-agent-relay-desktop`'s install section.

## The only human steps

Everything else is automatable; be honest that these are not. **Ask for all of
them up front, before touching anything** — the token in particular is needed
only at section 3, but minting it and exporting it into the launching
environment takes the person a few minutes, so have them start it while the
desktop install and sign-in run:

1. **Approve one Google device-login link** — only when no reusable `agent-relay`
   CLI/desktop login exists. A reused login needs zero clicks.
2. **Provide one Bearer token** minted in the dashboard's **"Connect your agent"**
   card. No setup route returns this token by design. **Do not have the person
   paste it into this conversation** — the uploader shares this session's prompts
   with teammates, so a pasted secret would become teammate-readable. Instead the
   person puts it into the **environment that launches their agent** (or an OS
   keychain / a mode-0600 file) via a shell *they* run, and this agent references
   it only by variable name — never by value. See **Token handling** below.
3. **Same workspace, both sides.** The teammate (or workspace admin) must have
   invited this person's email to the **shared** workspace — two agents can only
   reach each other inside one workspace. Confirm the workspace id matches on
   both machines; do not guess it.

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

With skills.sh instead, use the command under **Requires**; it installs into each agent's skills folder directly, so the manual Codex mirror below is only for the prpm route.

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

The token must never land in the agent conversation, in a Relay message, in
process argv, or in the repo. Three places leak it, and this skill avoids all
three:

- **The chat** — this session is uploaded and teammate-readable, so a token
  pasted to the agent leaks to the workspace. The person sets it themselves (see
  below); the agent only ever sees the variable **name**.
- **Process argv** — a token interpolated into `claude mcp add --header
  "... Bearer $TOKEN"` is visible to `ps` and gets written literally into
  `~/.claude.json`. Pass the unexpanded placeholder `${AGENT_RELAY_SESSIONS_TOKEN}`
  instead; Claude Code expands `${VAR}` in MCP headers from the environment at
  launch, so the stored config holds only a reference and argv holds only the
  literal `${…}`. **This expansion exists only in Claude Code ≥ 2.1.119** — an
  older client sends the placeholder literally and auth fails, so check the
  version first (section 3) and update Claude rather than inlining the token.
- **The launching environment** — both CLIs read the token from an environment
  variable (`${VAR}` for Claude, `--bearer-token-env-var` for Codex), so the
  variable must exist in the environment that **launches the agent**, not in a
  transient shell-tool subprocess (which cannot alter its parent or a later
  process).

Use the single variable name `AGENT_RELAY_SESSIONS_TOKEN` throughout. Keep the
one-time entry separate from durable supply:

- **One-time, into the current shell** (non-echoing, run by the person, never
  the agent): `read -rs AGENT_RELAY_SESSIONS_TOKEN && export AGENT_RELAY_SESSIONS_TOKEN`,
  then launch the agent from *that* shell. Do **not** add this `read` to a shell
  profile — every shell that sources the profile would block waiting for input.
- **Durable across restarts:** store the token in the OS keychain or a mode-0600
  file, and have the launcher export it **non-interactively**, e.g.
  `export AGENT_RELAY_SESSIONS_TOKEN="$(security find-generic-password -s agent-relay-sessions -w)"`
  (macOS keychain) or from a 0600 file. Put that line in a dedicated launcher the
  person starts the agent from — not an interactive prompt in the profile.

The agent never prints the value; verify presence only with
`test -n "${AGENT_RELAY_SESSIONS_TOKEN:-}"`.

## 0. Preflight: collect the human inputs first

Before section 1, tell the person what they need and ask for it in one message:

1. the **shared workspace id** (or the teammate/admin who invited them);
2. a **Bearer token** minted in the dashboard's "Connect your agent" card for
   that workspace, stored by *them* as `AGENT_RELAY_SESSIONS_TOKEN` in the
   environment that launches their agent (see **Token handling** — never pasted
   into this chat);
3. the **teammate's relay address** for the round trip, if one will be online.

Check presence without printing the value:

```sh
test -n "${AGENT_RELAY_SESSIONS_TOKEN:-}" && echo token=present || echo token=missing
```

A missing token does **not** block sections 1–3: the MCP config stores only a
`${AGENT_RELAY_SESSIONS_TOKEN}` reference, never the value, so it can be added
now. Do the desktop work and add the MCP, then have the person restart the agent
**once**, from an environment that exports the token, so that single restart both
loads the MCP and supplies the credential. Sections 4–5 are gated on that
restart. If the person would rather not defer, they can export the token and
restart first, which then costs a second restart only if the MCP was added after.

## 1. Confirm the host and this session

Run every command from this agent's own shell tool, and only from a **genuine
interactive** Claude Code or Codex session. The app identifies the caller from
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
  relay_socket="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/agent-relay/relay.sock"
fi
relay_probe=
for c in "$HOME/.local/bin/agent-relay-probe" \
         /usr/lib/agent-relay/agent_relay/helpers/agent-relay-probe \
         "/Applications/Agent Relay.app/Contents/Helpers/agent-relay-probe"; do
  if test -x "$c"; then relay_probe=$c; break; fi
done
# relay_req METHOD PATH [JSON-BODY]
relay_req() {
  if test "$(uname -s)" = Darwin && test -n "$relay_probe"; then
    printf '%s' "${3:-}" | "$relay_probe" relay socket-request \
      --socket "$relay_socket" --method "$1" --path "$2"
  elif test "$(uname -s)" = Darwin && test -n "${CODEX_THREAD_ID:-}"; then
    echo 'A Codex session on macOS needs agent-relay-probe; start Agent Relay and retry.' >&2
    return 1
  elif test -n "${3:-}"; then
    curl -sS --unix-socket "$relay_socket" -X "$1" \
      -H 'Content-Type: application/json' -d "$3" "http://relay$2"
  else
    curl -sS --unix-socket "$relay_socket" -X "$1" "http://relay$2"
  fi
}
```

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
top-level default — require both:

```sh
relay_req GET /setup/status | jq -e '
  .ok
  and .data.sign_in == "signed_in"
  and (.data.workspace.id | type == "string" and length > 0)
  and .data.uploader.healthy == true
  and .data.direct_delivery == true
  and (.data.session.id | type == "string" and length > 0)
  and .data.session.registered == true
  and .data.session.direct_delivery == true'
```

Confirm `workspace.id` is the **shared** workspace both sides agreed on. A
healthy uploader is the one non-obvious prerequisite: for a teammate's agent to
read **this** person's session, this machine must have uploaded it. If
`uploader.healthy` is false (paused, or a failed cycle), fix it before promising
anyone can read this session — this is the single most common reason a live
handoff silently fails.

## 3. Install the agent-sessions cloud MCP (before the session uses it)

Check whether the token is present in the environment **without printing it**
(see **Token handling**). It is not required to *add* the MCP, since only a
reference is stored, but it is required for the tools to authenticate after the
restart. If it is missing, add the MCP anyway, tell the person plainly that the
tools will fail auth until they restart the agent from an environment that
exports `AGENT_RELAY_SESSIONS_TOKEN`, and do not report setup complete:

```sh
if ! test -n "${AGENT_RELAY_SESSIONS_TOKEN:-}"; then
  echo 'AGENT_RELAY_SESSIONS_TOKEN is not set here; the MCP will be added by reference, but the agent must be restarted from an environment that exports it.' >&2
fi
```

Detect which agent CLI this session runs and install accordingly.

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
  https://agentrelay.com/cloud/api/v1/mcp/shared-sessions \
  --header 'Authorization: Bearer ${AGENT_RELAY_SESSIONS_TOKEN}'
claude mcp list | grep -F agent-relay-sessions
```

Codex — `codex mcp add` records the **variable name**, not the value, and writes
to user-level `~/.codex/config.toml`, so the server is enabled for **all** Codex
projects (Codex has no project-scoped MCP). Confirm the person is OK with
user-wide access before adding it:

```sh
codex mcp add agent-relay-sessions \
  --url https://agentrelay.com/cloud/api/v1/mcp/shared-sessions \
  --bearer-token-env-var AGENT_RELAY_SESSIONS_TOKEN
codex mcp list | grep -F agent-relay-sessions
```

Because MCPs load at startup, the running session must be **restarted** to pick
up the server — and because both CLIs read the token from the environment at
launch, the restarted process must **inherit** `AGENT_RELAY_SESSIONS_TOKEN`.
That is why the variable belongs in the shell profile / launcher, not a transient
shell-tool subprocess: an `export` in this agent's shell tool cannot reach the
parent or a freshly launched session. After the restart, re-verify presence with
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

- **`not_a_relay_session` from `/setup/*`:** the caller is not inside a discovered
  interactive session. Run it from this agent's own shell inside an **interactive**
  Claude Code or Codex session — a non-interactive `codex exec` or `claude -p` run
  is not admitted, and neither is an unrelated terminal. In tmux/SSH, confirm the
  agent process and shell share the pane's process tree.
- **No handoff tools in the session:** the MCP was added after the session
  started, or at the wrong scope. Reinstall at project scope (section 3) and
  **restart** the session; MCPs load only at startup.
- **`list_relay_agents` auth error:** the token is wrong, expired, or from a
  different workspace. Because the MCP config stores only a **reference** to
  `AGENT_RELAY_SESSIONS_TOKEN`, fixing it means updating the **value in the
  launch environment** (keychain / 0600 file) and **restarting** the agent so it
  re-reads it — re-running `claude mcp add` / `codex mcp add` alone changes
  nothing. Re-mint from the intended workspace's "Connect your agent" card if the
  token itself is bad. On Claude, also confirm the client is ≥ 2.1.119 (older
  clients send the `${VAR}` placeholder literally).
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
