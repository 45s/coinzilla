# Coin Farmer — Module Catalog

This catalog defines the preferred source tree and the responsibility of each module. All files are proposed; no application code is created by this documentation change.

## 1. Target source layout

```text
src/
├── index.js
├── bootstrap/
│   ├── container.js
│   └── startup.js
├── config/
│   ├── loader.js
│   └── validator.js
├── application/
│   ├── strategy-runner.js
│   ├── pair-manager.js
│   └── reconciliation.js
├── domain/
│   ├── strategy/
│   │   ├── calculate-buy-price.js
│   │   └── plan-buy.js
│   ├── accounting/
│   │   ├── fill-ledger.js
│   │   ├── calculate-fill-accounting.js
│   │   └── recovery-cycle.js
│   ├── profitability/
│   │   └── approve-sell.js
│   ├── inventory/
│   │   └── inventory-ledger.js
│   └── state-machine/
│       ├── market-state.js
│       └── order-transition.js
├── infrastructure/
│   ├── broker/binance-websocket/
│   │   ├── create-binance-broker.js
│   │   ├── market-data-adapter.js
│   │   ├── trading-adapter.js
│   │   ├── account-adapter.js
│   │   ├── history-adapter.js
│   │   └── mappers/
│   ├── notifications/telegram/
│   │   ├── telegram-adapter.js
│   │   └── notification-mapper.js
│   ├── persistence/
│   │   └── in-memory-state-repository.js
│   ├── scheduler/
│   │   └── market-task-queue.js
│   ├── logging/
│   │   └── logger-adapter.js
│   ├── journal/journal-adapter.js
│   └── event-bus/event-bus-adapter.js
└── ports/
    ├── broker.js
    ├── journal.js
    ├── event-bus.js
    ├── state-repository.js
    ├── notification-publisher.js
    └── clock.js
```

- `bootstrap/container.js` is the composition root. It constructs concrete infrastructure and injects its capabilities through ports.
- `bootstrap/startup.js` owns ordered startup, rollback, process signals and bounded shutdown.
- `config/loader.js` and `config/validator.js` load JSON/environment configuration and reject invalid settings before order capabilities are exposed.
- `application/strategy-runner.js` coordinates the strategy lifecycle; `pair-manager.js` serializes and coordinates per-market work; `reconciliation.js` handles fills, order/account reconciliation and recovery.
- `domain/` contains deterministic policy and state: strategy, accounting, profitability, inventory and state-machine rules.
- `ports/` defines application-facing contracts. `infrastructure/` contains the concrete Binance, Telegram, EventBus, Journal, persistence, scheduling and logging implementations.

Do not create empty placeholder files. Introduce a module when its contract, owner, tests and consuming workflow are ready.

## 2. Bootstrap and configuration

| Module | Responsibility | Boundary |
|---|---|---|
| `src/index.js` | Thin process entry point; invoke startup and surface fatal startup errors | Imports bootstrap only |
| `bootstrap/container.js` | Composition root; construct config, logger, ports, infrastructure and application services | Only place that knows concrete implementations |
| `bootstrap/startup.js` | Ordered startup, partial-startup rollback, signal handling and idempotent bounded shutdown | Calls application lifecycle and resource close methods |
| `config/loader.js` | Load JSON settings and environment secrets separately | Filesystem/environment access only |
| `config/validator.js` | Validate market mappings, decimal-string fields, strategy limits, feature flags and required secrets | Pure validation; no network calls |

Bootstrap and config contain no BUY/SELL formulas, inventory decisions or exchange-specific strategy policy.

## 3. Domain — pure policy and state

| Module | Responsibility | Must not do |
|---|---|---|
| `domain/strategy/calculate-buy-price.js` | Calculate initial/next BUY limit from reference price and configured percentage step using exact decimal operations | Read streams, call broker, use JS Number for financial values |
| `domain/strategy/plan-buy.js` | Decide whether a BUY intent is valid for current market state, funds and reservations | Submit orders or mutate external funds |
| `domain/profitability/approve-sell.js` | Single pure SELL profitability gate; return exact breakdown and refusal codes | Submit/cancel orders or fetch missing prices |
| `domain/accounting/calculate-fill-accounting.js` | Interpret canonical fills and actual commissions into exact base/quote deltas | Estimate actual fees from configured rates |
| `domain/accounting/fill-ledger.js` | Immutable fill facts, stable identity, duplicate/conflict detection and deterministic projection | Persist directly |
| `domain/accounting/recovery-cycle.js` | Track recovery amount, realized proceeds/fees and completed-cycle/free-allocation rules | Allocate free inventory on partial or under-profitable sells |
| `domain/inventory/inventory-ledger.js` | Track active/free/reserved/executed-awaiting-reconciliation/external inventory buckets | Assume total wallet balance is strategy-owned |
| `domain/state-machine/market-state.js` | Define market readiness states and validate transitions/state shape | Perform I/O |
| `domain/state-machine/order-transition.js` | Model order lifecycle and ambiguous outcomes independently of exchange status strings | Treat timeout as proof of rejection/cancellation |

Use canonical contracts from `@coinzilla/entities` when their semantics fit. Do not create duplicate local Asset, Market, Money, Quantity, CanonicalOrder, Fill, Commission, Balance or TradingRules classes.

## 4. Application orchestration

| Module | Responsibility |
|---|---|
| `application/strategy-runner.js` | Own strategy lifecycle and coordinate enabled markets; start/stop pair managers and isolate failures between markets |
| `application/pair-manager.js` | Serialize work for one market; process market observations and order updates; coordinate BUY/SELL intents through ports |
| `application/reconciliation.js` | Apply fills idempotently, reconcile local orders/inventory with broker history and balances, and gate reconnect/restart recovery |

Application orchestration decides when to call domain policy and when to persist, submit/cancel, reconcile or publish. It must not contain Binance payload names or Telegram transport details.

## 5. Ports

Ports describe capabilities required by application workflows. The first concrete broker is Binance, but the contracts remain exchange-neutral.

| Port | Required capability |
|---|---|
| `ports/broker.js` | Export cohesive market-data, trading, account, execution-history and market-rules capabilities. Preserve canonical values, freshness/completeness metadata and accepted/rejected/ambiguous mutation outcomes. |
| `ports/journal.js` | Append operational records and flush/close; not the authoritative strategy-state store |
| `ports/event-bus.js` | Publish/subscribe canonical internal events and flush/close |
| `ports/state-repository.js` | Load/save versioned strategy state and ledger checkpoints |
| `ports/notification-publisher.js` | Deliver curated user notifications; optional and failure-isolated |
| `ports/clock.js` | Supply wall-clock and monotonic time for deterministic tests |

Keep capability contracts cohesive. Do not let raw exchange SDK types or payloads cross the broker port.

## 6. Infrastructure implementations

| Module | Responsibility | Current integration |
|---|---|---|
| `infrastructure/broker/binance-websocket/create-binance-broker.js` | Construct/connect the existing Binance WebSocket broker | `BinanceWebSocketBroker`, `BinanceWebSocketConfig` from `@coinzilla/brokers` |
| `infrastructure/broker/binance-websocket/*-adapter.js` | Map canonical market data, trading, account and history operations to broker methods | Binance WebSocket API/Streams |
| `infrastructure/broker/binance-websocket/mappers/*` | Translate exchange payload/status/filter/fee names into shared canonical entities | Binance-only knowledge lives here |
| `infrastructure/notifications/telegram/telegram-adapter.js` | Prepare optional notifier and subscribe to curated application events | `TelegramNotifier`, `subscribeTelegramNotifications` from `@coinzilla/notifiers` |
| `infrastructure/notifications/telegram/notification-mapper.js` | Map canonical events to safe concise Telegram messages | No trading decisions |
| `infrastructure/event-bus/event-bus-adapter.js` | Wrap EventBus publish/subscribe/flush/close semantics | `@coinzilla/event-bus` |
| `infrastructure/journal/journal-adapter.js` | Record operational events and drain/close journal | `@coinzilla/journal` |
| `infrastructure/persistence/in-memory-state-repository.js` | Deterministic initial repository for tests/simulation | No restart guarantee; later DB adapter implements the same port |
| `infrastructure/scheduler/market-task-queue.js` | Serialize state-changing work per market and coordinate shared-asset constraints | No trading policy |
| `infrastructure/logging/logger-adapter.js` | Provide structured logging and redact secrets/sensitive payloads | `@coinzilla/utils` logger candidate |

## 7. Tests

| Directory | Scope |
|---|---|
| `test/unit/domain` | Pure strategy, accounting, profitability, inventory and state-machine rules |
| `test/unit/application` | Workflow ordering, port contracts, failure paths and idempotency |
| `test/contract/broker` | Shared fixtures every CEX adapter must pass |
| `test/contract/notifications` | Curated event mapping, disabled/invalid config and send failures |
| `test/integration` | Real shared-package wiring; explicit opt-in external integration |
| `test/simulation` | Deterministic fake exchange, market events, fills, fees, cancel races, disconnect/restart |
| `test/acceptance` | Controlled TESTNET scenarios and operational gates |

## 8. V1 source-to-CF responsibility map

V1 is evidence, not a source dependency. This table identifies where to study behavior and where the independent CF implementation belongs.

| V1 source/document | Existing responsibility/evidence | CF target |
|---|---|---|
| `src/index.js` | Composition, startup rollback, signals, shutdown order | `bootstrap/container.js`, `bootstrap/startup.js` |
| `src/prepare-broker.js` | Binance WebSocket broker construction | `infrastructure/broker/binance-websocket/*` |
| `src/prepare-telegram-notifications.js` | Optional Telegram configuration and event subscription | `infrastructure/notifications/telegram/*` |
| `src/prepare-journal.js` | Journal construction | `infrastructure/journal/journal-adapter.js` |
| `src/validate-config.js` | Strategy config validation | `config/validator.js` |
| `src/bot/bot-free-roll.js` | Main coordinator, per-market state, queues, stream handling, recovery and order orchestration | Split across `application/strategy-runner.js`, `pair-manager.js`, `reconciliation.js` and domain policy |
| `src/bot/order-execution.js` | Order placement/cancellation/replacement helpers | `application/pair-manager.js` + broker infrastructure |
| `src/bot/event-handling.js` | Event intake/routing | Event-bus infrastructure + application orchestration |
| `src/bot/fill-ledger.js` | Immutable fill ledger and duplicate/conflict handling | `domain/accounting/fill-ledger.js` |
| `src/bot/fill-reconciliation.js` | Fill normalization/reconciliation transition | `application/reconciliation.js` + domain accounting |
| `src/bot/market-inventory-ledger.js` | Per-market strategy/unmanaged inventory projections | `domain/inventory/inventory-ledger.js` |
| `src/bot/inventory-allocation.js` | Free inventory allocation rule | `domain/accounting/recovery-cycle.js` |
| `src/bot/reconciliation-snapshot.js`, `recovery.js` | Snapshot validation and tracked-order recovery | `application/reconciliation.js` |
| V1 decimal/accounting/order-planning helpers | Exact arithmetic and planning behavior; audit each helper before reuse | Shared exact entities/utilities + CF domain policy; no copy until contract reuse reviewed |
| V1 `README.md` and `ROADMAP.md` | Approved strategy semantics and unfinished work | CF behavior map + domain acceptance tests and roadmap |

## 9. File creation rule

Do not create empty placeholder files to match this tree. Introduce a module when its contract, owner, tests and consuming workflow are ready. If a proposed module proves unnecessary, update this catalog and record why rather than preserving architecture theatre.
