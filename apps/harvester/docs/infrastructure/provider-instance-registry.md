# Binance provider-instance identity and registry

## Scope

The Harvester composition boundary now resolves the legacy single-Binance configuration into an explicit provider-instance identity and registers its BrokerPort in an exchange-neutral application registry. This is the identity/lifecycle foundation for [issue #1339](https://github.com/45s/coinzilla/issues/1339); it does not introduce provider routing.

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
- its deeply immutable version-1 capability declaration from [Brokers capability contract #1366](https://github.com/45s/coinzilla/pull/1366).

Registration fails closed for an empty registry, duplicate or malformed identities, an invalid BrokerPort, a missing/unsupported capability declaration, a provider-type mismatch, or a declared environment mismatch. Registry lookup requires the exact `providerInstanceId`; there is no implicit default, fallback, or provider selection by brand. The metadata listing is immutable and does not expose broker objects.

The registry owns connection lifecycle:

- `connect(id)` and `disconnect(id)` operate on one explicitly named instance.
- `connectAll()` connects entries in registration order. If a connection fails, it attempts cleanup for every constructed entry in reverse order, including the failing and not-yet-connected entries.
- `disconnectAll()` attempts every disconnect in reverse order and aggregates cleanup failures.
- Concurrent connection/disconnection requests for one instance share the in-flight operation. Successful disconnect is idempotent; failed cleanup remains visible and can be retried.

Errors preserve the original connection/cleanup causes. Credentials are never part of registry identity or diagnostic context.

## Current bootstrap boundary

The existing runtime still constructs and registers exactly one Binance instance from the legacy `TRADING_MODE` and Binance credentials. The registered BrokerPort facade is passed to the existing Harvester services; trading strategy, order semantics, market-data subscriptions, and shutdown ownership are unchanged.

The registry can represent multiple named instances of the same provider type, but this slice does not add multi-instance runtime configuration or routing. Explicitly out of scope are:

- strategy/symbol execution-route tables;
- independent market-data routing;
- automatic selection, fallback, or failover;
- order/fill provider provenance or account-scoped persistence;
- account isolation or account-scoped process locks; and
- process-restart recovery or restoration.

Those are separate decisions and delivery slices under #1339 and the existing ADRs. No exchange requests are made by the registry tests.

## Verification

The registry, identity resolver, adapter capability forwarding, and Binance bootstrap lifecycle are covered by deterministic offline tests. The tests use in-memory BrokerPort fakes; they do not connect to Binance TESTNET or LIVE.
