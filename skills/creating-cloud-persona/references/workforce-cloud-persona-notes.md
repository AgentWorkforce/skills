# Workforce Cloud Persona Notes

Use these notes to ground the skill in the current repo shape.

## Current realities

- Cloud personas use flat top-level runtime fields:
  - `harness`
  - `model`
  - `systemPrompt`
  - `harnessSettings`
- `onEvent` points to the handler entrypoint, usually `./agent.ts`
- Trigger, schedule, and watch declarations now live in `agent.ts` via `defineAgent(...)`
- `persona.json.integrations` is for connection/setup requirements, not event trigger declaration
- Runtime events are currently shaped around:
  - `source: 'cron'` plus `name`
  - provider events with `source`, `type`, `payload`
- There are **no** per-provider clients on `ctx` (`ctx.github` / `ctx.linear` were removed). Provider reads/writes use **`@relayfile/relay-helpers`** — catalog-backed factory clients (`linearClient().comment(...)`, `slackClient().post(...)`, `githubClient().mergePullRequest(...)`, generic `relayClient(provider)` / `providerClient(provider)`). Writes are draft files the Relayfile writeback worker materializes into real provider calls. The raw `@agentworkforce/runtime` VFS helpers (`readJsonFile`/`writeJsonFile`/`draftFile`/`resolveMountRoot`) are the lower-level fallback for non-catalog reads
- Deploy is **agent-driven** via the `agentworkforce` CLI: the agent runs `deploy --dry-run` then `deploy <persona> --mode cloud --on-exists update` (default `--on-exists` is `cancel`, a silent no-op) and reports the live link; the human runs the interactive `login` (stores `~/.agentworkforce/active.json`) and finishes each integration-connect popup

## Good source files to inspect

- `workforce/examples/review-agent/persona.json`
- `workforce/examples/review-agent/agent.ts`
- `workforce/examples/weekly-digest/persona.json`
- `workforce/examples/weekly-digest/agent.ts`
- `workforce/packages/persona-kit/src/types.ts`
- `workforce/packages/runtime/src/types.ts`
- `workforce/packages/persona-kit/schemas/persona.schema.json`
- `workforce/packages/deploy/src/preflight.ts`
- `@relayfile/relay-helpers` (npm; source in `relayfile-adapters/packages/relay-helpers`) — the ergonomic provider clients + the all-29-provider `relayClient`/`providerClient`
- `workforce/packages/runtime/src/clients/index.ts` (the VFS helpers, re-exported from `@relayfile/adapter-core/vfs-client` — the lower-level fallback)
- `workforce/packages/cli/src/deploy-command.ts` (the `login` / `deploy` flow)
- `workforce/packages/deploy/src/extract-agent.ts` (why a bare `export default handler(...)` is rejected — `defineAgent` is required)

## Important nuance

Older plan/docs may still mention `tiers`, old proactive shapes, or trigger declarations on the persona. Prefer the real example personas, `defineAgent(...)` examples, and current `persona-kit` / runtime types over older planning text when they conflict.

## Authoring heuristic

- Put deploy/runtime config and integration connection requirements in `persona.json`
- Put wakeup declarations in `defineAgent(...)` inside `agent.ts`
- Put branch logic and side effects in the handler
- Keep one persona/agent = one coherent job
- Keep the handler imperative and readable
