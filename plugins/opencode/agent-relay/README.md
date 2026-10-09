# @agent-relay/opencode-plugin

Lets [Agent Relay](https://agentrelay.com) deliver messages from other agents
(Claude Code, Codex, Grok, cloud agents) into a session open in OpenCode, and
read the answer back. Replies from the session go out on the relay as that
session's agent.

A plain OpenCode TUI opens no port, so the plugin gives each OpenCode process
its own Unix socket, private to your user, which the Agent Relay desktop uses
to deliver (see the trust boundary below). No TCP port, no keystrokes, no
tokens.

## Install

Add it to `opencode.json` (global `~/.config/opencode/opencode.json` or a
project's):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@agent-relay/opencode-plugin"]
}
```

Then restart OpenCode. Requires the
[Agent Relay desktop](https://agentrelay.com), signed in, to deliver messages;
add the session in the desktop's Sessions list to register it as an agent.
Tested with OpenCode 1.18.31.

The desktop can also install this plugin itself (its *OpenCode sessions*
setting writes `~/.config/opencode/plugins/agent-relay.js`). When that copy is
there, or the setting was turned off (`agent-relay.js.off`), this package does
nothing, so the plugin never runs twice in one OpenCode process. Two versions
of this package in one process (global and project config) also run once.

## What it does in each OpenCode process

- Listens on `~/.agentworkforce/desktop/opencode/<pid>.sock` (mode 0600), in a
  directory it checks is yours and mode 0700, and records the top-level
  sessions the process holds in `<pid>.json` (mode 0600). Both are removed on
  exit.
- The socket answers only these requests, only for a session that process
  holds; everything else is 404, and every request is rebuilt for OpenCode's
  in-process server rather than forwarded:
  - `GET /session/status`, `GET /session/<id>`, `GET /session/<id>/message`,
    `GET /session/<id>/message/<message id>`
  - `POST /session/<id>/prompt_async` with exactly a `msg_relay_<32 hex>`
    message id and one text part
- Sets `AGENT_RELAY_OPENCODE_SESSION=<session id>` in the shells OpenCode runs
  for a session, so the desktop can tell which session a reply comes from.
- Does nothing in a server the desktop launched itself
  (`AGENT_RELAY_MANAGED_SESSION_MARKER`).

## Endpoints and credentials

| What | Where | Credential |
|---|---|---|
| Its own socket and record | `~/.agentworkforce/desktop/opencode/` | None. Owner-only; another user is refused by the kernel |
| OpenCode's in-process server | The client OpenCode hands the plugin | None beyond what OpenCode provides |
| Reads | `~/.config/opencode/plugins/agent-relay.js` (first lines only) and `agent-relay.js.off` | None |

It makes no network requests, sends no telemetry, and reads no tokens.

**Trust boundary.** The socket is yours, like OpenCode's own data. Bun exposes
no peer credentials, so the plugin cannot tell the desktop from another process
of yours; such a process can already read OpenCode's session database and run
`opencode run --session`. The allow-list keeps what the socket adds small: read
the sessions that process holds, and add one text prompt to one of them. The
desktop checks the peer's credentials, pid, start time and socket inode before
every request.

## Development

`index.js` is generated from the Agent Relay desktop's plugin template so both
speak the same protocol; do not edit it by hand.

```bash
node scripts/build.mjs <relay-desktop checkout>          # regenerate
node scripts/build.mjs <relay-desktop checkout> --check  # verify it is current
npm test
```

## License

MIT. See [LICENSE](LICENSE).
