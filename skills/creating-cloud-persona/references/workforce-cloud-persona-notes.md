# Workforce Cloud Persona Notes

Use these notes to ground the skill in the current repo shape.

## Current realities

- Cloud personas use flat top-level runtime fields:
  - `harness`
  - `model`
  - `systemPrompt`
  - `harnessSettings`
- `onEvent` points to the handler entrypoint, usually `./agent.ts`
- Triggers are declared on the persona, but handler logic lives in `agent.ts`
- Runtime events are currently shaped around:
  - `source: 'cron'` plus `name`
  - provider events with `source`, `type`, `payload`

## Good source files to inspect

- `examples/review-agent/persona.json`
- `examples/review-agent/agent.ts`
- `examples/weekly-digest/persona.json`
- `examples/weekly-digest/agent.ts`
- `packages/persona-kit/src/types.ts`
- `packages/runtime/src/types.ts`
- `packages/persona-kit/schemas/persona.schema.json`
- `packages/deploy/src/preflight.ts`

## Important nuance

Older plan/docs may still mention `tiers` or older phrasing around deployability. Prefer the real example personas and current `persona-kit` / runtime types over older planning text when they conflict.

## Authoring heuristic

- Put wakeup declarations in `persona.json`
- Put branch logic and side effects in `agent.ts`
- Keep one persona = one coherent job
- Keep the handler imperative and readable
