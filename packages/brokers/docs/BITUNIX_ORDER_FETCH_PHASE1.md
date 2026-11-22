# Bitunix Spot order-fetch Phase 1

Issue: [#1704](https://github.com/45s/coinzilla/issues/1704)

This phase verifies Spot pending-order discovery and specific-order reads through the existing LIVE read-only healthcheck. It does not place, modify, or cancel orders.

## Operator command

Run the existing healthcheck; no order ID or extra command is required:

```bash
pnpm --filter @coinzilla/brokers bitunix:healthcheck
```

For a private local report instead of publishing the sanitized report branch:

```bash
pnpm --filter @coinzilla/brokers bitunix:healthcheck --local
```

## Order-read sequence

The healthcheck connects through the public Coinzilla Broker API and runs:

```js
const openOrdersResult = await broker.getOpenOrders()

// Record the complete sanitized result, including errors.

if (openOrdersResult.ok) {
  for (const order of openOrdersResult.data) {
    const detailResult = await broker.getOrder({
      symbol: order.symbol,
      orderId: order.id,
    })

    // Record every request and response:
    // order ID, symbol, success, normalized data, errors.
  }
}
```

Order IDs are discovered from `getOpenOrders().data`; they are never passed as CLI arguments. The complete `getOpenOrdersResult` is recorded before checking `ok`. Every `getOrder` result is recorded, and a failed detail read does not stop later orders from being checked.

## Bitunix Spot API behavior

Bitunix documents `POST /api/spot/v1/order/pending/list` with a required symbol. The Broker API's no-argument `getOpenOrders()` enumerates active Spot markets and sequentially aggregates symbol-scoped reads. Per-symbol errors and partial data remain visible. The specific-order detail endpoint is `GET /api/spot/v1/order/detail`.

## Diagnostics and safety

- The report stores the complete sanitized Broker Result for `getOpenOrders` and each `getOrder`, including normalized data and errors.
- Broker API and Bitunix REST logger events are retained in report events.
- Request arguments, order IDs, symbols, success states, normalized data and error details are recorded.
- Credentials, signatures, nonces and private user fields are redacted.
- Requests are sequential and never automatically retried.
- Live order mutations are disabled in the scan Broker. No placement, cancellation, transfer or withdrawal methods are called.

## Known accepted order

The operator's accepted HYPEUSDT BUY LIMIT from 2026-11-22 has exchange order ID `2124329325141426176`, quantity `0.366`, price `30` USDT. The healthcheck discovers this ID from pending-order results; it is not supplied to the script.

## Acceptance gate

Review the healthcheck report for the HYPEUSDT order and its corresponding detail-read result. A failed `getOrder` is evidence for the next investigation phase, not permission to retry or cancel. Do not proceed to cancellation until order-read findings are reviewed and that phase is explicitly approved.
