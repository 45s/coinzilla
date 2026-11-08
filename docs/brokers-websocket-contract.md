# Broker package: Binance WebSocket contract

## Source layout

The current source tree has a partial Domain / Application / Infrastructure split. The main `src/binance/broker-websocket/` implementation remains under `src/binance/`; Binance DTO/Entity adapters now live under `src/infrastructure/binance/adapters/`. Remaining Binance protocol modules will move only through focused, tested architecture slices.

```text
packages/brokers/src/
├── index.js
├── broker.core.js
├── broker.core.test.js
├── broker-core-missing-methods.test.js
├── domain/
│   ├── user-data-recovery-policy.js
│   └── user-data-recovery-policy.test.js
├── application/
│   ├── ports/
│   │   ├── user-data-client-port.js
│   │   └── user-data-client-port.test.js
│   ├── user-data-session.js
│   └── user-data-session.test.js
├── infrastructure/
│   └── binance/
│       ├── adapters/
│       │   ├── adapt-canonical-fill.js
│       │   ├── adapt-canonical-order.js
│       │   ├── adapt-fill.js
│       │   ├── adapt-order.js
│       │   ├── adapt-spot-asset.js
│       │   ├── adapt-spot-balance.js
│       │   ├── normalize-binance-id.js
│       │   └── *.test.js
│       ├── user-data-client-adapter.js
│       └── user-data-client-adapter.test.js
└── binance/
    ├── index.js
    └── broker-websocket/
        ├── index.js
        ├── broker.js
        ├── broker.*.test.js
        ├── broker.integration.js
        ├── config/
        ├── constants/
        ├── helpers/
        │   └── adapters/
        ├── tests/
        │   ├── user-data-session.setup.test.js
        │   ├── user-data-session.recovery.test.js
        │   ├── user-data-session.reconciliation.test.js
        │   ├── user-data-session.cleanup.test.js
        │   └── user-data-session.integration.js
        ├── test-helpers/
        ├── testnet-integration-guards.js
        └── utils/
            ├── rpc-client.js
            ├── runtime.js
            ├── signature.js
            ├── streams-client.js
            ├── streams-protocol.js
            └── transport.js
```

The lifecycle implementation and its direct unit tests live together in `src/application/user-data-session.js` and `src/application/user-data-session.test.js`; these tests exercise the injected client port without constructing a Binance broker. Broker-level setup/recovery/reconciliation/cleanup suites and the opt-in integration test live under `broker-websocket/tests/` because they exercise the concrete broker/application composition. Their shared deterministic fixtures remain under `broker-websocket/test-helpers/`.

## Ownership and conventions

- `src/domain/user-data-recovery-policy.js` owns the pure, exchange-neutral recovery-completion policy.
- `src/application/user-data-session.js` owns subscriber lifecycle, reconnect/recovery coordination, and reconciliation acknowledgement state.
- `src/application/ports/user-data-client-port.js` owns the exchange-neutral client capability required by the application session.
- `src/infrastructure/binance/user-data-client-adapter.js` implements that port and owns Binance RPC/event-envelope translation for user-data.
- `binance/broker-websocket/broker.js` is the public broker facade and current composition boundary. It coordinates the RPC/Streams clients and preserves public result/callback contracts. Keep simple RPC methods cohesive; extract only a demonstrated composition seam or a distinct stateful/application responsibility.
- `binance/broker-websocket/config/` owns validated runtime configuration; `BinanceWebSocketConfig` is Coinzilla-owned and does not depend on the removed Binance SDK.
- `binance/broker-websocket/constants/` owns fixed Binance endpoint values.
- `binance/broker-websocket/helpers/` owns Binance request construction and protocol-specific event/response adaptation.
- `binance/broker-websocket/utils/` owns low-level protocol/runtime infrastructure: RPC, Streams, transport, signing, and runtime guards.
- `src/infrastructure/binance/adapters/` maps Binance order/fill/account DTOs into shared Entities and normalizes Binance IDs. These are exchange-specific infrastructure mappings even though some outputs are canonical Entities.
- `broker-websocket/tests/` groups broker-operation contract tests; focused module tests remain colocated with their implementation.
- `broker-websocket/test-helpers/` contains test-only fakes shared by broker tests; it is not part of the package's public API.

The legacy REST broker, REST signing/query helpers, REST listen-key stream client, and historical-price REST script remain removed. The pure event adapters under `helpers/adapters/` are retained because the active WebSocket user-data session uses their data-mapping behavior; they do not restore the legacy transport or REST flow.

The package entry point currently exports exactly `BinanceWebSocketBroker`, `BinanceWebSocketConfig`, `CoreBroker`, and `normalizeBinanceId`. Current workspace consumers are:
- `apps/harvester`, which wraps `BinanceWebSocketBroker` in its own infrastructure adapter and implements Harvester's application-owned `BrokerPort`.
- `packages/market-simulator`, whose `HistoricalMarketBroker` extends `CoreBroker` and whose `SimulatedExecutionBroker` extends the historical broker.

`CoreBroker` is a live public extension point, not an unused internal base class or a formal application-owned port. `normalizeBinanceId` is used by the Harvester infrastructure adapter. Preserve all four root exports and their consumer contracts unless a separately reviewed compatibility change proves a migration safe. Do not reintroduce the removed third-party SDK.

## DDD responsibility map (current implementation and Phase 9 target boundaries)

The first DDD/TDD tranche established deterministic tests, selected ports, and focused Binance adapters. It did **not** complete the intended DDD architecture inside `@coinzilla/brokers`. Phase 9 in [the broker roadmap](../../packages/brokers/ROADMAP.md) tracks that package-scoped refactor.

**Scope:** `@coinzilla/brokers` owns the broker domain, broker application workflows, ports, and exchange infrastructure adapters. It does not own portfolio/position policy, trading strategies, or bot product behavior. Those concerns remain outside this package; this is not a reason to exclude broker-owned domain/application concepts from it.

### Current implementation (starting point, not target architecture)

| Current module | Current responsibility | Refactoring consideration |
|---|---|---|
| `src/index.js`, `binance/index.js`, `broker-websocket/index.js` | Public exports and module composition | Keep public API/composition thin while preserving compatibility |
| `src/broker.core.js` | Exported shared base class with default unimplemented methods and state maps; Market Simulator extends it | Preserve construction, inherited state, and unsupported-method behavior; any redesign requires a separate consumer migration |
| `binance/broker-websocket/broker.js` | Public facade and current composition boundary; simple RPC operations plus client/session wiring | Keep simple RPC methods cohesive; extract only a demonstrated composition seam or distinct cohesive responsibility |
| `src/domain/user-data-recovery-policy.js` | Pure exchange-neutral recovery-completion policy | Correctly placed in Domain; keep it free of infrastructure/application imports |
| `src/application/ports/user-data-client-port.js` | Application-owned user-data client capability contract and assertion | Correctly placed under Application Ports; implemented by Binance Infrastructure |
| `src/application/user-data-session.js` and `src/application/user-data-session.test.js` | Application subscriber lifecycle, reconnect/recovery coordination, reconciliation acknowledgement, and direct tests through an injected client port | Correctly placed in Application; keep direct tests independent of Binance and preserve state-machine cohesion |
| `src/infrastructure/binance/user-data-client-adapter.js` | Adapts Binance RPC/event details to the application-owned user-data port | Correctly placed in Infrastructure; keep Binance request/event vocabulary here |
| `binance/broker-websocket/helpers/` | Request parameter construction, event adaptation, deduplication | Determine which rules are broker-domain/application behavior versus Binance protocol translation |
| `src/infrastructure/binance/adapters/` | Maps Binance order/fill/account DTOs into shared Entities and normalizes Binance IDs | Correctly placed in Infrastructure; canonical shared entity invariants remain in `@coinzilla/entities` |
| `config/`, `constants/`, `utils/` | Binance configuration, endpoints, transport, RPC, Streams, signing, runtime guards | Infrastructure implementation; must not become dependencies of domain/application code |
| `test-helpers/`, colocated tests, `tests/` | Deterministic fakes, unit tests, broker contract tests | Separate domain/application tests from infrastructure/contract/integration tests as boundaries emerge |

### Phase 9 target architecture

Dependency direction:

`Infrastructure adapters → Application use cases → Broker domain`

Application/domain code depends on ports it owns; Binance infrastructure implements those ports. No inward dependency from domain/application to Binance wire formats, sockets, signing, or concrete clients.

- **Domain:** exchange-neutral broker capability concepts, value objects, invariants, domain errors, and policies that genuinely belong to broker behavior. Do not duplicate shared canonical entities or import Binance protocol details.
- **Application:** broker-owned use cases and orchestration for account, order, market-data, and user-data capabilities. Coordinate through explicit ports.
- **Application ports:** application-owned narrow interfaces for demonstrated external effects, currently the user-data client capability under `src/application/ports/`. Infrastructure implements them. Avoid generic abstractions without a concrete consumer.
- **Infrastructure:** Binance RPC/Streams protocol clients, transport, signing, endpoint configuration, DTOs, event/request/response mapping, and adapters implementing broker ports.
- **Composition/public API:** wire application services to infrastructure while preserving current public exports and consumer contracts.

Do not force a directory template. Add domain/application/ports/infrastructure modules only when they contain real package-owned responsibilities.

### TDD and test boundaries

Each refactoring slice follows RED → GREEN → REFACTOR → VERIFY:

1. Add a failing behavior or boundary test before implementation.
2. Implement the smallest change that passes.
3. Refactor without changing behavior.
4. Run focused tests, package tests, coverage, and relevant workspace consumer checks.
5. Update the architecture map and decision record to match actual code.

Required test responsibilities:
- Domain: deterministic and pure; no Binance clients, sockets, network, or credentials.
- Application: use-case tests with fake ports; cover success, invalid states, failures, retries, timeouts, and uncertain outcomes.
- Port/adapter contract: verify Binance infrastructure satisfies application-facing interfaces.
- Infrastructure: protocol framing, signing, DTO mapping, transport lifecycle, reconnect, cleanup, malformed responses.
- Public broker contract: exports, signatures, result envelopes, decimal strings, event/callback semantics, and order-safety gates.
- Integration: opt-in, TESTNET-only, and separate from default offline tests.

### Phase 9 completion criteria

Do not mark the architecture refactor complete until the package has implemented and documented dependency boundaries; domain/application code is independent of concrete Binance infrastructure; ports have contract-tested Binance adapters; important failure and lifecycle behavior has deterministic coverage; public contracts remain compatible or have an approved migration; and package tests/coverage pass on the exact merged PR head.

### Verified package coverage snapshot

On PR #516 commit `bf44e8e8d1e9444066a7ea595d518341e0a06fcc`, the CI-executed package command `pnpm --filter @coinzilla/brokers test:coverage` passed with **82.95% lines, 85.19% branches, and 80.37% functions**. The direct event-adapter characterization tests bring `helpers/adapters/user.js` to **100% line, branch, and function coverage**. The first pure-helper vertical slice extracts symbol-filter validation and book-ticker mapping from the broker facade; both helper modules are **100% covered**. The user-data client-port adapter is also **100% covered**. The package suite passed **339/339** tests on commit `7163587568190a4ed4f2b23f08c792e41dd8e1c2`. The RPC client reports **99.06% lines / 93.39% branches / 94.12% functions**; the Streams client reports **93.43% / 85.37% / 81.03%**. This is a measured baseline, not a claim that every protocol/recovery edge case is covered; RPC and Streams failure branches remain the next coverage targets.
### RPC and Streams failure-path characterization

The offline suite now explicitly exercises binary and malformed RPC frames, invalid request IDs/timeouts, listener exceptions, connection closure during setup, malformed success/error envelopes, malformed Streams acknowledgements, control-send failure cleanup, listener isolation, unsubscribe rejection semantics, server shutdown, transport cleanup exceptions, and raw event-to-stream matching. On commit `30b49c4008019c692bbd355698d35d6d3e0f37aa`, all **319/319** broker tests passed and the exact package coverage command passed. This coverage work adds no production behavior; remaining uncovered branches are limited to a few lifecycle/rollback paths and should be tested when the corresponding implementation slice is touched.

On PR #528 head `ba1fe560048fecd1d7d7aec83f071cf709c218da`, the broker package passed **344/344** tests and `pnpm --filter @coinzilla/brokers test:coverage` passed with **83.20% lines, 85.89% branches, and 80.55% functions**. `streams-client.js` measured **93.47% lines / 85.78% branches / 81.03% functions**. The Streams client now binds message and close callbacks to their originating transport and ignores callbacks from superseded transports, preventing late messages from being delivered to current listeners and late close events from tearing down the replacement connection. This is an internal lifecycle hardening change; public exports, method signatures, stream payloads, and subscription contracts are unchanged.

The user-data session's deterministic suite contains **42 offline tests** covering uncertain subscribe/unsubscribe outcomes, reconnect retry liveness, repeated reconciliation acknowledgement, blocked state-changing operations, stale events, listener rollback, and stale-subscription cleanup. On PR #528 head `ba1fe560048fecd1d7d7aec83f071cf709c218da`, `user-data-session.js` measured **99.37% lines / 90.45% branches / 100.00% functions**. Live user-data integration remains separate and is skipped unless `BINANCE_TESTNET_INTEGRATION=1` and non-placeholder TESTNET credentials are configured; the external-event case also requires explicit opt-in and TESTNET activity. The broker-level safety suite also verifies that `createOrder`, `createCanonicalOrder`, `cancelOrder`, and `cancelAllOpenOrders` issue no mutation RPC after `eventStreamTerminated`. Deterministic offline lifecycle/recovery coverage is complete for Phase 6; Phase 8 remains open for the separately gated TESTNET and long-running soak verification. Those live checks are not part of the default package suite.
### Market metadata adapter slice

`BinanceWebSocketBroker.getSymbolFilters()` now retains only public-input validation, the `exchangeInfo` RPC call, canonical-market caching, and the existing result envelope. The pure `helpers/adapters/symbol-filters.js` adapter owns Binance DTO lookup, required/optional decimal-filter validation, `NOTIONAL` preference with `MIN_NOTIONAL` fallback, and the existing market metadata shape. Its direct test suite reports **100% line, branch, and function coverage**. No public method signature or result shape changed.
### Canonical fill adapter slice

`BinanceWebSocketBroker.getFills()` retains its original RPC order (exchange metadata first, then signed `myTrades`). The pure `helpers/adapters/canonical-fills.js` adapter now owns exact symbol matching, base/quote asset normalization, canonical `Market` construction, trade-array validation, and canonical `Fill` mapping. Its direct tests report **100% line, branch, and function coverage**. The full broker suite also protects the separate user-data TRADE event path, which continues to use the shared `adaptCanonicalFill` adapter. No public method signature or result shape changed.
### Order-history adapter slice

The raw and canonical order-history paths now share a pure `helpers/adapters/order-history.js` boundary. The broker retains RPC orchestration and result envelopes; the adapter owns allOrders array validation, raw cursor-ID checks, unique symbol metadata lookup, canonical Market creation, and CanonicalOrder mapping. The raw and canonical paths intentionally retain their different validation semantics, and the empty canonical-history fast path still avoids an unnecessary metadata request. The helper reports **100% line, branch, and function coverage**.
### Order request parameter adapter slice

`createOrder()` and `createCanonicalOrder()` now share the pure `helpers/adapters/order-request-params.js` mapper for client-order-ID mapping, side/type defaults, and LIMIT_MAKER time-in-force omission. User-data readiness gates, canonical client-order-ID validation, and signed `stateChanging` RPC options remain in the broker facade. The new helper reports **100% line, branch, and function coverage**; existing broker contract tests continue to verify the signed/state-changing request options.
### Responsibility map

`@coinzilla/brokers` owns broker-specific, exchange-neutral capabilities and invariants, broker application workflows, ports, and exchange infrastructure adapters. The Binance broker facade currently composes exchange clients and enforces public contracts; the user-data session coordinates subscription/recovery effects; pure Binance DTO and request/response mapping lives in focused infrastructure adapters; native transport/RPC/Streams protocol lives in infrastructure utilities; canonical shared entities are created through shared adapters. Harvester retains portfolio/position policy, strategies, and bot application orchestration. Domain/application/ports/infrastructure modules are introduced only when they represent real package-owned responsibilities.

### Phase 9 implementation slice 1 — user-data recovery invariant

The first domain extraction is `src/domain/user-data-recovery-policy.js`. It owns the exchange-neutral completion rule: recovery may complete only when recovery is required, a user-data subscription is active, at least one current subscriber exists, and every current subscriber has explicitly acknowledged reconciliation. The Binance session maps its concrete subscription ID and subscriber state into this policy, then retains responsibility for timers, notifications, state mutation, and client-port effects.

The policy has isolated Node.js tests for the incomplete and complete states, including the all-subscriber requirement and strict boolean acknowledgements. This extraction does not change public APIs, event/status shapes, retry behavior, exchange request names, or order-safety gates.

### Phase 9 implementation slice 2 — normalized user-data client-port responses

The injected user-data client port owns unwrapping Binance RPC response envelopes for subscription setup and remote-state verification. Its application-facing contract returns a subscription ID (or `null` when absent), a list of subscription IDs (or `null` for malformed collection data), and no raw unsubscribe response envelope. The user-data session validates normalized IDs and no longer reads Binance's `response.data` shape.

The existing safety behavior remains unchanged: uncertain subscribe outcomes are verified through remote subscription state; malformed IDs and ambiguous multiple subscriptions fail closed; uncertain unsubscribe outcomes are verified before retry; no state-changing order request is replayed.

### Phase 9 implementation slice 3 — normalized user-data event port

The Binance user-data client-port adapter translates raw WebSocket event envelopes into neutral port messages. Normal events carry the subscription ID, canonical adapted event, and an opaque stable deduplication key; the Binance-specific event identity algorithm remains in infrastructure. The Binance `eventStreamTerminated` event becomes a neutral `terminated` notification with the source event time and raw event retained for existing consumer callback compatibility.

The session coordinator no longer imports Binance event adapters or Binance event identity helpers. It filters by the active subscription, handles the neutral termination notification, and retains a bounded set of opaque event identities across reconnects. The set is cleared on session stop or final-subscriber removal, preserving the previous duplicate-suppression lifetime and the 2,048-entry bound.

### Phase 9 implementation slice 4 — application session and explicit port

The user-data lifecycle coordinator now lives at `src/application/user-data-session.js` and depends on the exchange-neutral recovery policy plus the application-owned `UserDataClientPort` contract in `src/application/ports/user-data-client-port.js`. The Binance broker facade composes this application service with the Binance client adapter. Runtime validation at the application boundary rejects incomplete injected ports before subscription operations begin.

The package coverage command includes `src/application/**/*.js` (including application-owned ports) and excludes `*.test.js`, so the Application layer remains subject to the existing coverage thresholds.

### Phase 9 implementation slice 5 — Binance infrastructure adapter

The Binance implementation of `UserDataClientPort` now lives in `src/infrastructure/binance/user-data-client-adapter.js`. The broker facade composes this adapter with the application session; the adapter owns Binance request names, HMAC signing options, response-envelope normalization, canonical user-data event mapping, termination conversion, and exchange-specific event identity generation. Its deterministic tests live beside the infrastructure implementation.

The broker coverage command now includes `src/infrastructure/**/*.js` and excludes infrastructure test files, applying the same existing coverage thresholds to the adapter layer.
### Phase 9 implementation slice 6 — application-owned port location

The existing `UserDataClientPort` contract and its unchanged deterministic contract tests now live under `src/application/ports/`. The top-level `src/ports/` folder is removed. `UserDataSession` imports the contract within the Application layer, while the Binance infrastructure adapter references and implements it. This is an ownership/location clarification only; the port shape and runtime behavior are unchanged. PR #691 merged with package unit tests, the 90/80/80 Brokers coverage gate, workspace tests/coverage, Harvester targeted regression tests, syntax, and dependency audit passing.

### Phase 9 implementation slice 7 — Binance DTO/Entity adapters under Infrastructure

The Binance-specific adapters for canonical orders/fills, legacy orders/trades, spot assets/balances, and Binance ID normalization now live under `src/infrastructure/binance/adapters/`. Their deterministic mapper test cases/assertions move with them; relative imports are updated where needed. The broker facade, canonical fill/history helpers, and package root export are updated to import from the infrastructure location. The obsolete `src/binance/shared/` coverage include/exclude is removed because `src/infrastructure/**/*.js` now covers these modules. Public root exports, method signatures, result shapes, decimal handling, and mapping behavior are unchanged. PR #693 merged at `512b77f4a7745e2b5fbff7849dcfe136830acab8` with Brokers unit tests/coverage, workspace tests/coverage, Harvester targeted regression tests, syntax, and dependency audit passing.

### Phase 9 implementation slice 8 — separate Application unit tests from broker composition tests

The six tests that instantiate `UserDataSession` directly now live in `src/application/user-data-session.test.js` and use an inline fake `UserDataClientPort`; they do not import or construct Binance infrastructure. The broker-level setup/recovery/reconciliation/cleanup suites and opt-in integration test move from the legacy `methods/` folder to `broker-websocket/tests/`. The production session and its behavior are unchanged; existing test cases/assertions are preserved, and only test placement/imports are adjusted. Broker-specific fake clients and fixtures remain under `broker-websocket/test-helpers/`.

