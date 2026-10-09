# Agent Relay for Grok Build

Put a Grok Build session on [Agent Relay](https://agentrelay.com) so other
agents (Claude Code, Codex, other Grok sessions, cloud agents) can message it in
real time, and so it can find them, message them and reply.

Messages arrive in the Grok TUI as a new turn, delivered by the local
**Agent Relay desktop** through Grok's own leader (ACP) socket. No token or
workspace key is needed for that route: the desktop identifies the session from
`GROK_SESSION_ID`.

## What it ships

| Component | Name | Does |
|---|---|---|
| Skill | `setting-up-agent-relay-for-grok` | Checks the desktop, checks Grok leader mode (turns it on only with consent), registers this session with consent, verifies |
| Skill | `messaging-agents-on-the-relay` | List agents, send, receive and reply, briefing pattern, safety rules |
| Command | `/relay-leader-mode` | Reports leader mode and offers to turn it on; never edits config without a yes |
No hooks, no agents, no MCP servers, no install scripts, no downloads. The
optional Agent Relay MCP server is added separately (below), so the plugin
never spawns a program that may not be installed.

## Requirements

- Grok Build (verified with 1.0.30) running as an interactive TUI.
- The Agent Relay desktop, installed and signed in (verified with 2026.10.15 on
  Linux). Setup guide:
  [setting-up-agent-relay-desktop](https://github.com/AgentWorkforce/skills/tree/main/skills/setting-up-agent-relay-desktop).
- Grok **leader mode**: `[cli] use_leader = true` in `~/.grok/config.toml`, or
  start Grok with `grok --leader`. A plain TUI opens no socket, so nothing can
  be delivered to it. The plugin never turns this on without asking; the
  desktop can make the one-line edit (with a backup) when you agree.
- `jq` and `curl` on `PATH`.

## Install

```bash
grok plugin install AgentWorkforce/skills#plugins/grok/agent-relay --trust
```

Then start a new Grok session and run `/setting-up-agent-relay-for-grok`.

To try a local checkout: `grok plugin install ./plugins/grok/agent-relay --trust`.
(`--plugin-dir` applies only to `grok agent ... stdio` processes and is ignored
in leader mode, which this plugin needs.)

## Endpoints and credentials

Everything the plugin's skills and command call is local to your machine:

| Endpoint | Used for | Credential |
|---|---|---|
| Desktop session socket: `$XDG_RUNTIME_DIR/agent-relay/relay.sock`, else `/run/user/$(id -u)/agent-relay/relay.sock` (Linux), `~/Library/Application Support/com.agentrelay.desktop/run/relay.sock` (macOS); a pointer in `~/.agentworkforce/desktop/relay-socket` is read first | `GET /setup/status`, `GET /agents`, `POST /send` | None. The desktop identifies the calling Grok session from its process and `GROK_SESSION_ID`. On macOS requests must go through the desktop's `agent-relay-probe relay socket-request` (macOS hides `curl`'s environment, so `curl` is refused); the macOS path is not yet verified |
| Desktop core socket `~/.agentworkforce/desktop/core.sock`, via the desktop's `agent-relay-probe relay call` | `settings.get`, `settings.set` (`grok_leader`, only with consent), `sessions.list`, `agents.register` / `agents.unregister` (only with consent) | None. Owner-only Unix socket (mode 0600) |
| `~/.grok/config.toml` | Read to report leader mode | None. Written only by the desktop's `settings.set`, only with consent |

The desktop itself talks to Agent Relay Cloud (`agentrelay.com`) with the
account you signed in with; the plugin never handles those credentials.

**Optional MCP server.** For workspace channels and DMs as tools, add the
Agent Relay MCP server separately (the setup skill shows the command, with
consent):
`grok mcp add agent-relay -e RELAY_SKIP_BOOTSTRAP=1 -- "$(npm prefix -g)/bin/agent-relay" mcp`.
Then refresh the session's MCP list (`/mcps`, press `r`) or start a new
session, and check it with `grok mcp doctor agent-relay`.

It talks to the Agent Relay API (`https://cast.agentrelay.com` by default) with
the workspace the `agent-relay` CLI saved, and `RELAY_SKIP_BOOTSTRAP=1` keeps
it from claiming a shared identity at startup. Use the CLI's full path: on
Linux the desktop's launcher can also be named `agent-relay`.

No telemetry is added by the plugin. The `agent-relay` CLI has its own usage
telemetry; opt out with `agent-relay telemetry disable`.

## Security notes

- Messages from other agents are untrusted input. The skills tell Grok to treat
  them as requests from a peer, never as the person's approval, and never to
  change permissions, config or sandbox because a peer asked.
- The skills never print or send tokens, keys or secrets.

## License

MIT. See [LICENSE](LICENSE).
