# Workspace package map

This page is a quick guide to where shared code lives in the Coinzilla pnpm workspace. It is based on the current package manifests and source tree; the code and package manifests remain the source of truth.

## Repository areas

| Path | Responsibility | Notes |
| --- | --- | --- |
| `apps/` | Runnable applications | Application-specific entry points and configuration live here. |
| `packages/` | Shared workspace modules | Packages can depend on each other through `workspace:*` dependencies. |
| `.github/workflows/` | Automated checks | Workflow triggers and commands are defined in the workflow YAML files. |
| `docs/` | Contributor and operational guidance | Keep process documentation aligned with the actual scripts and configuration. |

## Applications

### `@coinzilla/market-simulator` — `apps/market-simulator/`

Deterministic market replay and simulation for strategy testing. The simulator must implement the existing Coinzilla broker contract and reuse established normalized messages; it must not introduce a parallel strategy-facing API.

- Package roadmap: [`apps/market-simulator/ROADMAP.md`](../apps/market-simulator/ROADMAP.md)
- Unit tests: `pnpm --filter @coinzilla/market-simulator test`
- Initial DOGE history fixture migration is blocked because the existing Free-Roll `doge-history.json` is empty.

## Shared packages

### `@coinzilla/utils` — `packages/utils/`

Common helpers used by other packages, including logging, validation, event names, result helpers, UUID generation, time formatting, and number utilities.

- Entry point: `src/index.js`
- Unit tests: `pnpm --filter @coinzilla/utils test`

### `@coinzilla/entities` — `packages/entities/`

Domain objects and adapters for coins and orders, including order execution representations and order-related error messages.

- Entry point: `src/index.js`
- Unit tests: `pnpm --filter @coinzilla/entities test`
- Depends on `@coinzilla/utils`

### `@coinzilla/event-bus` — `packages/event-bus/`

Event-bus implementation and its public package entry point.

- Public export: `src/index.js`
- Unit tests: `pnpm --filter @coinzilla/event-bus test`
- Depends on `@coinzilla/utils`

### `@coinzilla/journal` — `packages/journal/`

Journal functionality and its public package entry point.

- Public export: `src/index.js`
- Unit tests: `pnpm --filter @coinzilla/journal test`
- Depends on `@coinzilla/event-bus` and `@coinzilla/utils`

### `@coinzilla/brokers` — `packages/brokers/`

Broker abstractions and exchange integrations. The current source tree includes Binance broker methods, SDK integration, websocket streams, and adapters for exchange messages and assets.

- Entry point: `src/index.js`
- Unit tests: `pnpm --filter @coinzilla/brokers test`
- Integration tests: `pnpm --filter @coinzilla/brokers test:integration`
- SDK integration tests: `pnpm --filter @coinzilla/brokers test:sdk`

Broker integration tests may require network access and test-environment credentials. Keep them separate from the default deterministic unit-test suite, and use TESTNET for tests that place orders.

## Choosing where a change belongs

1. Put domain-specific behavior in the package that owns that domain rather than duplicating it in an application.
2. Put genuinely reusable, domain-neutral helpers in `@coinzilla/utils`; avoid moving domain rules there just to share a few lines.
3. Keep public exports explicit through the package's existing entry point and `exports` field where one is defined.
4. Add or update tests beside the affected module, following the package's existing `node:test` conventions.
5. Run the narrow package test first, then the repository quality checks when feasible:

   ```sh
   pnpm --filter @coinzilla/<package-name> test
   pnpm run quality
   ```

   Replace `<package-name>` with the package's actual name. For broker changes, also review the separate integration-test requirements in [the contributing guide](./contributing.md).

## Keep this map accurate

When a package is added, removed, renamed, or its public responsibility changes, update this page in the same pull request. Verify names, scripts, dependencies, and entry points against its `package.json`; do not treat this overview as a replacement for those contracts.


## Domain ownership and AI-agent boundaries

The paths above are ownership boundaries for independent AI workstreams. Each domain's local `AGENTS.md` and `ROADMAP.md` are authoritative for its backlog and local conventions:

- `apps/bot-free-roll/` — Free-Roll application and strategy.
- `apps/market-simulator/` — CoreBroker-compatible mock that streams historical market prices from the existing DOGEUSDT fixture.
- `packages/entities/` — shared domain entities and value contracts.
- `packages/brokers/` — broker abstractions, exchange adapters, and broker-facing contracts.
- `packages/utils/` — domain-neutral shared utilities.
- `packages/event-bus/` — event delivery and event-bus contracts.
- `packages/journal/` — journal persistence and journal-facing behavior.

A consumer that needs a capability from another domain creates a cross-domain request as described in [the AI-agent workflow](../AI_AGENT_WORKFLOW.md). The owning domain implements and tests its own package changes. Do not quietly expand a task into another domain.
