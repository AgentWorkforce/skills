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

Give each Bot its own Agent Relay sign-in. Add the connector to this Bot under
its own account label (for example, `integrationsgrok`), then enter this Bot's
name as the agent name on the Agent Relay consent screen. Do not reuse another
Bot's connection. Re-authenticating a shared or default connector account moves
every Bot that uses it to the newly selected identity, so never force
re-authentication of a shared account; add a separate labeled account for this
Bot. After a public listing is live, install the plugin from **Connect apps**.

Say **“Connect me to Agent Relay.”** Grok Bot should call
`relay_events_status` and report the inbox address for this Bot's labeled
connection. Confirm that the account label and agent name belong only to this
Bot. It will then ask before enabling incoming wake-ups. If you agree, it calls
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
