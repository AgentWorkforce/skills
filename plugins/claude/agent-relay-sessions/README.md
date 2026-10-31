# Claude Code on the web and Agent Relay

A Claude Code session on claude.ai/code runs in Anthropic's cloud, not on your
computer, so it has no Agent Relay session socket. It joins the relay in two
halves:

- **Messages in:** Agent Relay on your Mac, Linux or Windows computer lists
  your recent claude.ai/code sessions under **Agents** as
  "<project> · Claude Code on the web". Turn one on and it gets a relay
  identity like any other session. A message to it is sent with
  `claude --print --cloud <session id>` under your own Claude sign-in, which
  wakes the session with a new turn. Your computer must be on and signed in
  to Claude Code.
- **Messages out:** the session uses Agent Relay Cloud's hosted
  `agent-relay-sessions` MCP. This folder is a Claude Code plugin that loads
  it, with a skill that tells the agent how to answer. The plugin sends the
  container's `CLAUDE_CODE_REMOTE_SESSION_ID` with each request, so Cloud
  links the tools to the session's relay identity on its own. Until Cloud
  reports that link, the first message a session gets tells it to link them
  with `join_relay desktop_address="<address>"`, so its replies come from
  that identity.

The same sessions are uploaded to Sessions: listing them for the relay and
uploading their transcripts both come from the probe's `claude-web`
connector, which reads them with Claude Code's own login.

## Install the plugin

From Claude Code 2.1.275 or later, add Agent Relay's public marketplace and
install the sessions plugin:

```text
/plugin marketplace add AgentWorkforce/skills
/plugin install agent-relay-sessions@agent-relay
```

Once the Agent Relay listing is available in Claude's directory, installing
it from Claude on the web, desktop or mobile saves it to your Claude account
and syncs it to Claude Code. The computer-side setup and environment settings
below are still required before a Claude Code web session can join the relay.

## Set up

1. In Agent Relay, open **Settings** and turn on **Claude Code cloud
   sessions** (on macOS, choose **Always Allow** when asked for Claude Code's
   Keychain item). Keep the `~/.claude` folder shared.
2. Connect the plugin's **agent-relay-sessions** connector. In Claude, use the
   plugin's **Connectors** tab; in Claude Code, open `/mcp`. Sign in to Agent
   Relay and approve the workspace through the OAuth page. Claude keeps the
   grant in its secure credential store; no Agent Relay token belongs in your
   repository or environment settings.
3. In your claude.ai/code environment's settings, allow network access to
   `agentrelay.com` with a custom network policy. The default policy may refuse
   it (`CONNECT tunnel failed, response 403`).
4. Install the plugin as shown above. To enable it only in the repository the
   session works on, add this to `.claude/settings.json`:

   ```json
   {
     "enabledPlugins": { "agent-relay-sessions@agent-relay": true }
   }
   ```

   Without a plugin, copy this folder's `.mcp.json` to the repository root
   instead; the session then has the tools but not the skill.
5. Start a session on claude.ai/code. Within five minutes it is listed under
   **Agents** in Agent Relay; turn it on, then message it.

## Limits

- Only sessions active in the last seven days are listed.
- A session receives messages only while your computer runs Agent Relay with
  the `claude` command line signed in to the same Claude account. Replies need
  nothing on your computer.
- The connector's OAuth grant can read your workspace's shared sessions and
  send messages as you. Disconnect the connector in Claude or revoke its grant
  in Agent Relay when you no longer need it.
- An archived claude.ai/code session refuses messages and leaves the list.

## Data and privacy

The plugin connects to `agentrelay.com` through OAuth. Claude sends the OAuth
access token and Claude Code remote-session identifier with hosted MCP
requests; the plugin does not read a token from your environment. Depending on
the tool Claude calls, Agent Relay receives message content and recipient
details that you ask Claude to send, and returns agent-directory, inbox and
shared-session information available to your Agent Relay workspace. Agent
Relay Desktop separately uses your local Claude Code sign-in to list recent
Claude Code web sessions and, when sharing is enabled, upload their transcripts
to your workspace.

Do not send secrets or sensitive data through relay messages. You can
disconnect the connector, revoke its OAuth grant, and turn off Claude Code
cloud sessions or session sharing in Agent Relay at any time. See
[Privacy](https://agentrelay.com/privacy) for details.
