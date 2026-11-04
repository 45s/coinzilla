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

The package entry point exports only `BinanceWebSocketBroker` and `BinanceWebSocketConfig`. Do not reintroduce the removed third-party SDK.

## DDD responsibility map (current implementation and target boundaries)

This package is an **exchange infrastructure adapter**, not the owner of trading strategy or portfolio policy. Align it with Harvester's domain/application/infrastructure separation without copying Harvester's directory tree mechanically.

### Current responsibilities

| Current module | Actual responsibility | DDD interpretation |
|---|---|---|
| `src/index.js`, `binance/index.js`, `broker-websocket/index.js` | Public exports and module composition | Interface/composition boundary; keep thin |
| `src/broker.core.js` | Shared broker base contract | Broker port/contract boundary |
| `binance/broker-websocket/broker.js` | Implements broker operations, coordinates RPC/Streams clients and user-data lifecycle, maps Binance responses to shared Entities | Binance infrastructure adapter; currently also contains orchestration and several pure validation/mapping functions |
| `binance/broker-websocket/methods/user-data-session.js` | Owns subscriber state, reconnect scheduling, remote subscription lifecycle, and reconciliation acknowledgement | Stateful application-style lifecycle coordinator; currently coupled to Binance RPC method names and client shape |
| `binance/broker-websocket/helpers/` | Builds exchange request parameters, adapts Binance stream/event payloads, and deduplicates events | Anti-corruption/adaptation layer; pure helpers where possible, not trading-domain policy |
| `binance/shared/` | Maps Binance order/fill/account DTOs into shared `@coinzilla/entities` values and normalizes Binance IDs | Infrastructure translation; canonical entity invariants remain owned by Entities |
| `config/`, `constants/` | Validates Binance connection configuration and owns endpoint constants | Infrastructure configuration |
| `utils/` | Native WebSocket transport, RPC, Streams protocol/client, signing, and Node runtime guard | Infrastructure protocol implementation |
| `test-helpers/`, colocated tests, `tests/` | Deterministic fakes, unit tests, and broker contract tests | Test infrastructure; never public runtime API |

### Target boundary rules

1. **Domain:** do not add trading strategies, portfolio rules, order-selection policies, or a duplicate domain model here. Harvester owns those policies; `@coinzilla/entities` owns canonical shared values and entity invariants.
2. **Application:** keep only coordination that expresses a broker capability lifecycle or workflow. The user-data recovery coordinator is stateful and belongs here conceptually, but its Binance RPC vocabulary should ultimately be hidden behind a narrow injected port if a tested vertical slice demonstrates that this reduces coupling.
3. **Infrastructure:** keep Binance request names, signing, response envelopes, stream names, reconnect protocol, event DTOs, and Binance-to-Entities mapping here. These are not domain rules, even when implemented as pure functions.
4. **Ports:** treat `CoreBroker` and the public broker method contract as the consumer-facing boundary. Add narrower internal ports only when they isolate a concrete orchestration responsibility; do not create generic exchange abstractions speculatively.
5. **Composition:** the package entry point remains a thin export boundary. Do not create empty `domain/`, `application/`, or `infrastructure/` directories just to resemble Harvester.

### First refactoring candidates (ordered by risk)

- [x] **Candidate A — pure broker helpers:** extracted decimal-filter validators and book-ticker payload adaptation from `broker-websocket/broker.js` into `helpers/symbol-filter-adapters.js` and `helpers/adapt-book-ticker.js`. Focused tests preserve exact decimal strings, zero-optional-filter semantics, event validation, immutable output, and injected timestamp semantics.
- [x] **Candidate B — user-data port:** introduced an injected user-data client port. `BinanceUserDataSession` no longer calls raw RPC `request()` or registers raw client listeners; `createBinanceUserDataClientPort` owns Binance RPC names, subscribe signing options, and listener/connection forwarding. Existing uncertain-outcome verification and all-subscriber acknowledgement behavior remain in the coordinator and are covered by the offline regression suite.
- **Candidate C — broker operation slices:** separate cohesive request/response adaptation from the facade one operation family at a time (account, orders, market metadata, trades), retaining the public result envelopes and method signatures.

Do not start Candidate B or C until the relevant contract tests are green and the branch can execute the RED → GREEN → REFACTOR sequence. A structural move without a failing-first test is not evidence of behavior preservation.

### Verified package coverage snapshot

On PR #516 commit `bf44e8e8d1e9444066a7ea595d518341e0a06fcc`, the CI-executed package command `pnpm --filter @coinzilla/brokers test:coverage` passed with **82.95% lines, 85.19% branches, and 80.37% functions**. The direct event-adapter characterization tests bring `helpers/adapters/user.js` to **100% line, branch, and function coverage**. The first pure-helper vertical slice extracts symbol-filter validation and book-ticker mapping from the broker facade; both helper modules are **100% covered**. The user-data client-port adapter is also **100% covered**. The package suite passed **335/335** tests on commit `02e45cb4414722441e3695b193d4a7f4f204d308`. The RPC client reports **99.06% lines / 93.39% branches / 94.12% functions**; the Streams client reports **93.43% / 85.37% / 81.03%**. This is a measured baseline, not a claim that every protocol/recovery edge case is covered; RPC and Streams failure branches remain the next coverage targets.
### RPC and Streams failure-path characterization

The offline suite now explicitly exercises binary and malformed RPC frames, invalid request IDs/timeouts, listener exceptions, connection closure during setup, malformed success/error envelopes, malformed Streams acknowledgements, control-send failure cleanup, listener isolation, unsubscribe rejection semantics, server shutdown, transport cleanup exceptions, and raw event-to-stream matching. On commit `30b49c4008019c692bbd355698d35d6d3e0f37aa`, all **319/319** broker tests passed and the exact package coverage command passed. This coverage work adds no production behavior; remaining uncovered branches are limited to a few lifecycle/rollback paths and should be tested when the corresponding implementation slice is touched.
### Market metadata adapter slice

`BinanceWebSocketBroker.getSymbolFilters()` now retains only public-input validation, the `exchangeInfo` RPC call, canonical-market caching, and the existing result envelope. The pure `helpers/adapters/symbol-filters.js` adapter owns Binance DTO lookup, required/optional decimal-filter validation, `NOTIONAL` preference with `MIN_NOTIONAL` fallback, and the existing market metadata shape. Its direct test suite reports **100% line, branch, and function coverage**. No public method signature or result shape changed.
### Canonical fill adapter slice

`BinanceWebSocketBroker.getFills()` retains its original RPC order (exchange metadata first, then signed `myTrades`). The pure `helpers/adapters/canonical-fills.js` adapter now owns exact symbol matching, base/quote asset normalization, canonical `Market` construction, trade-array validation, and canonical `Fill` mapping. Its direct tests report **100% line, branch, and function coverage**. The full broker suite also protects the separate user-data TRADE event path, which continues to use the shared `adaptCanonicalFill` adapter. No public method signature or result shape changed.
### Order-history adapter slice

The raw and canonical order-history paths now share a pure `helpers/adapters/order-history.js` boundary. The broker retains RPC orchestration and result envelopes; the adapter owns allOrders array validation, raw cursor-ID checks, unique symbol metadata lookup, canonical Market creation, and CanonicalOrder mapping. The raw and canonical paths intentionally retain their different validation semantics, and the empty canonical-history fast path still avoids an unnecessary metadata request. The helper reports **100% line, branch, and function coverage**.

