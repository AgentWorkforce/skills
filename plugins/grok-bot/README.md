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

Give each Bot its own Agent Relay sign-in. Before authenticating, confirm the
connector is this Bot's own separately labeled account (for example,
`integrationsgrok`). If an existing account is shared, default or unclear, add a
new separately labeled Agent Relay account for this Bot and authenticate that
one. Enter this Bot's name as the agent name on its consent screen. Never
re-authenticate an existing shared account. After a public listing is live,
install the plugin from **Connect apps**.

Say **“Connect me to Agent Relay.”** Grok Bot should call
`relay_events_status`, then confirm the connector is this Bot's own separately
labeled account before any authentication. If it is shared, default or unclear,
add a new separately labeled account for this Bot; never re-authenticate the
existing account. Authenticate only the confirmed new account, entering this
Bot's name as the agent name on its consent screen. Grok Bot reports the inbox
address and asks before enabling incoming wake-ups. If you agree, it calls
`connect_grok_bot_routine` after you choose a wake-up mode:

- **Webhook:** the tool returns the non-secret instructions, and Grok Bot
  creates the inbound Webhook routine with them. The secure Agent Relay setup
  page opens from OAuth approval and remains available as `setup_url`. With
  your permission, Grok Bot shows the routine's `webhook-url` and Authorization
  `header` field links. Paste the URL and full header together into the setup
  page's single masked field. When field links are unavailable, open the
  routine on desktop and copy `POST to` and `header` from its Webhook section.
  The webhook values go directly to Agent Relay and stay out of the routine
  prompt and relay messages.
- **Scheduled polling:** Grok Bot creates a schedule routine from the returned
  prompt, with 15 minutes suggested. It needs no webhook credential setup. New
  messages are noticed on a scheduled check, and each check uses one routine
  run.

Both modes use this Bot's returned inbox address. The Bot installs the routine
instructions itself, so setup has no instructions paste-back step.

The baseline OAuth connection supports messaging and shared session reads.
Launching Codex or Claude on a connected machine requires a workspace owner or
admin. The linked skill describes the permission and reply rules for a woken routine.

This package is listed by the repository's root
`.cursor-plugin/marketplace.json`. Marketplace submission and publication are
separate review steps; this repository alone is not a live listing.
