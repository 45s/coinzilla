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
- The helper does not fabricate Binance `executionReport` events. The public `subscribeForUserData()` method exposes its output only through `onObservation`; it does not emit native execution events through `onEvent`.

## Harvester and trading safety

The Bitunix Broker API advertises `OBSERVE_USER_DATA` as supported and keeps native `SUBSCRIBE_USER_DATA` and `getAccountSnapshot()` unsupported. Harvester's authoritative startup gate requires a source-timestamped account snapshot and native user-data lifecycle evidence. Polling observations cannot satisfy those guarantees, cannot create canonical fills, and do not make Bitunix eligible for Harvester provider registration.

This polling subscription is therefore not evidence of Harvester readiness and must not be used to enable order placement, cancellation, or automated trading. It requires an explicit non-empty `symbols` list, accepts only explicitly supplied `trackedOrders`, and returns a `disconnect()` handle. Changed snapshots are delivered as `{ observation }` messages; native `onEvent` is never called. `onStatus` receives poll-cycle freshness and failure states, while the returned subscription exposes `getStatus()` for an immediate health read. See [the canonical lifecycle blockers](https://github.com/45s/coinzilla/issues/1185).

## TESTNET and live safety

Bitunix Spot does not document a TESTNET. Offline tests and authenticated live read-only verification do not require one. This helper performs read-only requests only; it does not place/cancel orders, transfer funds, or withdraw.
