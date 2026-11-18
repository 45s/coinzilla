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

Registration fails closed for an empty registry, duplicate or malformed identities, an invalid BrokerPort, a missing/unsupported capability declaration, a provider-type mismatch, or a missing/mismatched selected environment. Registry lookup requires the exact `providerInstanceId`; there is no implicit default, fallback, or provider selection by brand. The metadata listing is immutable and does not expose broker objects.

The registry owns connection lifecycle:

- `connect(id)` and `disconnect(id)` operate on one explicitly named instance.
- `connectAll()` connects entries in registration order. If a connection fails, it attempts cleanup for every constructed entry in reverse order, including the failing and not-yet-connected entries.
- `disconnectAll()` attempts every disconnect in reverse order and aggregates cleanup failures.
- Concurrent connection/disconnection requests for one instance share the in-flight operation. Successful disconnect is idempotent; failed cleanup remains visible and can be retried.

Errors preserve the original connection/cleanup causes. Credentials are never part of registry identity or diagnostic context.

## Current bootstrap boundary

The existing runtime still constructs and registers exactly one Binance instance from the legacy `TRADING_MODE` and Binance credentials. The registered BrokerPort facade is passed to the existing Harvester services; trading strategy, order semantics, market-data subscriptions, and shutdown ownership are unchanged.

The optional Bitunix observer tracked in [#1422](https://github.com/45s/coinzilla/issues/1422) is deliberately not registered here. It exposes a separate read-only facade and cannot be selected by registry lookup, execution routing, or strategy market-data routing. See the [Bitunix read-only observer contract](./bitunix-read-only-observer.md).

The registry can represent multiple named instances of the same provider type. The next delivery under Phase 4 adds only basic in-process account isolation; it does not make this registry itself an execution or market-data router. Explicitly out of scope for the registry foundation are:

- strategy/symbol execution-route tables;
- independent market-data routing;
- automatic selection, fallback, or failover;
- independent account runtime state (Portfolio, orders, balances and reservations); and
- process-restart recovery or restoration.

Those are separate decisions and delivery slices under #1339 and the existing ADRs. No exchange requests are made by the registry tests.

## Verification

The registry, identity resolver, adapter capability forwarding, and Binance bootstrap lifecycle are covered by deterministic offline tests. The tests use in-memory BrokerPort fakes; they do not connect to Binance TESTNET or LIVE.

## Phase 3 — durable order provenance

**Delivery status:** complete in merged [PR #1416](https://github.com/45s/coinzilla/pull/1416), merge commit `543753da5938eba2d95ad19d74c3f98a991e6461`. The runtime remains single-Binance and unrouted; this phase adds immutable order/fill provenance, not multi-provider execution.

New Harvester orders now carry the selected registry entry's immutable `providerInstanceId`, `providerType`, and `accountId` from the broker facade into the local PENDING `CanonicalOrder`. The complete triple is validated as stable non-secret identifier tokens; partial identity is rejected. The selected facade exposes identity from the exact registry entry returned by `connectBroker`; no route is inferred from `NODE_ENV`, provider brand, or a fallback default.

The durable order submission intent stores all three values and must be confirmed committed before `placeOrder()` is invoked. The same identity is required on the durable submission outcome and on cancellation intent/outcome facts. Broker acknowledgements are rehydrated with the pending order's provider identity before the outcome is committed, and registry transitions preserve it while rejecting any attempted identity mutation.

For user-data and historical execution fills, Harvester correlates the fill to the already-owned canonical order, attaches that order's provider/account identity to the immutable Fill, and commits it with the execution fact. A fill whose registered order has no provider provenance or whose supplied provenance conflicts is rejected as an ownership-integrity failure; it is not assigned to the currently configured provider by guesswork. Cancellation of an order lacking provider identity likewise fails closed.

Operational State and Journal projections carry the identity across submission, cancellation, fill and replay. The strict v1 fact validators accept the complete identity triple on new records, reject partial/malformed triples, and continue to read historical v1 records with no provenance. Existing append-only fact bytes and digest chains are not rewritten. A legacy order with no recorded identity remains readable for audit, but it is not safe to submit/cancel/reconcile as an owned order until an explicit, separately audited migration establishes provenance; this slice does not fabricate it.

This phase does not add multi-provider routing, a second exchange instance, account aggregation, automatic fallback/failover, or process-restart restoration. The runtime remains on its current explicitly configured Binance instance. The existing restart-recovery release gates in #654 remain separate and out of scope.

## Offline verification scope

Regression coverage exercises CanonicalOrder/Fill immutability, provider metadata propagation from the BrokerPort facade, intent-before-broker ordering, acknowledgement preservation, registry mutation rejection, strict durable-fact validation, and legacy fact compatibility. Tests use deterministic in-memory fakes and temporary local stores; no credentials, Binance API calls, or live/TESTNET order actions are needed.

## Phase 4 scope — basic in-process account isolation

Phase 4 is tracked by [issue #1339](https://github.com/45s/coinzilla/issues/1339). The first Phase 4 slice is implemented in [PR #1440](https://github.com/45s/coinzilla/pull/1440): process locks require a complete stable provider/account identity, different accounts may run concurrently, and two provider instances targeting the same account/environment remain mutually exclusive. Regression tests also reject incomplete identity pairs. The lock key is provider type + account alias + environment (not the instance alias), so two aliases for one exchange account cannot become concurrent writers; the default Binance primary account retains its legacy fingerprint for mixed-version exclusion. The legacy Binance primary account keeps its existing lock fingerprint so an older single-account process cannot overlap it. Separate in-memory account runtime state and lifecycle isolation remain the next Phase 4 work. The account runtime registry is implemented in `src/application/providers/account-runtime-registry.js`: each provider/account/environment descriptor receives its own Portfolio, OrderRegistry, strategy ledger collections, applied-fill identities, pause state and market metadata. Duplicate provider/account/environment scopes are rejected rather than silently creating two owners. Bootstrap now composes the legacy Binance account through this registry; it currently registers one account because multi-account provider construction is not yet wired. No process-restart restoration, Journal replay, crash recovery or #654 release gate is part of this phase. See the [multi-provider migration plan](../../../../docs/architecture/multi-provider-migration-plan.md) for the complete scope and acceptance criteria.
