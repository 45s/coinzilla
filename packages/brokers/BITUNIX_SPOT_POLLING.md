# Bitunix Spot polling and reconciliation

**Status:** implemented polling observation primitive; not a Harvester-ready reconciliation contract.

## Why polling

The documented Bitunix Spot WebSocket API is authenticated request/response RPC. It does not expose a continuous private order/execution push subscription or replay cursor. A polling-backed observation lifecycle is therefore honest and useful; it must never be represented as native WebSocket push.

## Runtime contract

`BitunixSpotReconciler` accepts an existing Bitunix Spot broker and explicit symbols. Each cycle reads balances, open orders and the first page of order history for every configured symbol. For explicitly tracked broker order IDs it also reads the exchange-native matching-order detail endpoint.

- Cycles are single-flight; concurrent manual polls share the in-flight cycle.
- A snapshot is published only when every requested read succeeds. Partial data is not published as a complete snapshot.
- `observedAt` is local observation time. `sourceTime` remains `null`; local time is never represented as an exchange timestamp.
- The history endpoint is symbol-scoped and paginated. This primitive reads page 1 only and explicitly marks `FIRST_PAGE_ONLY`; it does not claim complete account history.
- Matching-order responses are preserved as `EXCHANGE_NATIVE_UNVERIFIED`. They are not converted into canonical fills or executions.
- Unchanged snapshots are deduplicated. Errors are surfaced and do not advance `lastSuccessAt`.
- `stop()` fences in-flight work, prevents subsequent endpoint reads after the currently dispatched request returns, and prevents callbacks or future scheduled cycles. It cannot abort a network request already in flight.
- Polling cadence is configurable from 250 ms to 60 seconds. Select a production interval only after checking Bitunix rate limits and aggregate symbol/order request volume.

## Deliberate non-guarantees

This primitive does not provide an atomic account snapshot, account-wide open-order enumeration, complete history pagination, stable per-execution IDs, proven fill quantity denomination/completeness/fee semantics, or replay of missed events. A successful observation is not proof that no transient order state occurred between polls.

It does not implement `subscribeForUserData` by fabricating Binance-shaped events. It is a broker-specific observation API pending a separately designed application contract. Harvester admission, canonical fills, canonical order reconciliation, and mutation automation remain blocked until their source-backed guarantees are established.

## TESTNET and live safety

Bitunix Spot has no documented TESTNET. Offline deterministic tests and authenticated live read-only verification do not require TESTNET. This implementation issues read-only calls only; it never places/cancels orders, transfers funds, or withdraws. Any future mutation acceptance requires separately approved live safeguards.
