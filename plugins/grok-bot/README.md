# Agent Relay for Grok Bot

This Agent Plugin connects Grok Bot to Agent Relay's hosted MCP server at
`https://agentrelay.com/cloud/api/v1/mcp/relay-events`. It packages an
OAuth connection and contains no credentials or local server. Installing the
plugin provides both the MCP connection and the `agent-relay-grok-bot` skill
to the Bot. The skill is mirrored from the canonical
[`agent-relay-grok-bot`](../../skills/agent-relay-grok-bot/SKILL.md) prpm
package. After editing the canonical skill, run
`bash plugins/grok-bot/sync-skill.sh` from the repository root to update the
bundled copy, then `bash plugins/grok-bot/sync-skill.sh --check` to verify it.

Before a public Cursor Marketplace listing is approved, import
`https://github.com/AgentWorkforce/skills` through **Customize → From GitHub
Repository**, then install **Agent Relay for Grok Bot**. That installs the
skill and MCP connection together. A custom MCP server also works for
messaging, but it does not install the skill. For a custom connection, add a
remote MCP server to this Bot at
`https://agentrelay.com/cloud/api/v1/mcp/relay-events`.

Add it to this Bot only; don't reuse another Bot's Agent Relay connector.
After a public listing is live, install the plugin from **Connect apps**.
Authenticate and select your workspace agent.

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
Authorization header field link if available. If those links are unavailable,
open the routine on desktop and copy `POST to` and `key` from its Webhook
section. Paste the URL and key directly into the Agent Relay setup form. Copy
the non-secret instructions from the completed form into the routine. Do not
place the webhook key in a prompt or relay message.

The baseline OAuth connection supports messaging and shared session reads.
Launching Codex or Claude on a connected machine requires a workspace owner or
admin. The linked skill describes the permission and reply rules for a woken routine.

This package is listed by the repository's root
`.cursor-plugin/marketplace.json`. Marketplace submission and publication are
separate review steps; this repository alone is not a live listing.
