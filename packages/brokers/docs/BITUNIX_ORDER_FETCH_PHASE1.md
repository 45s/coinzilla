# Bitunix Spot order-fetch Phase 1

Issue: [#1704](https://github.com/45s/coinzilla/issues/1704)

This phase verifies Spot pending-order discovery and specific-order reads through the existing LIVE read-only healthcheck. It does not place, modify, or cancel orders.

## Operator command

Run the existing healthcheck; by default it runs only the order-read workflow. No order ID or extra command is required:

```bash
pnpm --filter @coinzilla/brokers bitunix:healthcheck
```

For a private local report instead of publishing the sanitized report branch (also order-read only):

```bash
pnpm --filter @coinzilla/brokers bitunix:healthcheck --local
```

## Focused versus full diagnostics

The default healthcheck and `--local` run only:

1. `broker.getOpenOrders()` with no arguments.
2. If that result is successful, `broker.getOrder({ symbol, orderId })` for every discovered order.

The existing account, REST, WebSocket, ping, and user-info diagnostics are **not deleted**. They are temporarily skipped by default to avoid repeating checks that have already been completed. Run them explicitly when needed:

```bash
pnpm --filter @coinzilla/brokers bitunix:healthcheck --full-diagnostics
```

The `--place-order` workflow retains its broader read-only preflight. No live placement or cancellation is part of the default order-read scan.

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

Bitunix documents `POST /api/spot/v1/order/pending/list` with a required symbol. The Broker API's no-argument `getOpenOrders()` enumerates active Spot markets and sequentially aggregates symbol-scoped reads. Per-symbol errors and partial data remain visible. The specific-order detail endpoint is `GET /api/spot/v1/order/detail`, with `orderId` in the URL query string. Its REST signature uses the sorted query key/value concatenation (for example, `orderId2124329325141426176`) without separators. This matches the established [JKorf Bitunix.Net REST authentication implementation](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/BitunixAuthenticationProvider.cs), which is used as the compatibility reference for this GET request. The official Spot signing page's query example is ambiguous against that implementation, so keep a regression vector for the known-working client format.

## Diagnostics and safety

- The report stores the complete sanitized Broker Result for `getOpenOrders` and each `getOrder`, including normalized data and errors.
- Broker API and Bitunix REST logger events are retained in report events.
- Request arguments, order IDs, symbols, success states, normalized data and error details are recorded.
- Credentials, signatures, nonces and private user fields are redacted.
- Requests are sequential and never automatically retried.
- Live order mutations are disabled in the scan Broker. No placement, cancellation, transfer or withdrawal methods are called.

## Diagnostic privacy boundary

- Terminal output is progress and summary only; it must never print raw exchange request/response bodies.
- REST response log events record response shape (type, item count, field names) rather than response values. Free-form exchange and transport messages are withheld.
- Private REST/WebSocket diagnostic results store structural summaries only. The local diagnostic report is private and created with restrictive file permissions; it is not a substitute for safe logging.
- Sanitization explicitly redacts balances, locked balances, amounts, fees, wallet/from/to addresses, transaction hashes, withdrawal/deposit identifiers, recipient IDs, phone/email, memos and remarks.
- The published GitHub report uses a separate strict allowlist and excludes request/response payloads and diagnostic events entirely.
- Tests assert that realistic account and withdrawal fixtures cannot leak through REST logger events or the diagnostic sanitizer.

## Regression coverage

Workflow tests inject a read-only Broker stub for ordinary publish and operator-mode scenarios, so they do not contact Bitunix or wait on network timeouts. Dedicated scan tests verify the complete successful pending-orders result, every detail response, failed pending-order results, and that detail reads are skipped when the pending-order request fails. Signature tests cover the exact 19-digit HYPE order ID and the query serialization used by the established .NET client. Healthcheck tests verify that default mode skips broad diagnostics, still requires every discovered order detail to succeed, and that `--full-diagnostics` preserves access to the existing checks.

## Known accepted order

The operator's accepted HYPEUSDT BUY LIMIT from 2026-11-22 has exchange order ID `2124329325141426176`, quantity `0.366`, price `30` USDT. The healthcheck discovers this ID from pending-order results; it is not supplied to the script.

## Acceptance gate

Review the healthcheck report for the HYPEUSDT order and its corresponding detail-read result. A failed `getOrder` is evidence for the next investigation phase, not permission to retry or cancel. Do not proceed to cancellation until order-read findings are reviewed and that phase is explicitly approved.
