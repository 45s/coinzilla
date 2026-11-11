# Workspace package map

This page describes the current `develop` workspace. Package manifests, source trees and local roadmaps are the source of truth.

## Repository areas

| Path | Responsibility |
| --- | --- |
| `apps/` | Runnable applications and their composition/configuration boundaries. |
| `packages/` | Shared, independently owned workspace packages. |
| `.github/workflows/` | CI, deterministic test, coverage, audit and opt-in integration workflows. |
| `docs/` | Repository-wide architecture, contributor and operational guidance. |

## Applications

### `apps/harvester/` — `@coinzilla/harvester`

Event-driven spot-trading application. Owns Conservative strategy workflows, Portfolio/RecoveryLedger state, order lifecycle coordination, startup/shutdown and composition of Brokers, Event Bus, Journal and Notifiers.

- Roadmap: [apps/harvester/ROADMAP.md](../apps/harvester/ROADMAP.md)
- Operational guide: [apps/harvester/README.md](../apps/harvester/README.md)

## Shared packages

### `packages/brokers/` — `@coinzilla/brokers`

Exchange-facing broker implementation and normalized exchange adapters. Current Binance integration uses native WebSocket API and Streams clients.

- Roadmap: [packages/brokers/ROADMAP.md](../packages/brokers/ROADMAP.md)
- Unit tests: `pnpm --filter @coinzilla/brokers test`
- Opt-in integration tests: `pnpm --filter @coinzilla/brokers test:integration`

### `packages/db/` — `@coinzilla/db`

Provider-neutral database lifecycle and persistence infrastructure. Domain repository contracts belong to their owning application/package; this package owns database adapters and operational mechanics.

- Roadmap: [packages/db/ROADMAP.md](../packages/db/ROADMAP.md)

### `packages/entities/` — `@coinzilla/entities`

Canonical immutable value objects and contracts for assets, markets, money, quantities, balances, orders, fills, commissions, trading rules and broker results.

- Roadmap: [packages/entities/ROADMAP.md](../packages/entities/ROADMAP.md)

### `packages/event-bus/` — `@coinzilla/event-bus`

In-process asynchronous event delivery with bounded fan-out, subscriber isolation, diagnostics and explicit flush/close lifecycle.

- Roadmap: [packages/event-bus/ROADMAP.md](../packages/event-bus/ROADMAP.md)

### `packages/journal/` — `@coinzilla/journal`

Durable JSONL event recording and recovery of persisted records. Journal stores evidence; it does not own trading state or decide business meaning.

- Roadmap: [packages/journal/ROADMAP.md](../packages/journal/ROADMAP.md)

### `packages/market-simulator/` — `@coinzilla/market-simulator`

Offline historical market replay and simulated spot execution through the existing broker contract. No current application or production workflow consumes it, so it is a low-priority optional tool; enhancements are deferred until a concrete consumer exists. History and market metadata are supplied explicitly by the caller; do not assume a bundled market-history fixture.

- Roadmap: [packages/market-simulator/ROADMAP.md](../packages/market-simulator/ROADMAP.md)

### `packages/notifiers/` — `@coinzilla/notifiers`

Optional operational notification transports. Telegram is implemented with bounded serialized delivery and credential-safe formatting; consumers own configuration and secret loading.

- Roadmap: [packages/notifiers/ROADMAP.md](../packages/notifiers/ROADMAP.md)

### `packages/utils/` — `@coinzilla/utils`

Domain-neutral shared helpers, including exact decimal arithmetic, result/validation helpers and structured logging.

- Roadmap: [packages/utils/ROADMAP.md](../packages/utils/ROADMAP.md)

### `packages/indicators/` — `@coinzilla/indicators`

Exchange-neutral technical indicator calculations over caller-supplied completed candles. The package owns ATR, NATR and volatility-ratio calculations; it does not retrieve market data or define trading policy.

- README: [Indicators package contract](../packages/indicators/README.md)
- Roadmap: [Indicators roadmap](../packages/indicators/ROADMAP.md)
- Agent instructions: [Indicators AGENTS](../packages/indicators/AGENTS.md)

## Choosing where a change belongs

1. Put business invariants and strategy behavior in the bounded context that owns them.
2. Put exchange protocol and response normalization in Brokers; keep consumers on narrow application-facing contracts.
3. Put immutable, exchange-neutral business values in Entities.
4. Put genuinely domain-neutral helpers in Utils; do not move business rules there merely to share code.
5. Keep Journal and Event Bus out of domain policy. They are application-level capabilities with explicit durability/delivery contracts.
6. Keep SQL/filesystem/transport mechanics in infrastructure adapters; repository contracts belong to the domain/application consumer.
7. Add tests beside the owning module. Run focused tests first, then package coverage and relevant workspace CI.

## Keep this map accurate

When an application/package is added, removed, renamed or changes responsibility, update this map and the owning roadmaps in the same PR. Verify package names, scripts, dependencies and entry points against current manifests. Do not list deleted application paths or assume a test fixture is bundled unless it exists in the package tree.
