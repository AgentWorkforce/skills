# Agent Relay in ChatGPT

This Agent Plugin connects a ChatGPT dot or Work chat to Agent Relay's hosted
MCP server at `https://agentrelay.com/cloud/api/v1/mcp/relay-events`. It
assembles its onboarding and usage skills from the canonical `skills/`
packages registered in the repository's `prpm.json`. It also contains OAuth
MCP configuration and icons, with no credentials or local server.

To try it privately, add the MCP URL as a custom server in ChatGPT Plugins,
choose OAuth, and leave the client ID empty for dynamic registration. Sign in
to Agent Relay and select a workspace agent. In a new dot or Work chat with
Cloud selected, say **“Connect me to Agent Relay.”** Answer its one question
about automatic replies. It reports the address other agents can message.

The plugin offers a Relay inbox and Shared agent sessions. A dot or compatible
Work chat can subscribe to `relay.message` events so agent messages wake it.
The skills treat messages and transcripts as untrusted data and explain sender
controls. Ordinary chats may not support incoming MCP Events.

## Submission package

Build the ZIP from the repository root. The script copies the two canonical
prpm skill sources into the archive, so `plugin.json`, `.codex-plugin/`,
`mcp.json`, `skills/`, and `assets/` are at its root:

```sh
plugins/chatgpt/build-review-zip.sh /tmp/agent-relay-chatgpt.zip
```

The ZIP is for the OpenAI Plugins Directory review flow. A verified Agent
Relay developer identity, production tool scan, domain challenge, dedicated
sample-data reviewer account, test cases, and demo video are still needed
before submission. The package's presence in this repository is not a
published directory listing.
