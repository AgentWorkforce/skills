---
name: agentworkforce-repo-map
description: Route an AgentWorkforce change to its owning GitHub repository when the request spans products or repository ownership is unclear. Use current repo evidence before filing an issue or PR.
---

# AgentWorkforce Repo Map

Use this map to find candidate owners, then verify the relevant README, paths, and recent changes in the live repositories. It is a routing aid, not an exhaustive organization inventory or a reason to move work out of a repository the person already chose.

## Verify a candidate

```sh
gh repo view AgentWorkforce/<repo> --json description,url,defaultBranchRef
gh api repos/AgentWorkforce/<repo>/contents --jq '[.[] | {name,type}]'
```

Read the candidate's README or the code path named in the issue. If the repo is not in this map, use `gh repo list AgentWorkforce --limit 200 --json name,description` to find a candidate. A local checkout can help, but may be behind the default branch. Use issue links, package names, stack traces, and current file ownership to settle an ambiguous route.

## Candidate owners

| Surface | Start with | Boundary to check |
| --- | --- | --- |
| Native desktop app, local session registration, bundled probe, uploads UI | `relay-desktop` | Cloud sign-in or server-side upload handling belongs elsewhere. `pear` is a separate pair-programming product. |
| Hosted Cloud API, OAuth, MCP, integration connections, Cloud app | `cloud` | A provider's file mapping may live in `relayfile-adapters`; a native UI change may live in `relay-desktop`. |
| Agent Relay CLI, SDK, local node and broker orchestration, protocol-facing integration | `relay` | Realtime messaging engine and hosted gateway have their own repos below. |
| Channels, DMs, threads, messaging SDK and store | `relaycast` | Hosted gateway deployment, Durable Objects, and persistence are in `relaycast-cloud`. |
| Hosted Relaycast gateway and fleet messaging infrastructure | `relaycast-cloud` | Client and core messaging contracts may be in `relaycast` or `relay`. |
| Local coding-session capture, indexing, search, resume, and history MCP | `relayhistory` | Hosted Sessions ingestion, recall, and storage are in `relayhistory-cloud`. |
| Hosted Sessions ingestion, transcripts, recall, and derived memory | `relayhistory-cloud` | Native capture and upload controls are in `relay-desktop`. |
| Relayfile VFS, mount, event delivery, writeback queue, and sync engine | `relayfile` | Provider-specific paths, webhook normalization, and writeback rules are in `relayfile-adapters`. |
| GitHub, Linear, Slack, Notion, or other provider adapters | `relayfile-adapters` | Connection setup or hosted UI may be in `cloud`. |
| Scoped VFS tokens and path permissions | `relayauth` | File operations and adapter behavior are in `relayfile` and `relayfile-adapters`. |
| Current Relayflows surface, executor, `flows` CLI, and flow examples | `flows` | Hosted deployment and trigger UI may also touch `cloud`. `relayflows` contains an older workflow engine; use it for work on that codebase only. |
| Deployable persona schema, runtime, and `agentworkforce` CLI | `workforce` | Individual agent implementations and examples are in `agents`. |
| Individual proactive agent definitions and handlers | `agents` | Shared runtime or persona tooling is in `workforce`. |
| Skills, commands, plugins, and `prpm.json` package metadata | `skills` | A product bug described by a skill still belongs in the product repo. |
| Public marketing site and documentation pages | `agentrelay.com` | Cloud application behavior belongs in `cloud`. |
| `arelay.to` onboarding agent and its knowledge bundle | `relay-agent` | Source skills and docs may be maintained in `skills` or `agentrelay.com`. |
| Pear pair-programming experience | `pear` | Agent Relay Desktop issues belong in `relay-desktop`. |

## Split work by the failing boundary

- **Desktop message or session problem:** check `relay-desktop` for app/probe behavior, `relay` for relay integration, `relaycast-cloud` for hosted delivery, and `relayhistory-cloud` for hosted session ingestion. Route the change to the layer that fails.
- **Integration problem:** check `cloud` for OAuth and connection management, `relayfile-adapters` for provider mapping or writeback, and `relayfile` for VFS or delivery mechanics.
- **Flow problem:** check `flows` for the current flow definition and runtime, and `cloud` for hosted deployment or trigger wiring. Check `relayflows` only when the affected package is from that older repo.
- **Agent problem:** check `agents` for one agent's behavior, `workforce` for shared persona/runtime behavior, and `skills` for instructions the agent consumes.

A change can legitimately span repositories. Identify the owning file or API in each repo before opening issues or PRs, and link related work rather than assuming one repo owns the whole feature.
