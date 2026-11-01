# Coin Farmer — Module Catalog

This catalog defines the proposed source tree and the responsibility of each module. It is intentionally more specific than a layer diagram. The files are proposed; no application code is created by this documentation PR.

## 1. Target source layout

The preferred top-level structure is intentionally simple:

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

- `bootstrap/container.js` is the composition root; `bootstrap/startup.js` owns startup, rollback, signals and bounded shutdown.
- `config/loader.js` and `config/validator.js` load and validate configuration before trading capabilities are made available.
- `application/strategy-runner.js` coordinates the strategy; `pair-manager.js` owns per-market orchestration; `reconciliation.js` owns broker/local-state recovery.
- `domain/` contains pure strategy, accounting, profitability, inventory and state-machine rules.
- `ports/` defines application-facing contracts. `infrastructure/` supplies Binance, Telegram, EventBus, Journal, persistence, scheduling and logging implementations.

Do not create empty placeholder files. Add a module when its contract, owner, tests and consuming workflow are ready.

## 2. Bootstrap and configuration

| Proposed module | Responsibility | Inputs / outputs | Allowed dependencies |
|---|---|---|---|
| `src/index.js` | Thin Node entry point; call runtime factory and start it; surface fatal startup error | Process entry -> runtime handle | runtime only |
| `bootstrap/container.js` | Composition root; construct config, logger, event bus, adapters, ports, workflows and coordinator | Env/config -> composed runtime object | All outer modules and shared package public APIs |
| `bootstrap/startup.js` | Ordered startup and rollback if any stage fails | Runtime -> started runtime or startup failure | application lifecycle, adapters |
| `bootstrap/startup.js` | Idempotent, bounded, dependency-safe shutdown; flush events and close integrations | Runtime -> shutdown result | application and adapter close methods |
| `config/loader.js` | Load JSON config and environment secrets separately | File/env -> raw config | Node filesystem/path only |
| `config/validator.js` | Validate schema, decimal-string fields, market mappings, feature flags and required secrets | Raw config -> validated config or errors | pure validation + shared exact-value contracts |

## 3. Domain — pure strategy policy

| Proposed module | Responsibility | Inputs / outputs | Must not do |
|---|---|---|---|
| `domain/strategy/calculate-buy-price.js` | Calculate initial/next BUY limit from reference price and configured percentage step using exact decimal operations | Last-trade/reference price + step + tick size -> exact rounded price | Read streams, call broker, use Number |
| `domain/strategy/plan-buy.js` | Decide whether a BUY intent is valid for current market state, funds and existing reservations | Canonical market facts + state -> intent/refusal | Submit orders or reserve external funds itself |
| `domain/profitability/approve-sell.js` | Single pure SELL profitability gate; return exact breakdown and refusal codes | Candidate qty/price, cost/recovery facts, fees/reserves, minProfit, rules -> approval/denial | Submit/cancel orders or fetch missing prices |
| `domain/state-machine/market-state.js` | Define state values and validate state shape | State data -> validated immutable state | I/O |

| `domain/accounting/calculate-fill-accounting.js` | Interpret one canonical fill and its actual commissions into exact base/quote deltas | Fill + market assets -> accounting facts or incomplete result | Estimate actual commission from configured rates |
| `domain/accounting/fill-ledger.js` | Immutable fill facts, stable identity, duplicate/conflict detection and deterministic projection | Existing ledger + Fill -> updated ledger / duplicate / discrepancy | Persist directly |
| `domain/inventory/inventory-ledger.js` | Track strategy-owned active/free/reserved/executed-awaiting-reconciliation/external buckets | Ledger + order/fill/balance facts -> new ledger | Read total wallet balance and assume ownership |
| `domain/accounting/recovery-cycle.js` | Track recovery amount, cumulative realized proceeds/fees and completed-cycle/free allocation rules | Cycle + reconciled fills -> updated cycle / completion decision | Mark free coins from partial/canceled/under-profitable sells |
| `domain/orders/order-intent.js` | Canonical strategy request before broker acknowledgement | Market/side/type/price/qty/client identity -> intent | Store exchange SDK object |
| `domain/state-machine/order-transition.js` | Model order lifecycle and unknown outcomes independently of exchange status strings | Canonical order facts -> transition result | Assume timeout means rejection/cancellation |

**Domain rule:** functions should be deterministic and testable with plain canonical values. Use current `@coinzilla/entities` public types where their semantics fit. Do not create duplicate local Asset, Market, Money, Quantity, CanonicalOrder, Fill, Commission, Balance or TradingRules classes.

## 4. Application ports

Ports describe capabilities required by workflows. The first concrete implementation is Binance, but port names and result contracts are CEX-neutral.

| Port | Required capability | Notes |
|---|---|---|
| `broker/market-data.js` | Subscribe/unsubscribe and provide canonical last-trade observations with source time and stream health/gap signals | Strategy requires last traded price, not best bid/ask as an unapproved substitute |
| `broker/trading.js` | Place limit / post-only orders, request cancellation, query order by canonical identity | Mutation outcomes distinguish rejected, accepted, and ambiguous |
| `broker/account.js` | Read canonical balances/account snapshot and effective fee eligibility where supported | Preserve free/locked/total and source timestamp |
| `broker/execution-history.js` | Read order history and fills with pagination/completeness evidence | Needed to reconcile WebSocket fills and restart |
| `broker/market-rules.js` | Read canonical trading increments, bounds, supported order types and freshness | Missing rules fail closed |
| `state-repository.js` | Load/save versioned strategy state and ledger checkpoint | In-memory adapter first; durable DB later |
| `event-publisher.js` | Publish canonical internal events and flush/close | Adapter wraps EventBus |
| `notification-publisher.js` | Deliver curated user notifications | Telegram first; optional and failure-isolated |
| `clock.js` | Current time and monotonic time when needed | Deterministic tests; no Date.now inside domain |

Do not make one giant `Broker` port. Keep read/query and mutation capabilities cohesive. Do not finalize method signatures until the first port PR checks the actual public Binance broker API and shared canonical entities.

## 5. Application orchestration

| Proposed module | Responsibility | Calls / emits |
|---|---|---|
| `workflows/initialize-market.js` | Validate required capabilities, market rules, fee eligibility, market data and initial broker facts before enabling a market | broker read ports; state transitions; pause diagnostics |
| `workflows/process-market-observation.js` | Validate freshness, serialize market processing, ask domain for BUY decision and coordinate order intent | market-data facts -> domain -> trading port |
| `workflows/process-order-update.js` | Normalize application handling of order updates; separate order status from fill facts | order state + fill workflow |
| `application/reconciliation.js` | Apply canonical fill exactly once, update ledger, persist via repository, publish execution events | fill ledger + repository + event publisher |
| `workflows/reconcile-market.js` | Compare tracked orders/fills/local reservations with complete broker history and balances | account/history/trading ports + domain ledger |
| `workflows/recover-market.js` | Gate reconnect/restart recovery; do not resume until reconciliation succeeds | reconciliation workflow + explicit state transition |
| `workflows/stop-strategy.js` | Stop strategy mutation, drain queued work and preserve order/state visibility | coordinator + event publisher |
| `services/strategy-coordinator.js` | Own process-level lifecycle and per-market workflow instances; isolate failures between markets | use cases, market queue |
| `services/market-task-queue.js` | Serialize state-changing work per market and coordinate shared-asset constraints across markets | pure concurrency utility |

## 6. Infrastructure implementations

| Proposed module | Responsibility | Current integration |
|---|---|---|
| `broker/binance-websocket/create-binance-broker.js` | Create/connect existing Binance WebSocket broker with credentials/config | `BinanceWebSocketBroker`, `BinanceWebSocketConfig` from `@coinzilla/brokers` |
| `broker/binance-websocket/market-data-adapter.js` | Map last-trade stream to canonical market observations; surface reconnect/gap health | Binance public streams |
| `broker/binance-websocket/trading-adapter.js` | Map canonical order intent and cancel/query operations to broker methods | Binance WebSocket API |
| `broker/binance-websocket/account-adapter.js` | Map balances, account snapshot and fee eligibility | Binance account methods |
| `broker/binance-websocket/history-adapter.js` | Map order/trade history, completeness and pagination | Binance history methods |
| `broker/binance-websocket/mappers/*` | Translate exchange payload/status/filter/fee names into shared canonical entities | Binance-only knowledge lives here |
| `notifications/telegram/telegram-adapter.js` | Prepare optional Telegram notifier and subscribe to curated application events | `TelegramNotifier`, `subscribeTelegramNotifications` from `@coinzilla/notifiers` |
| `notifications/telegram/notification-mapper.js` | Map canonical events to safe concise Telegram messages | No trading decisions |
| `events/event-bus-adapter.js` | Wrap `EventBus` publish/subscribe/flush/close semantics | `@coinzilla/event-bus` |
| `journal/journal-adapter.js` | Record operational events and drain/close journal | `@coinzilla/journal`; not authoritative strategy state |
| `persistence/in-memory-state-repository.js` | Deterministic initial repository for tests/simulation | No restart guarantee; later DB adapter implements same port |
| `logging/logger-adapter.js` | Provide structured logger and redact secrets/sensitive payloads | `@coinzilla/utils` logger candidate |

## 7. Tests

| Directory | Scope |
|---|---|
| `test/unit/domain` | Pure strategy, accounting, inventory and state-machine rules |
| `test/unit/application` | Workflow ordering, port contracts, failure paths and idempotency |
| `test/contract/broker` | Shared fixtures every CEX adapter must pass |
| `test/contract/notifications` | Curated event mapping, disabled/invalid config and send failures |
| `test/integration` | Real shared-package wiring; explicit opt-in external integration |
| `test/simulation` | Deterministic fake exchange, market events, fills, fees, cancel races, disconnect/restart |
| `test/acceptance` | Controlled TESTNET scenarios and operational gates |

## 8. V1 source-to-CF responsibility map

V1 is evidence, not a source dependency. This table tells implementers where to study behavior and where the independent CF implementation is expected to live.

| V1 source/document | Existing responsibility/evidence | CF target |
|---|---|---|
| `src/index.js` | Composition, startup rollback, signals, shutdown order | `bootstrap/container.js`, `start-runtime.js`, `shutdown-runtime.js` |
| `src/prepare-broker.js` | Binance WebSocket broker construction | `infrastructure/broker/binance-websocket/*` |
| `src/prepare-telegram-notifications.js` | Optional Telegram configuration and event subscription | `infrastructure/notifications/telegram/*` |
| `src/prepare-journal.js` | Journal construction | `infrastructure/journal/journal-adapter.js` |
| `src/validate-config.js` | Strategy config validation | `config/validator.js` |
| `src/bot/bot-free-roll.js` | Main coordinator, per-market state, queues, stream handling, recovery and order orchestration | Split into application coordinator/workflows and domain state; do not copy this large coordinator as a CF design |
| `src/bot/order-execution.js` | Order placement/cancellation/replacement helpers | Application trading workflow + broker trading adapter |
| `src/bot/event-handling.js` | Event intake/routing | Adapter event mapping + application event workflows |
| `src/bot/fill-ledger.js` | Immutable fill ledger and duplicate/conflict handling | `domain/accounting/fill-ledger.js` |
| `src/bot/fill-reconciliation.js` | Fill normalization/reconciliation transition | `application/reconciliation.js` + domain accounting |
| `src/bot/market-inventory-ledger.js` | Per-market strategy/unmanaged inventory projections | `domain/inventory/inventory-ledger.js` |
| `src/bot/inventory-allocation.js` | Free inventory allocation rule | `domain/accounting/recovery-cycle.js` |
| `src/bot/reconciliation-snapshot.js`, `recovery.js` | Snapshot validation and tracked-order recovery | `application/reconciliation.js` |
| `src/bot/helpers/decimal.js`, `accounting.js`, `order-planning.js`, `trading-rules.js` | Exact arithmetic and planning behavior (audit each helper before reuse) | Shared exact entities/utilities + CF domain policy; no copy until contract reuse reviewed |
| V1 `README.md` | Approved strategy semantics and open decisions | CF behavior map + domain acceptance tests |
| V1 `ROADMAP.md` | Engineering invariants and unfinished work | CF roadmap phases and gates; do not copy V1 completion status |

## 9. File creation rule

Do not create empty placeholder files just to match this tree. Introduce a module when its contract, owner, tests and consuming workflow are ready. If a proposed module proves unnecessary, update this catalog and record why rather than preserving architecture theatre.
