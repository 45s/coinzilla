# Harvester multi-provider execution routing

**Status:** Route-table schema validation, mutation-protected route maps, provider required/optional policy, and canonical Broker capability enforcement are implemented in the Phase 6 branch. Production bootstrap wiring and integrated verification remain in progress; do not treat the feature as production-ready until the integrated tests and required CI checks pass.

## Ownership model

Harvester owns provider-instance configuration, strategy-to-account association, execution routing, market-data routing, account readiness, and runtime lifecycle. `@coinzilla/brokers` remains the sole owner of the structural Broker API and provider capability declarations.

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

Every enabled executable strategy/market must have one execution route and one market-data route. Every configured provider instance must own at least one execution route; data-only provider instances are explicitly unsupported in this runtime. Duplicate, missing, disabled-market, unsupported-strategy, unknown-provider, and environment-incompatible routes fail closed. A strategy/market cannot be routed to multiple accounts. Market-data and execution routing are not interchangeable.

## Account and provider failure policy

Provider identity is immutable and includes provider instance, provider type, account identity, and LIVE/TESTNET environment. All configured providers are required by default. An explicitly optional provider may fail startup without redirecting its execution markets; those markets remain unavailable. A required-provider failure rolls back every account that already started. If an active execution runtime depends on a failed provider for market data, startup fails closed rather than selecting another source.

No order is retried or redirected after an uncertain mutation outcome. A market-data source failure never changes the execution destination. UNKNOWN capability is not support for a safety-critical operation.

## Capability and Bitunix boundary

Before connecting a provider, Harvester verifies the canonical Broker capability declaration for every operation required by the account and its market-data routes. Only SUPPORTED satisfies a required capability; UNSUPPORTED and UNKNOWN block startup.

The production provider-factory map currently registers Binance only. Bitunix Spot is not a configured execution provider while issue #1185 remains open. The optional Bitunix observer is a separate read-only interface and must not be added to brokers.instances or executionRouting.

## Backward compatibility

When brokers.instances, executionRouting, and marketDataRouting are absent, the documented single-Binance environment configuration remains the compatibility path. Multi-provider mode requires explicit routing tables; there is no first-connected-broker fallback.

## Deferred boundaries

Process-restart restoration remains disabled under issue #654. Recovery Seller remains non-executable under #1127. This Phase 6 contract does not enable live or TESTNET order mutations during engineering verification; integrated tests use deterministic in-memory BrokerPort fakes.
