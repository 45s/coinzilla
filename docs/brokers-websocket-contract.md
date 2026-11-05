# Broker package: Binance WebSocket contract

## Source layout

The broker package is organized by exchange and responsibility. Broker-operation contract tests are grouped under `broker-websocket/tests/`; focused unit tests for configuration, helpers, methods, and protocol utilities remain beside the modules they exercise. Shared test doubles live in a dedicated folder.

```text
packages/brokers/
  .env.example
  AGENTS.md
  ROADMAP.md
  package.json
  src/
    index.js
    broker.core.js
    broker.core.test.js
    broker-core-missing-methods.test.js
    binance/
      index.js
      shared/
        adapt-canonical-fill.js
        adapt-canonical-fill.test.js
        adapt-canonical-order.js
        adapt-canonical-order.test.js
        adapt-fill.js
        adapt-order.js
        adapt-order.test.js
        adapt-spot-asset.js
        adapt-spot-asset.test.js
        adapt-spot-asset-earn.test.js
        adapt-spot-asset-zero-balance.test.js
        adapt-spot-balance.js
        adapt-spot-balance.test.js
        index.js
        normalize-binance-id.js
      broker-websocket/
        index.js
        broker.js
        broker.test.js
        broker.*.test.js
        broker.integration.js
        testnet-integration-guards.js
        testnet-integration-guards.test.js
        tests/
          *.test.js
        config/
          binance-websocket-config.js
          binance-websocket-config.test.js
          config-null-url-fallback.test.js
        constants/
          websocket-endpoints.js
        helpers/
          history-query-params.js
          history-query-params.test.js
          public-stream-adapters.js
          public-stream-adapters.test.js
          user-data-event-deduplicator.js
          user-data-event-deduplicator.test.js
          adapters/
            adapt-msg.js
            adapt-trades.js
            user.js
        methods/
          user-data-session.js
          user-data-session.test.js
          user-data-session.integration.js
        utils/
          rpc-client.js
          rpc-client.test.js
          runtime.js
          signature.js
          signature.test.js
          streams-client.js
          streams-client.test.js
          streams-protocol.js
          streams-protocol.test.js
          transport.js
          transport.test.js
        test-helpers/
          fake-broker-clients.js
          fake-clock.js
          fake-clock.test.js
          fake-websocket.js
          fake-websocket.test.js
```

## Ownership and conventions

- `broker.js` is the broker facade and lifecycle/orchestration layer.
- `config/` owns validated runtime configuration. `BinanceWebSocketConfig` is Coinzilla-owned configuration; it is not a wrapper around or dependency on the removed Binance SDK.
- `constants/` owns fixed Binance endpoint values.
- `methods/` owns cohesive stateful broker services, such as user-data session recovery.
- `helpers/` owns focused data adaptation, request parameter construction, and event deduplication.
- `utils/` owns low-level protocol/runtime infrastructure: RPC, Streams, transport, signing, and runtime guards.
- `tests/` groups broker-operation contract tests so the broker root remains focused on its implementation and lifecycle tests.
- Focused module tests remain colocated with their implementation; use `<module>.test.js` for unit/contract tests and `<module>.integration.js` for environment-dependent integration tests.
- `test-helpers/` contains test-only fakes shared by broker tests. It is not part of the package's public API.

The legacy REST broker, REST signing/query helpers, REST listen-key stream client, and historical-price REST script remain removed. The pure event adapters under `helpers/adapters/` are retained because the active WebSocket user-data session uses their data-mapping behavior; they do not restore the legacy transport or REST flow.

The package entry point currently exports `BinanceWebSocketBroker`, `BinanceWebSocketConfig`, `CoreBroker`, and `normalizeBinanceId`. `CoreBroker` is an exported compatibility base class, not a formal application-owned port; `normalizeBinanceId` is used by the Harvester infrastructure adapter. The concrete broker and config are consumed by Bot and Harvester infrastructure adapters. Preserve these exports unless a separately reviewed compatibility change proves they are unused. Do not reintroduce the removed third-party SDK.

## DDD responsibility map (current implementation and Phase 9 target boundaries)

The first DDD/TDD tranche established deterministic tests, selected ports, and focused Binance adapters. It did **not** complete the intended DDD architecture inside `@coinzilla/brokers`. Phase 9 in [the broker roadmap](../../packages/brokers/ROADMAP.md) tracks that package-scoped refactor.

**Scope:** `@coinzilla/brokers` owns the broker domain, broker application workflows, ports, and exchange infrastructure adapters. It does not own portfolio/position policy, trading strategies, or bot product behavior. Those concerns remain outside this package; this is not a reason to exclude broker-owned domain/application concepts from it.

### Current implementation (starting point, not target architecture)

| Current module | Current responsibility | Refactoring consideration |
|---|---|---|
| `src/index.js`, `binance/index.js`, `broker-websocket/index.js` | Public exports and module composition | Keep public API/composition thin while preserving compatibility |
| `src/broker.core.js` | Exported compatibility base class with default unimplemented methods | Assess whether it should remain a compatibility contract or evolve into an explicit broker port; do not break consumers casually |
| `binance/broker-websocket/broker.js` | Implements broker operations, coordinates RPC/Streams clients and user-data lifecycle, maps Binance responses | Currently mixes facade, application coordination, and infrastructure concerns; split by cohesive vertical slices |
| `binance/broker-websocket/methods/user-data-session.js` | Subscriber state, reconnect scheduling, remote subscription lifecycle, reconciliation acknowledgement | Preserve state-machine cohesion while separating broker workflow policy from Binance RPC vocabulary |
| `binance/broker-websocket/helpers/` | Request parameter construction, event adaptation, deduplication | Determine which rules are broker-domain/application behavior versus Binance protocol translation |
| `binance/shared/` | Maps Binance order/fill/account DTOs into shared Entities and normalizes Binance IDs | Infrastructure anti-corruption mapping; canonical shared entity invariants remain in `@coinzilla/entities` |
| `config/`, `constants/`, `utils/` | Binance configuration, endpoints, transport, RPC, Streams, signing, runtime guards | Infrastructure implementation; must not become dependencies of domain/application code |
| `test-helpers/`, colocated tests, `tests/` | Deterministic fakes, unit tests, broker contract tests | Separate domain/application tests from infrastructure/contract/integration tests as boundaries emerge |

### Phase 9 target architecture

Dependency direction:

`Infrastructure adapters → Application use cases → Broker domain`

Application/domain code depends on ports it owns; Binance infrastructure implements those ports. No inward dependency from domain/application to Binance wire formats, sockets, signing, or concrete clients.

- **Domain:** exchange-neutral broker capability concepts, value objects, invariants, domain errors, and policies that genuinely belong to broker behavior. Do not duplicate shared canonical entities or import Binance protocol details.
- **Application:** broker-owned use cases and orchestration for account, order, market-data, and user-data capabilities. Coordinate through explicit ports.
- **Ports:** narrow interfaces for RPC capabilities, streams, user-data session behavior, clocks/schedulers, and external effects as required by actual use cases. Avoid generic abstractions without a concrete consumer.
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
