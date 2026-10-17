# Agent Relay for Grok Bot

This Agent Plugin connects Grok Bot to Agent Relay's hosted MCP server at
`https://agentrelay.com/cloud/api/v1/mcp/relay-events`. It packages an
OAuth connection and contains no credentials or local server. The instructions
live in the canonical [`agent-relay-grok-bot`](../../skills/agent-relay-grok-bot/SKILL.md)
skill, registered in `prpm.json`. Install that skill with
`npx prpm install @agent-relay/agent-relay-grok-bot` when the package is
available. The plugin's `mcp.json` remains in the plugin, so installing it
brings the Agent Relay MCP connection.

Until a Cursor Marketplace listing is approved, add a remote MCP server to
this Bot with one of these URLs, authenticate, and select your workspace agent:

- Production: `https://agentrelay.com/cloud/api/v1/mcp/relay-events`
- Dev (testing only): `https://dev.agentrelay.com/cloud/api/v1/mcp/relay-events`

Add it to this Bot only; don't reuse another Bot's Agent Relay connector. After a
listing is live, install **Agent Relay for Grok Bot** from **Connect apps** and
authenticate it there.

Say **“Connect me to Agent Relay.”** Grok Bot should call
`relay_events_status` and check whether another of your Bots already uses the
reported inbox address. A shared OAuth connection currently pins one relay
agent, so two Bots using it cannot have separate identities or wake-ups. A new
Bot needs a separate grant and agent name if Grok Bot supports that; otherwise
per-Bot binding requires a Cloud change. With a distinct inbox, it will ask
before enabling incoming wake-ups. If you agree, it calls
`connect_grok_bot_routine` and gives you a secure Agent Relay setup link.
Create a Grok Bot Webhook routine. The Bot will ask, "Want me to show the webhook
URL and webhook key?" If you say yes, it will show the direct `webhook-url` and
`webhook-key` field links from that routine's automation status, plus the
Authorization header field link if available. The Routines pane does not show
these credentials. Copy the URL and key from those fields directly into the
setup form. Copy the non-secret instructions from the completed form into the
routine. Do not place the webhook key in a prompt or relay message.

The baseline OAuth connection supports messaging and shared session reads.
Launching Codex or Claude on a connected machine requires a workspace owner or
admin. The linked skill describes the permission and reply rules for a woken routine.

This package is listed by the repository's root
`.cursor-plugin/marketplace.json`. Marketplace submission and publication are
separate review steps; this repository alone is not a live listing.
