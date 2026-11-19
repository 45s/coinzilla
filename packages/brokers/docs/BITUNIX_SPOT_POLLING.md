# Bitunix Spot polling and reconciliation

**Status:** private, read-only observation helper; not a Harvester user-data subscription.

## Purpose

Bitunix Spot exposes authenticated WebSocket request/response RPC, not a documented continuous private order/execution event stream. The private polling helper provides explicitly scoped REST observations without pretending that polling is native push.

## Internal boundary

The implementation lives under `src/infrastructure/bitunix/reconciler.js` and is not exported from the public `@coinzilla/brokers` package entry point. It is an infrastructure detail, not a second Broker facade or a Harvester-facing observer API.

Each poll reads account balances, symbol-scoped open orders, the first order-history page for each explicitly configured symbol, and matching-order detail only for explicitly tracked broker order IDs.

## Guarantees and limitations

- A poll publishes only after every requested read succeeds; partial snapshots are rejected.
- `observedAt` and freshness are local observation metadata, never exchange source timestamps.
- Semantic deduplication ignores the changing local observation timestamp.
- Order history is page 1 only. Open orders are symbol-scoped. Neither establishes account-wide completeness.
- Matching-order detail remains provider-native and unverified; it is not a canonical Fill.
- Polling cannot replay transient states that occur between cycles.
- Stop fencing prevents further reads and callbacks after an in-flight request returns; it cannot abort a request already dispatched.
- The helper does not fabricate Binance `executionReport` events and does not implement `subscribeForUserData()`.

## Harvester and trading safety

The public Bitunix Broker API continues to report `subscribeForUserData()` and `getAccountSnapshot()` as unsupported. Harvester's authoritative startup gate requires a source-timestamped account snapshot and valid user-data lifecycle evidence. The current Bitunix Spot contract cannot provide those guarantees.

This helper is therefore not evidence of Harvester readiness and must not be used to enable order placement, cancellation, or automated trading. See [the canonical lifecycle blockers](https://github.com/45s/coinzilla/issues/1185).

## TESTNET and live safety

Bitunix Spot does not document a TESTNET. Offline tests and authenticated live read-only verification do not require one. This helper performs read-only requests only; it does not place/cancel orders, transfer funds, or withdraw.
