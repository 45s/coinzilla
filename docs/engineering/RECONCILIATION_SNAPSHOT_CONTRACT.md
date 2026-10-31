# Reconciliation Snapshot Contract

**Owner:** `apps/bot-free-roll`  
**Roadmap:** FR-057  
**Status:** Contract defined; broker port prerequisites tracked in [cross-domain request #316](https://github.com/45s/coinzilla/issues/316).

## Purpose

A reconciliation snapshot is a bounded, auditable view of exchange account state used before a bot can transition to `READY` or resume order mutations.

It is not a ledger and it is not an atomic exchange transaction. It combines several exchange queries taken over a finite server-time window. User-data events received during collection must remain buffered and be replayed after the snapshot is validated. A snapshot is usable only when every required section is complete and its source timestamps are valid.

## Contract shape

The bot consumes an exchange-neutral object. Binance wire fields, raw payloads, and pagination rules stay inside `packages/brokers`.

```js
{
  schemaVersion: 1,

  window: {
    startedAtServerTime: 0,
    completedAtServerTime: 0,
  },

  account: {
    balances: [],
    sourceTime: 0,
    observedAtServerTime: 0,
    completeness: "COMPLETE",
  },

  symbols: {
    DOGEFDUSD: {
      openOrders: {
        items: [],
        observedAtServerTime: 0,
        completeness: "COMPLETE",
      },

      orderHistory: {
        items: [],
        firstOrderId: null,
        nextOrderId: null,
        pagesFetched: 1,
        observedAtServerTime: 0,
        completeness: "COMPLETE",
      },

      fills: {
        items: [],
        firstTradeId: null,
        nextTradeId: null,
        pagesFetched: 1,
        observedAtServerTime: 0,
        completeness: "COMPLETE",
      },
    },
  },
}
```

All timestamps are integer Unix milliseconds from the exchange server. IDs and decimal quantities remain exact strings in the bot-facing contract. The object and all nested collections are immutable snapshots; consumers must not mutate broker-owned entities or shared arrays.

## Completeness rules

Each section uses exactly one of:

- `COMPLETE`: every required request succeeded, the response was validated, pagination was exhausted, and a source timestamp is available.
- `INCOMPLETE`: a request failed, a page may be truncated, a cursor cannot advance safely, a response is malformed, or a required record is missing.
- `UNKNOWN`: the source does not provide enough information to prove completeness or freshness.

The top-level snapshot is usable only when every required section is `COMPLETE`. `INCOMPLETE` and `UNKNOWN` are both fail-closed; they must never be interpreted as empty or zero.

### Account balances

- Use canonical `Balance[]`, not lossy asset summaries.
- Preserve the exchange account response's own `updateTime` as `sourceTime`.
- Request all balances, including zero balances, so the snapshot has a well-defined account scope.
- A successful request with a missing or invalid source timestamp is not complete.

### Open orders

- Fetch all open orders for each enabled symbol.
- Preserve exact original, executed, and remaining quantities, order identity, status, and order update timestamp.
- The section is complete only when the broker confirms the full open-order response and every returned order validates.
- Any unexpected, duplicate, changed, or unresolvable order is a reconciliation discrepancy, not something to silently discard.

### Order history and fills

- Collect order history and fills independently; an order status is not a substitute for executions.
- Use stable order/trade IDs as cursors. Keep page boundaries and the next cursor in the snapshot.
- A page at the maximum supported limit is potentially truncated. Request the next page; do not mark it complete just because the request succeeded.
- The next cursor must advance strictly beyond the last returned ID. Repeated IDs are deduplicated only when the exact payload matches; conflicting duplicates make the section incomplete.
- A history query with a bounded time range must record that range and respect the source's maximum supported window.
- An order or trade history that cannot be paginated to exhaustion remains incomplete.

### Server time and consistency window

- Sample exchange server time before and after collecting the account and symbol sections.
- Require `completedAtServerTime >= startedAtServerTime`.
- Record each section's observation time within that window.
- The snapshot is not atomic. The window is evidence of when the data was observed, not proof that every source was read at one instant.
- Events received while collecting the snapshot must be buffered and replayed through the normal serialized event path before recovery is acknowledged.

## Validation invariants

The snapshot validator must reject:

1. Unsupported schema versions or missing required sections.
2. Non-integer, negative, or decreasing server timestamps.
3. Missing source timestamps for sections marked `COMPLETE`.
4. Duplicate asset codes, order IDs, or trade IDs with conflicting payloads.
5. Non-exact decimal values or inconsistent balance totals.
6. A full page marked complete without a subsequent exhaustion check.
7. A cursor that repeats, moves backwards, or skips the documented next-ID boundary.
8. Any enabled symbol omitted from the snapshot.
9. Any unresolved order/fill discrepancy.

The validator is a pure function: same input, same result; it does not mutate input, call the broker, read the clock, or perform I/O.

## Broker port dependency

The consumer requires the broker-owned capabilities in [request #316](https://github.com/45s/coinzilla/issues/316):

- `getServerTime()` for exchange server timestamps.
- `getAccountSnapshot()` for canonical balances plus the account source `updateTime`, while preserving the existing `getBalances()` array contract.
- Cursor-aware `getMyTrades()` and `getOrderHistory()` queries that preserve exact source IDs/timestamps and allow every page to be collected.

The bot must not call Binance RPC method names directly or interpret Binance wire payloads. The broker adapter owns that translation.

## Scope boundary

This contract supports deterministic live-state reconciliation. It does not define durable ledger persistence, restart restoration, external deposit/withdrawal attribution, or operator-controlled resume. Those remain separate roadmap items FR-058–FR-066.
