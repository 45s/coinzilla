# Bitunix Spot order-fetch Phase 1

Issue: [#1704](https://github.com/45s/coinzilla/issues/1704)

This phase verifies order discovery and specific-order reads using only the public Coinzilla Broker API. It does not place, modify, or cancel orders.

## Known order identity

The operator's one-shot Spot LIMIT BUY was accepted by Bitunix on 2026-11-22:

- Symbol: HYPEUSDT
- Side/type: BUY LIMIT
- Quantity: 0.366 HYPE
- Price: 30 USDT
- Exchange order ID: "2124329325141426176" (must remain a string)

See [PR #1703](https://github.com/45s/coinzilla/pull/1703) for the exact placement acknowledgement and failed post-placement detail read.

## Verified API contract

Bitunix's official Spot documentation marks symbol as required for POST /api/spot/v1/order/pending/list. The Futures pending-orders endpoint is different: its symbol parameter is optional. Do not apply Futures behavior to Spot.

The public Spot market catalog is available through Broker.getExchangeMarkets(). Therefore, account-wide Spot discovery is implemented at the Broker API layer by:

1. Calling getExchangeMarkets() once.
2. Enumerating every unique active Spot market symbol returned.
3. Calling getOpenOrders({ symbol }) sequentially for every symbol.
4. Calling getOrder({ symbol, orderId }) once for every returned order.
5. Recording every result and continuing after an individual symbol or detail-read failure.

This avoids requiring the operator to know symbols and avoids undocumented account-wide REST parameters. It is a sequence of symbol-scoped requests, not a claim that Bitunix has a single account-wide Spot pending-orders endpoint.

## Diagnostics

The command emits structured logs for:

- Broker API operation starts, successful results, failures, symbols, order IDs, and statuses.
- Bitunix Spot REST request method/path, redacted query/body metadata, HTTP status, exchange code/message, response data, and errors.
- Every per-symbol pending-order result and every per-order detail result, including failed Result values and thrown exceptions.
- Final counts, target match count, and report path.

A complete JSON report is saved under packages/brokers/.diagnostics/. It includes normalized Broker API results and sanitized errors. API keys, secrets, signatures, nonces, user IDs, email addresses, phone numbers, and addresses are redacted. Diagnostic logging is best-effort and must never alter request behavior.

The scan is sequential, read-only, and does not retry failed requests. A failed symbol does not prevent scanning later symbols. A failed detail lookup does not prevent checking later orders.

## Lossless order IDs

The REST response parser converts numeric JSON tokens named orderId to strings before JSON.parse can round a 64-bit value. This guard applies to pending-order, history, detail, and placement responses. IDs must remain exact strings throughout the Broker API and report.

## Operator command

Run from the repository root after configuring packages/brokers/.env.development:

```bash
pnpm --filter @coinzilla/brokers bitunix:find-order --order-id=2124329325141426176
```

The command scans all active Spot markets, reads every discovered order detail, and writes a report. It constructs the Broker with live order mutations disabled. It never calls createOrder, cancelOrder, or cancelAllOpenOrders.

Exit codes:

- 0: the exact target order appears exactly once and every scan request completed without errors.
- 2: the full scan completed without request errors, but the exact order was not found in any pending list. It may have filled or otherwise left the pending set; this does not prove the order is absent.
- 1: one or more requests failed, the scan could not complete, or the diagnostic report could not be saved. Inspect the report; a target match may still have been found during a partial scan.

## Acceptance gate

Phase 1 passes only when the report contains exactly one pending-order match with:

- symbol === "HYPEUSDT"
- orderId === "2124329325141426176"

It must also contain a recorded getOrder() result for that exact identity. If detail lookup fails, that failure is evidence for Phase 2, not permission to cancel or retry.

Do not proceed to cancellation until the order-discovery and specific-order-read behavior has been analyzed and the next phase is approved. No live mutation is part of this command.
