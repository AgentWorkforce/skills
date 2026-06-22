---
name: factory-config
description: Use when creating, editing, or validating an Agent Relay Factory factory.config.json file, including repo routing, Linear state/team settings, GitHub issue ingestion, live mode, and babysitter options.
---

# Factory Config

Create valid `factory.config.json` files for `@agent-relay/factory`.

## Source of Truth

Use the factory repo schema before inventing fields:

- `factory/src/config/schema.ts` exports `FactoryConfigSchema`.
- `factory/src/config/schema.test.ts` shows valid examples and defaults.
- There is currently no checked-in JSON Schema artifact; the authoritative schema is Zod.

Validate with the installed or local factory:

```bash
factory run-once --config ./factory.config.json --dry-run
```

If the current CLI defaults are available, `factory start` uses `./factory.config.json` and starts live mode. Otherwise use the explicit form:

```bash
factory start --mode live --config ./factory.config.json
```

## Recommended Shape

Prefer compact repo config. `workspaceId` is optional; omit it to use the active relayfile cloud workspace.

```json
{
  "repos": {
    "org": "AgentWorkforce",
    "cloneRoot": "/Users/khaliqgant/Projects/AgentWorkforce",
    "names": ["relayfile-adapters"],
    "default": "relayfile-adapters"
  },
  "safety": {
    "requireTitlePrefix": "[factory]",
    "requireLabel": "factory",
    "requireTeamKey": "AR"
  },
  "linear": {
    "teamIds": {
      "AR": "50cf92f3-f53c-4ab6-bf05-ea76ebd21692"
    }
  },
  "stateIds": {
    "readyForAgent": "b9bec744-b60c-4745-8022-d90d6ab59ae3",
    "agentImplementing": "39b9881d-1196-4c95-8b80-a20f0c7263f7",
    "inPlanning": "3de351f2-90e6-4731-aa6b-4a55b77f481e",
    "done": "83ea5383-bfe9-425a-86ef-517b8190f09a"
  },
  "mergePolicy": "never"
}
```

Compact repo config derives:

- `repos.byLabel.<name>` as `<org>/<name>`, with `repos.overrides` for exceptions.
- `repos.clonePaths.<owner/repo>` from `cloneRoot`.
- `subscription.labels` from `repos.names` unless explicitly set.

Use explicit `repos.byLabel` when a label should route to a repo not derivable from `org` and `names`.

## GitHub Issue to Linear to PR

For GitHub issues labeled `factory`, include the GitHub repo in `repos.names` or `repos.byLabel`. The factory mirrors matching GitHub issues to Linear, then dispatches once the Linear mirror is in Ready for Agent.

For reliable Linear create writeback, include `linear.teamIds` for the required team key until the adapter accepts team keys/names directly.

## Linear States

Prefer dynamic state-name resolution when `/linear/states` is available:

```json
{
  "linear": {
    "states": {
      "readyForAgent": "Ready for Agent",
      "agentImplementing": "Agent Implementing",
      "inPlanning": "In Planning",
      "done": "Done",
      "humanReview": "In Human Review"
    },
    "statesByTeam": {}
  }
}
```

If the states resource is unavailable, pin `stateIds` UUIDs. `stateIds` is an escape hatch and may omit roles that resolve by name.

## Babysitter

The PR babysitter is **off by default**:

```json
{
  "babysitter": { "enabled": false },
  "models": { "babysitter": "sonnet" }
}
```

Enable it when the factory should spawn a follow-up agent after an implementer opens a PR:

```json
{
  "babysitter": { "enabled": true },
  "terminalState": "human-review",
  "models": { "babysitter": "sonnet" }
}
```

With babysitter enabled, PR-open completion is webhook-driven: the babysitter shepherds review comments, conflicts, and CI, then signals readiness before the issue advances.

## Common Defaults

- `batchSize`: `5`
- `mergePolicy`: `"never"`
- `safety.requireLabel`: `"factory"`
- `safety.requireTeamKey`: `"AR"`
- `models.babysitter`: `"sonnet"`
- `babysitter.enabled`: `false`
- `terminalState`: `"human-review"`
- `loop.maxIterations`: `3`
- `liveSubscription.transport`: `"subscribe-and-poll"`

## Checklist

Before finishing a config:

1. Confirm every repo label used by issues maps through `repos.byLabel` or compact `repos.names`.
2. Confirm `cloneRoot`/`clonePaths` point to real local checkouts.
3. Confirm `linear.teamIds` includes `safety.requireTeamKey` when GitHub mirrors may be created.
4. Confirm state names or `stateIds` match the target Linear workspace.
5. Run `factory run-once --config ./factory.config.json --dry-run`.
