---
name: trigger-autocomplete-catalog
description: Use when adding webhook events to make sure integrations properly register the webhook events they carry
---

# Trigger Autocomplete Catalog

Use this whenever a provider has webhook/event triggers.

## Goal

Ensure persona trigger autocomplete and deploy-time lint include the provider via `KNOWN_TRIGGER_CATALOG`.

## Required outcomes

- Provider appears in `packages/core/src/triggers/catalog.generated.ts` under `KNOWN_TRIGGER_CATALOG`.
- Provider is absent from `packages/core/src/triggers/adapters-without-known-triggers.generated.json` for missing trigger metadata.
- Event names are verbatim provider event names used at runtime.

## Implementation options

1. Add `supportedEvents(): string[]` to the adapter class.
2. Or add `<provider>.mapping.yaml` with `webhooks:` keys.

## Validation

```bash
npm run build --workspace=packages/core
node --import tsx packages/core/src/cli.ts triggers generate --repo-root .
node --import tsx packages/core/src/cli.ts triggers check --repo-root .
node --import tsx --test packages/core/tests/triggers/catalog-generator.test.ts
npm test --workspace=packages/<provider>
```

## Notes

- Reference `relayfile-adapters#115` when closing missing-provider autocomplete gaps.
- If a provider intentionally has no event source, document why it remains in the `without-known-triggers` list.
