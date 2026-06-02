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

## Good source files to inspect

- `workforce/examples/review-agent/persona.json`
- `workforce/examples/review-agent/agent.ts`
- `workforce/examples/weekly-digest/persona.json`
- `workforce/examples/weekly-digest/agent.ts`
- `workforce/packages/persona-kit/src/types.ts`
- `workforce/packages/runtime/src/types.ts`
- `workforce/packages/persona-kit/schemas/persona.schema.json`
- `workforce/packages/deploy/src/preflight.ts`

## Important nuance

Older plan/docs may still mention `tiers`, old proactive shapes, or trigger declarations on the persona. Prefer the real example personas, `defineAgent(...)` examples, and current `persona-kit` / runtime types over older planning text when they conflict.

## Authoring heuristic

- Put deploy/runtime config and integration connection requirements in `persona.json`
- Put wakeup declarations in `defineAgent(...)` inside `agent.ts`
- Put branch logic and side effects in the handler
- Keep one persona/agent = one coherent job
- Keep the handler imperative and readable
