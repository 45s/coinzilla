# Reconciliation Snapshot Contract

**Owner:** `apps/bot-free-roll`  
**Roadmap:** FR-057  
**Status:** Collector and pure validator implemented in PR #326. Broker timestamp/history ports are delivered by [PR #320](https://github.com/45s/coinzilla/pull/320) and canonical order history by [PR #325](https://github.com/45s/coinzilla/pull/325).

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
        items: [], // canonical Entities CanonicalOrder[] for tracked orders only
        trackedOrderIds: [],
        pagesFetched: 0,
        observedAtServerTime: 0,
        completeness: "COMPLETE",
      },

      fills: {
        items: [], // canonical Entities Fill[] from getFills()
        trackedOrderIds: [],
        firstTradeId: null,
        nextTradeId: null,
        pagesFetched: 0,
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
- Scope order history and fills to the bot's currently tracked order IDs for each enabled symbol. This snapshot does **not** claim to download the account's entire order/trade history. Binance returns only recent records when no cursor or time condition is supplied.
- Query each tracked order with `getCanonicalOrderHistory({ symbol, orderId })`; require exactly one matching canonical `CanonicalOrder` record. The raw compatibility `getOrderHistory()` result must not enter bot logic.
- Query fills independently with `getFills({ symbol, orderId, fromId?, limit })`. `fromId` is the next inclusive trade-ID cursor and may be combined with `orderId`.
- A page at the maximum supported limit is potentially truncated. Request the next page; do not mark it complete just because the request succeeded.
- The next cursor must advance strictly beyond the last returned ID. Duplicate, unordered, or unsafe IDs make the section incomplete.
- Binance order/trade IDs are int64 values. The current JSON RPC boundary accepts cursor IDs only when they fit JavaScript's safe-integer range; larger IDs are rejected rather than rounded, and the affected history section must remain incomplete. Supporting larger IDs requires a transport-level int64 representation.
- Stop at a bounded page limit. If the cap is reached before a short page proves exhaustion, the history section is incomplete.
- A tracked order missing from canonical order history is incomplete, not an empty history. An order with zero fills is valid when its canonical order record exists and the fills query returns an empty page.
- Untracked historical orders are outside this snapshot; unexpected currently open orders remain a reconciliation discrepancy.

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
- `getCanonicalOrderHistory()` for exchange-neutral `CanonicalOrder[]` records scoped to a tracked order.
- Cursor-aware `getFills()` (canonical Entities Fill[]) for each tracked order, preserving exact source IDs/timestamps and allowing every page to be collected.

The bot must not call Binance RPC method names directly or interpret Binance wire payloads. The broker adapter owns that translation. The snapshot collector and pure validator are implemented in `apps/bot-free-roll/src/bot/reconciliation-snapshot.js`; integration into the running recovery flow is a separate consumer step.

## Scope boundary

This contract supports deterministic live-state reconciliation. It does not define durable ledger persistence, restart restoration, external deposit/withdrawal attribution, or operator-controlled resume. Those remain separate roadmap items FR-058–FR-066.
