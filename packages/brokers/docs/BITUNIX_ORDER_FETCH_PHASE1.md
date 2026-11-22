# Bitunix Spot order-fetch Phase 1

Issue: [#1704](https://github.com/45s/coinzilla/issues/1704)

The read-only phase verifies Spot pending-order discovery and specific-order reads. The explicit one-shot cancellation mode below cancels only the previously approved HYPEUSDT order, records the result, then runs the same read-only order scan.

## Operator command

Run the existing healthcheck; by default it runs only the order-read workflow. No order ID or extra command is required:

```bash
pnpm --filter @coinzilla/brokers bitunix:healthcheck
```

For a private local report instead of publishing the sanitized report branch (read-only only):

```bash
pnpm --filter @coinzilla/brokers bitunix:healthcheck --local
```

## One-shot cancellation followed by the existing order scan

The default command remains read-only. To perform the explicitly approved cancellation of the existing order and then run the unchanged open-order/detail scan, use:

```bash
pnpm --filter @coinzilla/brokers bitunix:healthcheck --cancel-existing-order
```

This mode is interactive-terminal-only and targets exactly `HYPEUSDT / 2124329325141426176`. It creates a mutation-enabled Broker solely for one `cancelOrder({ symbol, orderId })` call, waits for the Broker result (including its exchange detail verification), records the sanitized request/response/error, disconnects that Broker, and then creates the normal read-only Broker for `getOpenOrders()`, `getOrder()` for every discovered open order, and a final `getOrder()` for the approved target ID even if it no longer appears in the open-order list. It does not call `cancelAllOpenOrders()`, does not cancel any other order, and never retries. If cancellation is ambiguous or fails, the script still runs the read-only scan to capture the resulting state; the cancellation failure remains visible and the overall workflow fails. A connection/pre-dispatch failure is recorded as NOT_SENT.

Do not rerun this mode after the one-shot attempt without reviewing its published report. Ordinary `bitunix:healthcheck` remains read-only.

## Focused versus full diagnostics

The default healthcheck and `--local` run only:

1. `broker.getOpenOrders()` with no arguments.
2. If that result is successful, `broker.getOrder({ symbol, orderId })` for every discovered order.

The existing account, REST, WebSocket, ping, and user-info diagnostics are **not deleted**. They are temporarily skipped by default to avoid repeating checks that have already been completed. Run them explicitly when needed:

```bash
pnpm --filter @coinzilla/brokers bitunix:healthcheck --full-diagnostics
```

The `--place-order` workflow retains its broader read-only preflight. `--cancel-existing-order` is a separate, explicitly invoked one-shot cancellation workflow and is not part of the default command. No live placement or cancellation is part of the default order-read scan.

## Order-read sequence

The healthcheck connects through the public Coinzilla Broker API and runs:

```js
const openOrdersResult = await broker.getOpenOrders()

// Record the complete sanitized result, including errors.

if (Array.isArray(openOrdersResult?.data)) {
  // Process successful-symbol orders even when another symbol failed.
  // The aggregate result remains failed and the health gate stays blocked.
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

Bitunix documents `POST /api/spot/v1/order/pending/list` with a required symbol. The Broker API's no-argument `getOpenOrders()` enumerates the current active Spot market catalog and queries each unique symbol through that symbol-scoped method. It uses a fixed four-worker pool, then aggregates results and errors in catalog order. This is a client-side convenience scan, not an exchange-provided account-wide endpoint: the catalog can omit markets that are no longer active, and Bitunix documents no cross-symbol snapshot/version token, so complete or atomic account-wide coverage is not established. The official Spot page does not publish a per-endpoint rate limit for this request; four is Coinzilla's local concurrency cap, not an exchange rate-limit claim. Per-symbol errors and partial data remain visible. The specific-order detail endpoint is `GET /api/spot/v1/order/detail`, with `orderId` in the URL query string. Its REST signature uses the sorted query key/value concatenation (for example, `orderId2124329325141426176`) without separators. This matches the established [JKorf Bitunix.Net REST authentication implementation](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/BitunixAuthenticationProvider.cs), which is used as the compatibility reference for this GET request. The official Spot signing page's query example is ambiguous against that implementation, so keep a regression vector for the known-working client format.

## Diagnostics and safety

- The report stores the complete sanitized Broker Result for `getOpenOrders` and each `getOrder`, including normalized data and errors.
- Broker API and Bitunix REST logger events are retained in report events.
- Request arguments, order IDs, symbols, success states, normalized data and error details are recorded.
- Credentials, signatures, nonces and private user fields are redacted.
- Pending-order market reads use at most four concurrent requests; results/errors are restored to catalog order. Specific-order detail reads remain sequential.
- Requests are never automatically retried; a failed market read remains visible and does not suppress other symbols.
- Live order mutations are disabled in the normal scan Broker. Only the explicit `--cancel-existing-order` mode constructs a separate mutation-enabled Broker, and it invokes one `cancelOrder` for the fixed approved identity. No placement, bulk cancellation, transfer or withdrawal methods are called.

## Diagnostic privacy boundary

- Terminal output shows each discovered order as `symbol / orderId` and prints the matching `getOrder` result with that identity; it never prints raw exchange request/response bodies.
- REST response log events record response shape (type, item count, field names) rather than response values. Free-form exchange and transport messages are withheld.
- Private REST/WebSocket diagnostic results store structural summaries only. The local diagnostic report is private and created with restrictive file permissions; it is not a substitute for safe logging.
- Sanitization explicitly redacts balances, locked balances, amounts, fees, wallet/from/to addresses, transaction hashes, withdrawal/deposit identifiers, recipient IDs, phone/email, memos and remarks.
- The published GitHub report uses a separate strict allowlist. For the explicitly approved `Broker API getOpenOrders` and `Broker API getOrder` operations only, it includes the sanitized request arguments, normalized response data, and structured errors so the operator can verify each `symbol / orderId` pair. Other diagnostic operations still omit request/response payloads, and diagnostic events remain excluded.
- Tests assert that realistic account and withdrawal fixtures cannot leak through REST logger events or the diagnostic sanitizer; order-read publication tests prove that symbol/orderId and normalized order fields remain visible while balances, account identifiers, credentials, signatures and non-order diagnostic payloads remain excluded.

## Regression coverage

Workflow tests inject a read-only Broker stub for ordinary publish and operator-mode scenarios, so they do not contact Bitunix or wait on network timeouts. Broker regressions verify the four-request concurrency ceiling, one request per active symbol, catalog-order aggregation despite out-of-order responses, and preservation of partial symbol failures. Healthcheck regressions verify that every order in partial data still receives a detail read while the aggregate health gate remains failed. Other tests verify the complete open-orders result, every detail response, and failed pending-order handling. Signature tests cover the exact 19-digit HYPE order ID and the query serialization used by the established .NET client. Healthcheck tests verify that default mode skips broad diagnostics, still requires every discovered order detail to succeed, and that `--full-diagnostics` preserves access to the existing checks.

## Observed scan baseline

The operator's read-only healthcheck report `bitunix-health-20261122T064933913Z.json` (report commit `9d7f053e23af64c93091454461814ea4ec367bc4`, source commit `7f70cf2a3d44e5e8c747bc5414c076ec83b99f3d`) measured `getOpenOrders()` at **156,985 ms**. The updated healthcheck prints the scan duration so the next operator-run report can be compared against this baseline. This measurement is one observed run, not a Bitunix latency guarantee.

## Known accepted order

The operator's accepted HYPEUSDT BUY LIMIT from 2026-11-22 has exchange order ID `2124329325141426176`, quantity `0.366`, price `30` USDT. The healthcheck discovers this ID from pending-order results; it is not supplied to the script.

## Published order-read evidence

The terminal and both local/published report files intentionally show order identity. The published report includes:

- Every order returned by `getOpenOrders()`, including its `symbol` and exchange `orderId` (`id` in the Broker DTO).
- The exact `getOrder({ symbol, orderId })` arguments for every discovered order.
- The complete sanitized normalized result and structured errors for each corresponding detail read.
- Per-operation status and duration.

The current accepted-order identity is `HYPEUSDT / 2124329325141426176`. This explicit publication policy is limited to the order-read operations; broad account diagnostics remain metadata-only.

## Acceptance gate

Review the healthcheck report for the HYPEUSDT order and its corresponding detail-read result. A failed `getOrder` remains visible and blocks the order-read gate. Cancellation is separately gated by the explicit `--cancel-existing-order` mode and the approved fixed order identity; never retry an ambiguous cancellation.
