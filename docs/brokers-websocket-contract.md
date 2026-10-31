# Broker package: Binance WebSocket contract

## Source layout

The broker package is organized by exchange and responsibility. Tests live beside the source modules they exercise; shared test doubles are kept in a dedicated folder.

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
        *.test.js
        broker.integration.js
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
- Tests are colocated with their implementation: use `<module>.test.js` for unit/contract tests and `<module>.integration.js` for environment-dependent integration tests.
- `test-helpers/` contains test-only fakes shared by colocated tests. It is not part of the package's public API.

The legacy REST broker, REST signing/query helpers, REST listen-key stream client, and historical-price REST script remain removed. The pure event adapters under `helpers/adapters/` are retained because the active WebSocket user-data session uses their data-mapping behavior; they do not restore the legacy transport or REST flow.

The package entry point exports only `BinanceWebSocketBroker` and `BinanceWebSocketConfig`. Do not reintroduce the removed third-party SDK.
