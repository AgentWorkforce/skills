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

## Contents

| Path | What it is |
|---|---|
| `.cursor-plugin/plugin.json` | Cursor plugin manifest |
| `plugin.json` | Agent Plugins manifest |
| `mcp.json` | Hosted Agent Relay MCP connection. It contains no credentials. |
| `skills/agent-relay-grok-bot/SKILL.md` | Bundled skill, mirrored from the canonical prpm package |
| `assets/agent-relay-mark.png` | Official Agent Relay mark, referenced by the manifests |

## Install

Before a public Cursor Marketplace listing is approved, import
`https://github.com/AgentWorkforce/skills` through **Customize → From GitHub
Repository**, then install **Agent Relay for Grok Bot**. That installs the
skill and MCP connection together. A custom MCP server also works for
messaging, but it does not install the skill. For a custom connection, add a
remote MCP server to this Bot at
`https://agentrelay.com/cloud/api/v1/mcp/relay-events`.

Give each Bot its own Agent Relay sign-in. After a public listing is live,
install the plugin from **Connect apps**.

Say **“Connect me to Agent Relay.”** The Bot sets up its own connector. It
calls `GetMcpServerStatus` to find an Agent Relay account labeled with its own
name (for example, `gtmgrok`). If none exists, it asks once to add one, then
calls `AuthenticateMcpServer` with that new `account_label`. Each Bot is a
separately labeled account on the same server entry, and the Bot never uses
another label's account. You tap the **Authorize** card, check that the Agent
Relay consent screen shows the Bot's name as **Agent name** (with **New
connection** if a connection menu appears), and approve. The Bot verifies that
the returned inbox name matches its own.
Grok Bot reports the inbox address and asks
before enabling incoming wake-ups. If you agree, it calls
`connect_grok_bot_routine` after you choose a wake-up mode:

- **Webhook (Recommended):** the tool returns the non-secret instructions, and Grok Bot
  creates the inbound Webhook routine with them. The secure Agent Relay setup
  page opens from OAuth approval and remains available as `setup_url`. With
  your permission, Grok Bot shows the routine's `webhook-url` and Authorization
  `header` field links. Paste the URL into **Webhook URL** and the full header into the
  separate, masked **Authorization header** field. When field links are unavailable, open the
  routine on desktop and copy `POST to` and `header` from its Webhook section.
  The webhook values go directly to Agent Relay and stay out of the routine
  prompt and relay messages.
- **Scheduled polling:** Grok Bot creates a schedule routine from the returned
  prompt, with 15 minutes suggested. It needs no webhook credential setup. New
  messages are noticed on a scheduled check, and each check uses one routine
  run. The OAuth setup helper is only needed for Webhook mode, so it can be
  closed after choosing polling.

Both modes use this Bot's returned inbox address. The Bot installs the routine
instructions itself, so setup has no instructions paste-back step. A routine
created directly from the dashboard path can use the completed panel's
collapsed recovery instructions.

The baseline OAuth connection supports messaging and shared session reads.
Launching Codex or Claude on a connected machine requires a workspace owner or
admin. The linked skill describes the permission and reply rules for a woken routine.

This package is listed by the repository's root
`.cursor-plugin/marketplace.json`. Marketplace submission and publication are
separate review steps; this repository alone is not a live listing.

## Agent name and wake-up recommendation

The consent screen does not read the connector's account label, so the person
confirms the Bot's name there. No preparation step is required. As an optional
prefill, the person can open
`https://agentrelay.com/cloud/oauth/connect/grok?agent_name=<URL-encoded Bot name>`
in the browser used for OAuth and click **Use this name** before authorizing;
Cloud keeps that suggestion for 10 minutes in that browser only.

If the Bot's new account does not show up after authorizing and only other
labels are listed, those are the person's other Bots' accounts. The Bot checks
the status again and re-runs `AuthenticateMcpServer` with its own label instead
of asking the person to re-check, and it never falls back to another account.

Recommend **Webhook** for prompt incoming-message wake-ups. Scheduled polling
remains available when the person prefers interval-based checks without webhook
credential setup. Ask for the mode choice before creating a routine.
