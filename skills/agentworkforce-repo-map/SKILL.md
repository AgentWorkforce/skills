---
name: agentworkforce-repo-map
description: Route an AgentWorkforce change to its owning GitHub repository when the request spans products or repository ownership is unclear. Use current repo evidence before filing an issue or PR.
---

# AgentWorkforce Repo Map

Use this map to find candidate owners, then verify the relevant README, paths, and recent changes in the live repositories. It covers nonarchived public repositories with an owned surface as of October 14, 2026, plus the core product repositories already documented here. It is a routing aid, not a reason to move work out of a repository the person already chose. Private repositories may exist beyond this map; use an authenticated live lookup when the public candidates do not fit.

## Verify a candidate

```sh
gh repo view AgentWorkforce/<repo> --json description,url,defaultBranchRef
gh api repos/AgentWorkforce/<repo>/contents --jq '[.[] | {name,type}]'
```

Read the candidate's README or the code path named in the issue. If the repo is not in this map, use `gh repo list AgentWorkforce --limit 500 --no-archived --json name,description,visibility,pushedAt --jq 'sort_by(.pushedAt) | reverse'` to find a candidate, including private repositories you are authorized to access. A local checkout can help, but may be behind the default branch. Use issue links, package names, stack traces, and current file ownership to settle an ambiguous route.

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

## Other public repositories

These are narrower routing targets. Check the current default branch before opening work because a repository can change ownership or become inactive. A fork may mirror upstream code; confirm the change belongs in the AgentWorkforce fork before filing there.

| Repository | Verified owned surface |
| --- | --- |
| `burn` | Local token and cost accounting for agent CLI sessions. |
| `relay-desktop-releases` | Agent Relay Desktop downloads and release notes; app source is in `relay-desktop`. |
| `helm-charts` | Helm charts for deploying AgentWorkforce services. |
| `rust-oleum` | Rust code-quality ratchet and baseline checks. |
| `relaycron` | Agent scheduling service, webhook delivery, and live-session wakeups. |
| `proactive-agents` | Public guide and site about proactive agents. |
| `trajectories` | Structured, portable records of agent work and decisions. |
| `t3code` | Fork of the T3 Code agent control surface; check upstream ownership. |
| `software-garden` | Agent Workforce Software Garden issue-to-PR automation. |
| `sandbox` | Provider-agnostic sandbox runtime and orchestration library. |
| `ricky` | Workflow reliability agent and workflow runner. |
| `relayfile-providers` | Provider authentication, credential handling, API proxying, and webhook subscriptions for Relayfile. |
| `herdr-relay-bridge` | Herdr session bridge into Agent Relay workspaces. |
| `agent-assistant` | SDK primitives for assistant identity, context, turn execution, policy, and coordination. |
| `proactive` | Packages for proactive agent behavior, events, and memory. |
| `nxt-humans-flows` | NXT Humans Figma-to-email flow integration. |
| `flows-cookbook` | Reusable Relayflows recipes and examples for the current `flows` runtime. |
| `skip-releases` | Skip macOS downloads; application source is maintained separately. |
| `homebrew-ai-hist` | Homebrew packaging for the `ai-hist` CLI. |
| `software-garden-demo` | Garden simulator used to demonstrate Software Garden. |
| `openkaren` | OpenKaren agent implementation. |
| `herdr` | Fork of the Herdr terminal agent multiplexer; check upstream ownership. |
| `relayfile-live-review` | Live code review demonstration using Relayfile sync. |
| `ratify-agent-relay-evidence` | Agent Relay evidence and run records for Ratify Protocol trials. |
| `relayscribe` | Native macOS meeting recorder, transcription, and ticket-to-PR workflow. |
| `c2a` | Chat-to-Agents protocol draft and routing contract. |
| `workflows` | Public Agent Relay repo-hygiene workflows and cookbooks. |
| `agent-tool-spec` | Tool-use evaluation rubric, defect taxonomy, and report format. |
| `collab-bench` | Agent collaboration benchmark configs and matrix-generation scripts. |
| `ai` | Fork of the AI SDK for TypeScript; check upstream ownership. |
| `agent-relay-openclaw` | OpenClaw bridge for Relay channels, threads, and DMs. |
| `vibe-city` | VIBE CITY public funding and observation site. |
| `oh-my-pi` | Fork of the pi terminal coding agent; check upstream ownership. |
| `wash` | Claude Code plugin for reducing tool-output token use. |
| `limit` | Terminal dashboard for coding-agent usage limits. |
| `vibe-city-game` | VIBE CITY open-world game source. |
| `credential-proxy` | JWT-authenticated proxy for LLM provider credentials. |
| `code-storybook` | Read-only narrated codebase storybook specification and runtime. |
| `agent-relay-personas` | Relay-specific Workforce persona definitions. |
| `agent-relay-acp-bridge` | ACP bridge exposing Relay agents to compatible editors. |
| `axiom` | Swift intent-preservation library and Relay bridge. |
| `supportly` | Customer-service escalation multi-agent example. |
| `relayfile-cli` | CLI-execution substrate for Relayfile-adjacent integrations. |
| `relay-poc-tax-assistant` | Multi-agent tax-assistant proof of concept. |
| `relay-dashboard` | Agent Relay fleet monitoring and messaging dashboard. |
| `n8n-nodes-relayfile` | Relayfile community nodes for n8n. |
| `relaycast-n8n-bridge` | Relaycast channel-to-n8n webhook bridge. |
| `superset` | Fork of the Superset agent IDE; check upstream ownership. |
| `relay-poc-smart-home` | Multi-framework smart-home Relay proof of concept. |
| `relay-poc-shopping-assistant` | Multi-agent shopping-assistant proof of concept. |
| `relay-poc-health-dashboard` | Multi-framework health dashboard Relay proof of concept. |
| `relay-poc-content-pipeline` | Multi-agent content pipeline proof of concept. |
| `relay-poc-code-review` | Multi-agent code-review proof of concept. |
| `agent-harnesses` | Catalog of agent harnesses and supported models. |
| `relayrank` | RelayRank content and SEO operating system. |
| `relay-cross-framework-demo` | LangGraph-to-CrewAI communication demo over Relaycast. |
| `planner` | Planning web UI for agent tasks. |
| `sloppypaste` | Public site explaining sloppypasting. |
| `agent-trace` | Fork of the Agent Trace format RFC; check upstream ownership. |
| `relay-pulse` | Animated visualization of Relay messages. |
| `relay-visualizer` | Interactive Agent Relay architecture and message-flow explainer. |
| `moltslack` | Agent-first coordination workspace. |
| `vscode-acp` | Fork of the VS Code ACP extension; check upstream ownership. |
| `gitclawlab` | Agent-operated code hosting and deployment platform. |
| `swarm-patterns` | Interactive agent swarm pattern visualizations. |
| `relay-pty-visualizer` | Animated Relay-to-PTY delivery pipeline explainer. |
| `tic-tac-toe` | CLI game demonstrating Relay-coordinated agents. |
| `simple-swarm` | Relay SDK integration examples and tests. |
| `.github` | AgentWorkforce GitHub organization profile. |

The public `orchestrator` repository is nonarchived but empty, so it has no owned surface to route work to. This table does not enumerate additional private repositories. Use an authorized `gh repo list` result and inspect the candidate's README when work may belong there.

## Split work by the failing boundary

- **Desktop message or session problem:** check `relay-desktop` for app/probe behavior, `relay` for relay integration, `relaycast-cloud` for hosted delivery, and `relayhistory-cloud` for hosted session ingestion. Route the change to the layer that fails.
- **Integration problem:** check `cloud` for OAuth and connection management, `relayfile-adapters` for provider mapping or writeback, and `relayfile` for VFS or delivery mechanics.
- **Flow problem:** check `flows` for the current flow definition and runtime, and `cloud` for hosted deployment or trigger wiring. Check `relayflows` only when the affected package is from that older repo.
- **Agent problem:** check `agents` for one agent's behavior, `workforce` for shared persona/runtime behavior, and `skills` for instructions the agent consumes.

A change can legitimately span repositories. Identify the owning file or API in each repo before opening issues or PRs, and link related work rather than assuming one repo owns the whole feature.
