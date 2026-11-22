# Bitunix Spot order-fetch Phase 1

Issue: [#1704](https://github.com/45s/coinzilla/issues/1704)

This document records Phase 1 only: verify the existing Spot pending-orders fetch method and locate the accepted HYPEUSDT order by exact exchange identity. Specific-order detail lookup and cancellation are deliberately out of scope until Phase 1 passes.

## Known order identity

The operator's one-shot Spot LIMIT BUY was accepted by Bitunix on 2026-11-22:

- Symbol: `HYPEUSDT`
- Side/type: `BUY LIMIT`
- Quantity: `0.366 HYPE`
- Price: `30 USDT`
- Exchange order ID: `"2124329325141426176"` (must remain a string)

The operator reported that the order was waiting/open after placement. That is historical operator confirmation, not a fresh status read. See [PR #1703](https://github.com/45s/coinzilla/pull/1703) for the exact placement acknowledgement and post-placement detail-read failure.

## Existing fetch method audit

`BitunixSpotBroker.getOpenOrders({ symbol })`:

1. Requires an explicit symbol and normalizes it to uppercase.
2. Sends one authenticated `POST /api/spot/v1/order/pending/list` request with `{ symbol }` and `stateChanging: false`.
3. Accepts the documented single-row object or array response shape.
4. Rejects missing/malformed order rows and rejects any row whose symbol does not match the requested symbol.
5. Normalizes rows through `adaptOrder()`, retaining the exchange order ID as a string.

This endpoint is **symbol-scoped**. It does not enumerate every Spot symbol and must be called with `HYPEUSDT` for this check.

The REST response parser now also converts numeric JSON tokens named `orderId` to strings before `JSON.parse` can round a 64-bit value. This guard applies to pending-order, history, detail and placement responses; documented string IDs remain unchanged.

## Offline regression coverage

The broker tests cover:

- The exact accepted 19-digit HYPE order ID in the documented string form.
- Exact ID and symbol matching after normalization.
- HYPEUSDT/BUY/OPEN state, price and quantity fields.
- One signed pending-orders POST with the exact serialized body.
- A raw JSON fixture where the same 64-bit order ID is represented as a numeric token; the parser must preserve it losslessly.
- Existing empty-list, single-object, malformed-row and wrong-symbol behavior.

The read-only command tests cover exact matching, an empty pending list, and rejection of numeric CLI IDs.

## Operator read-only verification

Run from the repository root after configuring `packages/brokers/.env.development`:

```bash
pnpm --filter @coinzilla brokers:find-order --order-id=2124329325141426176
```

Use the actual package command name:

```bash
pnpm --filter @coinzilla/brokers bitunix:find-order --order-id=2124329325141426176
```

The command:

- Constructs the Bitunix broker with live order mutations disabled.
- Calls only `getOpenOrders({ symbol: "HYPEUSDT" })`.
- Matches both exact string `orderId` and exact `HYPEUSDT` symbol.
- Prints normalized status and order quantities if found.
- Never calls order detail, placement, modification or cancellation.

Exit codes:

- `0`: the exact order was found in the current HYPEUSDT pending-order response.
- `2`: the exact ID was not present in that pending response. This is **not** proof that the order is absent from Bitunix; it may have left the pending set. Do not place or cancel anything.
- `1`: request, validation or local configuration failure.

## Phase 1 acceptance gate

Phase 1 remains open until the operator runs the command and the response contains exactly one row with:

- `id === "2124329325141426176"`
- `symbol === "HYPEUSDT"`

Record the sanitized command output as evidence. Do not begin Phase 2 or test cancellation before this gate passes. No live placement or cancellation is part of Phase 1.
