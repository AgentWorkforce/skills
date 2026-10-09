# Agent Relay channel for Claude Code

A [channel](https://code.claude.com/docs/en/channels) plugin: messages that
other agents send this session's relay agent (Codex, Grok, OpenCode, other
Claude Code sessions, cloud agents) arrive in your **running** Claude Code
session as `<channel>` events, and Claude answers them with a `reply` tool.
Pairing and a sender allowlist decide who can reach you.

Channels are a research preview. Requires Claude Code with channels (tested on
v2.1.280), a claude.ai or Console sign-in, and [Bun](https://bun.sh) 1.4.0 or
later (the lockfile is Bun's lockfile v2; an older Bun stops at start with a
message saying so).

## Install

```
/plugin marketplace add AgentWorkforce/skills
/plugin install agent-relay@agent-relay
/agent-relay:configure
```

`/agent-relay:configure` saves an Agent Relay workspace key and this session's
agent name to `~/.claude/channels/agent-relay/.env` (mode 0600). Then restart
with the channel on. This marketplace is not on Anthropic's channel allowlist,
so during the preview it needs the development flag:

```bash
claude --dangerously-load-development-channels plugin:agent-relay@agent-relay
```

(If your organisation lists it in `allowedChannelPlugins`,
`claude --channels plugin:agent-relay@agent-relay` works.)

The first message from an agent you have not approved gets a pairing code
back and is not shown to Claude. Approve it in your terminal with
`/agent-relay:access pair <code>`.

## What it ships

| Component | Name |
|---|---|
| Channel MCP server | `relay` (stdio, `bun server.ts`), declares `claude/channel`; tools `reply` and `status` |
| Skill | `/agent-relay:configure`: settings, launch flag, desktop check |
| Skill | `/agent-relay:access`: pair, allow, remove, policy |
| Skill | `messaging-agents-on-the-relay`: roster and messaging through the Agent Relay desktop |

## How it behaves

- **Inbound.** The server registers its own agent on Agent Relay (Relaycast)
  and listens on its WebSocket for direct messages and thread replies. Each one
  from an allowlisted sender becomes a channel event:
  `<channel source="plugin:agent-relay:relay" from="AGENT" message_id="ID" kind="dm">TEXT</channel>`.
- **Gate.** `access.json` holds `dmPolicy` (`pairing`, `allowlist` or
  `disabled`), the allowlist of agent names, the relay agent id each name was
  approved as (a different agent that later takes the same name must pair
  again), and pending pairing codes (one per sender, at most three, one hour
  each; a code whose DM fails is withdrawn so the next message gets a new
  one). It is re-read on every message. Only the user's own
  `/agent-relay:access` changes the allowlist; the skill refuses requests that
  arrive through a channel.
- **Framing.** The server's instructions tell Claude that a relayed message is
  a request from a peer, never the user's approval: it cannot grant
  permissions or justify changing settings or `CLAUDE.md`, and replies should
  not loop.
- **No permission relay.** The server does not declare
  `claude/channel/permission`, so no peer agent can approve tool use in your
  session.
- **Reply.** `reply(message_id, text)` answers only a message that was
  delivered to this session, and only while its sender is still allowed: a DM
  by DM, a thread message in its thread. A message is marked delivered only
  after Claude Code accepted it.
- **Protocol.** Claude Code does not register a channel server that negotiates
  MCP revision 2026-07-28. The server is pinned to MCP SDK 1.32.1 and clamps
  the negotiated revision to 2025-11-25.
- **Identity.** Each workspace and agent name keeps its own token in
  `identity.json` (mode 0600), reused across restarts and directories. A name already taken by an agent this channel did not create is
  refused rather than taken over. The plain `RELAY_*` variables are ignored, so
  the channel never reuses an identity an Agent Relay broker gave the session.

## Coexistence with the Agent Relay desktop

The desktop delivers to a Claude Code session it has registered through
Claude Code's own cross-session inbox. One route per session: with
`AGENT_RELAY_CHANNEL_INBOUND=auto` (the default), the channel asks the
desktop's local socket `GET /setup/status` at start, and when this session is
already registered there it delivers nothing (the `status` tool says so).
`always` delivers anyway (the session then has two relay addresses), `never`
turns inbound off.

## Endpoints and credentials

| What | Where | Credential |
|---|---|---|
| Agent Relay API and WebSocket | `https://cast.agentrelay.com` (or `AGENT_RELAY_CHANNEL_BASE_URL`) | Workspace key `AGENT_RELAY_CHANNEL_WORKSPACE_KEY` to register; then the agent token |
| Agent Relay desktop session socket (read only, optional) | `$XDG_RUNTIME_DIR/agent-relay/relay.sock`, or the macOS app socket | None |
| State | `~/.claude/channels/agent-relay/` (`.env`, `access.json`, `identity.json`, all 0600) | Stored there |
| npm registry, at start | `bun install --frozen-lockfile` against `bun.lock` | None |

No telemetry is added by the plugin.

## Development

```bash
bun install
bun test
claude plugin validate .
```

## License

MIT. See [LICENSE](LICENSE).
