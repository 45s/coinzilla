# Harvester multi-provider execution routing

**Status:** Complete and merged in [PR #1455](https://github.com/45s/coinzilla/pull/1455), merge commit `fdc951468648efa1fa17c93dd8c3f6ea78a23d84`. The exact feature head `11d084dfafeefaad880a54f1ae9bd7de6ff43df8` passed required workspace tests and coverage, Harvester targeted tests, full/strict ESLint, syntax, actionlint, repository policy, maintained Markdown/anchor, dependency audit, Utils tests and External Documentation Links. Execution routes are explicit per `(strategyId, symbol)` and independent from market-data source routes; orders remain pinned to their originating provider/account. The production adapter-factory map still registers Binance only, so this completed routing foundation does not enable Bitunix or another exchange. No live or TESTNET exchange operations were performed.

## Ownership model

Harvester owns provider-instance configuration, strategy-to-account association, execution routing, market-data routing, account readiness, and runtime lifecycle. `@coinzilla/brokers` owns the structural Broker API and provider-specific capability evidence; all providers use the single shared `BrokerCapabilities` value contract from `@coinzilla/entities`.

Each configured provider instance represents one immutable provider/account/environment identity. A separate Harvester runtime owns that account's Portfolio, OrderRegistry, balances, market metadata, user-data stream, strategy engine, and shutdown lifecycle. The runtime receives only the strategy markets explicitly assigned to its execution provider.

## Independent routing tables

```js
executionRouting: {
  routes: [
    { strategyId: "CG_coinGrabber", symbol: "BTCUSDT", providerInstanceId: "binance-testnet-secondary" },
    { strategyId: "CG_coinGrabber", symbol: "ETHUSDT", providerInstanceId: "binance-testnet-primary" },
  ],
}
```

```js
marketDataRouting: {
  routes: [
    { symbol: "BTCUSDT", providerInstanceId: "binance-testnet-primary" },
    { symbol: "ETHUSDT", providerInstanceId: "binance-testnet-secondary" },
  ],
}
```

The example deliberately routes BTC execution to the secondary account while sourcing its market data from the primary account, and routes ETH execution to the primary account while sourcing its market data from the secondary account.

A single execution account may own multiple symbols whose market-data sources differ. The per-symbol `marketDataProviderIdentities` map is authoritative; the legacy singular `marketDataProviderInstanceId` is populated only when all assigned symbols share one source and is `null` for mixed-source accounts. A `null` singular value is not permission to fall back to the execution provider.

Every enabled executable strategy/market must have one execution route and one market-data route. Every configured provider instance must own at least one execution route; data-only provider instances are explicitly unsupported in this runtime. Duplicate, missing, disabled-market, unsupported-strategy, unknown-provider, and environment-incompatible routes fail closed. A strategy/market cannot be routed to multiple accounts. Market-data and execution routing are not interchangeable.

## Strategy route identity at the runtime boundary

Execution routing is defined per `(strategyId, symbol)`. The provider's market-data subscription list is a separate, deduplicated set of symbols and must not replace the strategy route records. When multiple strategies share a market, the runtime startup contract must retain both strategy identities even though the provider subscribes to that symbol once. The runtime integration tracked by [#1475](https://github.com/45s/coinzilla/issues/1475) must preserve these records through provider startup before strategy dispatch is enabled. Until that integration and offline lifecycle proof are complete, RS remains non-executable.

## Strategy route identity at provider startup

The provider-account startup input carries the immutable `executionRoutes` array separately from the deduplicated `executionSymbols` list. The same-market regression verifies that CG and RS both reach the provider boundary while only one market subscription is requested. The subsequent shared-engine work tracked by [#1475](https://github.com/45s/coinzilla/issues/1475) must consume these records before strategy dispatch is enabled. Until that integration and offline lifecycle proof are complete, RS remains non-executable.

## Strategy route identity through runtime metadata

Provider startup receives and returns the immutable strategy-owned `executionRoutes` separately from deduplicated `executionSymbols`. Multi-account runtime metadata preserves each provider's route assignments as well. This metadata is the input contract for the next Harvester bootstrap/strategy-dispatch integration; it does not by itself enable RS execution.

## Account and provider failure policy

Provider identity is immutable and includes provider instance, provider type, account identity, and LIVE/TESTNET environment. All configured providers are required by default. An explicitly optional provider may fail account connection or its deferred market-data startup without terminating unrelated healthy accounts; its execution route is marked unavailable and no other provider is substituted. Partial subscriptions are stopped; if cleanup is unconfirmed, the account lock remains held for safe retry/shutdown. A required-provider failure rolls back every account that already started. If a route depends on an unavailable market-data source, it fails closed rather than selecting another source.

No order is retried or redirected after an uncertain mutation outcome. A market-data source failure never changes the execution destination. UNKNOWN capability is not support for a safety-critical operation.

## Capability and Bitunix boundary

Before connecting a provider, Harvester verifies the canonical Broker capability declaration for every operation required by the account and its market-data routes. Only SUPPORTED satisfies a required capability; UNSUPPORTED and UNKNOWN block startup.

The production provider-factory map currently registers Binance only. Bitunix Spot is not a configured Harvester provider while issue #1185 remains open. Do not introduce a partial observer-only runtime or route Bitunix around the standard provider contract. Once #1185 is resolved, Bitunix must enter through the complete provider-instance, BrokerPort, capability, account-lifecycle, and routing integration.

## Backward compatibility

When brokers.instances, executionRouting, and marketDataRouting are absent, the documented single-Binance environment configuration remains the compatibility path. Multi-provider mode requires explicit routing tables; there is no first-connected-broker fallback.

## Deferred boundaries

Process-restart restoration remains disabled under issue #654. Recovery Seller remains non-executable while RS-4/RS-5 are incomplete; implementation is tracked in [issue #1475](https://github.com/45s/coinzilla/issues/1475). This Phase 6 contract does not enable live or TESTNET order mutations during engineering verification; integrated tests use deterministic in-memory BrokerPort fakes.

## Recovery Seller account routes

Provider routing preserves the `{ strategyId, symbol }` owner while market and user-data subscriptions are deduplicated by symbol. A provider account with CG routes may also receive explicitly configured RS routes; the effective runtime keeps CG and RS pair maps separate and builds a union market map for canonical exchange metadata and subscriptions.

RS routes are rejected unless `strategies.RS_recoverySeller.enabled` is true and every routed market is enabled for the selected `TRADING_MODE`. RS markets require an explicit positive per-market `investment` budget and an operator-declared legacy `invested` basis, original `quantity`, and per-cycle `sellQuantity`. An RS-only provider account remains rejected until the shared engine can be composed without a CG route.

At startup, canonical exchange metadata is loaded before the RS legacy basis is initialized in the provider-account state. The RS pair is validated against its own order quantity, investment, precision, and order-type requirements even when CG owns the same market. The declared legacy quantity is not treated as available inventory: the account snapshot and shared reservation accounting must independently prove unreserved Spot custody before an RS SELL can be authorized. RS remains disabled by default.
