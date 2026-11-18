# Provider-instance identity, construction and account runtime

## Scope

The Harvester composition boundary resolves either the legacy single-Binance environment or an explicit `brokers.instances` list into stable provider-instance/account identities. Each configured account receives its own BrokerPort connection and independent Harvester runtime. The application-owned provider registry remains provider-neutral; this Phase 4 integration does not introduce execution or market-data route tables.

## Binance identity

The Binance identity resolver runs before the adapter factory constructs a client. It returns three separate, non-secret values:

- `providerType`: always `binance` in this runtime.
- `providerInstanceId`: a stable configured connection identity. The compatibility defaults are `binanceTestnet` and `binanceLive`, selected only from validated `TRADING_MODE`.
- `accountId`: a stable operator-owned account alias. The compatibility default is `binance-primary`.

Optional environment overrides are:

- `BINANCE_PROVIDER_INSTANCE_ID`
- `BINANCE_ACCOUNT_ID`

Both values must be non-empty identifier tokens (letters, digits, dot, underscore, colon or hyphen; maximum 128 characters). They are labels, never API credentials. Keep credentials only in `BINANCE_API_KEY` and `BINANCE_API_SECRET_KEY`. Identity validation errors report the invalid field without echoing its value, and identity labels are not written to logs.

Endpoint selection remains governed exclusively by explicit `TRADING_MODE=testnet|live` under [ADR-0002](../../../../docs/architecture/decisions/ADR-0002-explicit-binance-trading-environment.md). `NODE_ENV` does not select the Binance endpoint.

## Registry contract

`createProviderRegistry({ providers })` is owned by Harvester's application layer and depends only on Harvester's BrokerPort and the existing versioned capability declaration.

Each entry supplies:

- `providerInstanceId`, `providerType`, `accountId`, and `environment`;
- a BrokerPort implementation; and
- its deeply immutable provider declaration, built with the canonical `BrokerCapabilities` value from `@coinzilla/entities` and populated with evidence by the Brokers provider implementation (first delivered for Binance in [PR #1366](https://github.com/45s/coinzilla/pull/1366)).

Registration fails closed for an empty registry, duplicate or malformed identities, an invalid BrokerPort, a missing/unsupported capability declaration, a provider-type mismatch, or a missing/mismatched selected environment. Registry lookup requires the exact `providerInstanceId`; there is no implicit default, fallback, or provider selection by brand. The metadata listing is immutable and does not expose broker objects.

The registry owns connection lifecycle:

- `connect(id)` and `disconnect(id)` operate on one explicitly named instance.
- `connectAll()` connects entries in registration order. If a connection fails, it attempts cleanup for every constructed entry in reverse order, including the failing and not-yet-connected entries.
- `disconnectAll()` attempts every disconnect in reverse order and aggregates cleanup failures.
- Concurrent connection/disconnection requests for one instance share the in-flight operation. Successful disconnect is idempotent; failed cleanup remains visible and can be retried.

Errors preserve the original connection/cleanup causes. Credentials are never part of registry identity or diagnostic context.

## Current bootstrap boundary

The runtime supports two configuration paths:

- **Compatibility path:** when `brokers.instances` is absent, the existing `TRADING_MODE`, `BINANCE_API_KEY`, `BINANCE_API_SECRET_KEY`, `BINANCE_PROVIDER_INSTANCE_ID` and `BINANCE_ACCOUNT_ID` settings construct the same single Binance account as before.
- **Configured path:** `brokers.instances` contains one or more explicit provider accounts. Each entry declares `providerInstanceId`, `providerType`, `accountId`, `environment` (`testnet` or `live`) and credential environment-variable names. Secret values stay in the process environment and are captured only by the adapter factory closure. Each account's child runtime receives only the credential environment variables referenced by that account; references belonging to other configured accounts are removed before startup.

Example application configuration:

```js
brokers: {
  instances: [
    {
      providerInstanceId: "binanceTestnetPrimary",
      providerType: "binance",
      accountId: "binance-primary",
      environment: "testnet",
      credentials: {
        apiKeyEnv: "BINANCE_API_KEY",
        apiSecretEnv: "BINANCE_API_SECRET_KEY",
      },
    },
    {
      providerInstanceId: "binanceTestnetSecondary",
      providerType: "binance",
      accountId: "binance-secondary",
      environment: "testnet",
      credentials: {
        apiKeyEnv: "BINANCE_SECONDARY_API_KEY",
        apiSecretEnv: "BINANCE_SECONDARY_API_SECRET",
      },
    },
  ],
}
```

The default production adapter-factory map currently registers Binance only. A configured provider type without a registered adapter factory fails before connection. The factory map is injectable for deterministic tests and for future provider adapters; this does not make Bitunix execution available.

Each configured account is started through a separate invocation of the existing Harvester bootstrap. That gives it its own BrokerPort, Portfolio, OrderRegistry, account snapshot/balances, market metadata, user-data state/readiness, market subscriptions, strategy engine and shutdown lifecycle. Every account receives the current Conservative strategy configuration filtered by its own environment; no strategy/symbol execution route table or independent market-data route table exists yet.

The first configured account owns the process-wide Telegram Command Center and optional Operational State Store callbacks. Secondary accounts do not create duplicate Telegram command handlers. A startup failure is isolated to that account: its process lock is released when cleanup is confirmed, and already-started or later accounts continue. If failed-account lock cleanup is uncertain, the failure is exposed in `runtime.failedAccounts` and the lock remains owned until confirmed shutdown cleanup.

Bitunix is not registered here until the complete broker and lifecycle acceptance in [#1185](https://github.com/45s/coinzilla/issues/1185) is complete. The interim observer runtime from #1422 has been removed; future integration must use the complete provider contract in [ADR-0004](../../../../docs/architecture/decisions/ADR-0004-complete-bitunix-provider-integration.md).

The registry can represent multiple named instances of the same or different provider types when an adapter factory is registered. Phase 4 uses explicit account descriptors and separate runtime instances; it does not turn the registry into a route selector. Explicitly out of scope are:

- strategy/symbol execution-route tables (Phase 6);
- independent market-data routing (Phase 5);
- automatic selection, fallback, failover or cross-provider retry;
- cross-account balance aggregation; and
- process-restart recovery or restoration.

Phase 5 and Phase 6 are implemented in [PR #1455](https://github.com/45s/coinzilla/pull/1455), pending exact-head CI and merge. The default production adapter map is Binance-only; Bitunix remains outside the registry until #1185 is complete.

## Verification

Deterministic offline tests cover provider configuration validation, legacy single-Binance compatibility, multiple same-provider accounts, provider-type factory selection, independent account runtime state, account-specific process locks, startup failure isolation and shutdown. The integration tests use in-memory BrokerPort fakes; they do not require credentials or connect to Binance TESTNET/LIVE.

## Phase 3 — durable order provenance

**Delivery status:** complete in merged [PR #1416](https://github.com/45s/coinzilla/pull/1416), merge commit `543753da5938eba2d95ad19d74c3f98a991e6461`. The runtime remains single-Binance and unrouted; this phase adds immutable order/fill provenance, not multi-provider execution.

New Harvester orders now carry the selected registry entry's immutable `providerInstanceId`, `providerType`, and `accountId` from the broker facade into the local PENDING `CanonicalOrder`. The complete triple is validated as stable non-secret identifier tokens; partial identity is rejected. The selected facade exposes identity from the exact registry entry returned by `connectBroker`; no route is inferred from `NODE_ENV`, provider brand, or a fallback default.

The durable order submission intent stores all three values and must be confirmed committed before `placeOrder()` is invoked. The same identity is required on the durable submission outcome and on cancellation intent/outcome facts. Broker acknowledgements are rehydrated with the pending order's provider identity before the outcome is committed, and registry transitions preserve it while rejecting any attempted identity mutation.

For user-data and historical execution fills, Harvester correlates the fill to the already-owned canonical order, attaches that order's provider/account identity to the immutable Fill, and commits it with the execution fact. A fill whose registered order has no provider provenance or whose supplied provenance conflicts is rejected as an ownership-integrity failure; it is not assigned to the currently configured provider by guesswork. Cancellation of an order lacking provider identity likewise fails closed.

Operational State and Journal projections carry the identity across submission, cancellation, fill and replay. The strict v1 fact validators accept the complete identity triple on new records, reject partial/malformed triples, and continue to read historical v1 records with no provenance. Existing append-only fact bytes and digest chains are not rewritten. A legacy order with no recorded identity remains readable for audit, but it is not safe to submit/cancel/reconcile as an owned order until an explicit, separately audited migration establishes provenance; this slice does not fabricate it.

This phase does not add multi-provider routing, a second exchange instance, account aggregation, automatic fallback/failover, or process-restart restoration. The runtime remains on its current explicitly configured Binance instance. The existing restart-recovery release gates in #654 remain separate and out of scope.

## Offline verification scope

Regression coverage exercises CanonicalOrder/Fill immutability, provider metadata propagation from the BrokerPort facade, intent-before-broker ordering, acknowledgement preservation, registry mutation rejection, strict durable-fact validation, and legacy fact compatibility. Tests use deterministic in-memory fakes and temporary local stores; no credentials, Binance API calls, or live/TESTNET order actions are needed.

## Phase 4 — basic in-process account isolation

**Status:** complete. Account registry and account-scoped lock foundation merged in [PR #1440](https://github.com/45s/coinzilla/pull/1440); production bootstrap integration merged in [PR #1445](https://github.com/45s/coinzilla/pull/1445).

PR #1445 wires optional `brokers.instances` into the production entrypoint. Each configured entry resolves a provider-instance/account/environment identity, a provider-type adapter factory and credential environment-variable references. The legacy single-Binance environment configuration remains the compatibility path when `brokers.instances` is absent.

Each configured account starts a separate Harvester runtime with its own BrokerPort connection, Portfolio, OrderRegistry, account snapshot/balances, market metadata, user-data readiness, strategy engine, market subscriptions and shutdown lifecycle. Only the account's referenced API key/secret environment variables are passed into that account's runtime; references for other configured accounts are removed before startup. The first configured account owns the process-wide Telegram Command Center and optional Operational State Store callbacks.

Process locks are scoped by provider type + account alias + environment, not by provider-instance alias. Same-account aliases remain mutually exclusive. A provider startup failure is isolated to that account: when Harvester confirms its startup cleanup, its lock is released immediately; if cleanup is uncertain, the failure and `lockRetained` state are exposed in `runtime.failedAccounts` and the lock remains held while other accounts continue. Global shutdown releases retained account locks only after all started runtimes stop and Journal shutdown is confirmed. If runtime or Journal shutdown is not confirmed, the process lock remains held.

The default production adapter-factory map currently registers Binance only. Multiple configured Binance accounts are supported. Different provider types require a real registered production adapter; the synthetic provider used by offline tests does not enable Bitunix execution. Bitunix remains outside the provider registry until [#1185](https://github.com/45s/coinzilla/issues/1185) is resolved; do not add a temporary partial facade.

**Deterministic offline verification** covers legacy single-Binance compatibility, multiple accounts using the same provider, provider-type factory selection, account-specific credential isolation, independent account runtime state, account-scoped process locks, confirmed/unconfirmed startup cleanup, partial startup failure, shutdown and lock-release behavior. Tests use in-memory BrokerPort fakes and do not require exchange credentials or network access.

**Explicitly out of scope:**

- Bitunix execution before the complete broker and account-lifecycle acceptance in [#1185](https://github.com/45s/coinzilla/issues/1185); no temporary observer or partial provider facade.
- Automatic provider selection, implicit defaults, fallback, failover or cross-provider retry.
- Cross-account balance aggregation or shared Portfolio/OrderRegistry state.
- Process-restart recovery, restoration, Journal replay, historical reconstruction, crash recovery or unattended restart mechanisms.
- ADR-0001 / issue #654 implementation or release gates. **#654 remains LOWEST PRIORITY** and is not a Phase 4 dependency.

## Phase 6 execution-routing contract

**Status:** implementation and offline integration coverage are present in [PR #1455](https://github.com/45s/coinzilla/pull/1455); exact-head CI and merge remain the release gates.

Each enabled `(strategyId, symbol)` resolves to exactly one configured execution provider instance. Each execution runtime contains only its assigned markets. Market-data source selection is independent and may resolve to a different configured provider instance. Missing, duplicate, disabled-market, unknown-provider and environment-incompatible routes fail closed; there is no implicit default, fallback, failover or cross-provider retry.

Production bootstrap resolves provider/account identities and routing before startup, establishes provider connections, and only then starts cross-provider market-data subscriptions. The execution runtime retains its own BrokerPort for snapshots, order submission, user-data, cancellation, fills and reconciliation while the selected market-data BrokerPort supplies prices and candles.

Offline production-bootstrap integration coverage proves order submission through the configured execution account, user-data fill application only to that account's Portfolio, cancellation through the same account's BrokerPort, and candle/price data from the independently configured market-data provider. The legacy single-Binance path remains covered.
