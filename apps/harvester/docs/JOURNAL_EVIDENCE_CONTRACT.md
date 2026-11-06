# Harvester Journal Evidence Contract

## Purpose

The Journal is an investigation record of what Harvester decided, what it requested from the broker, what the broker reported, what executed, and what account state was observed. It is not trading-state authority and must never drive strategy decisions.

This contract covers the current selected evidence work in [issue #650](https://github.com/45s/coinzilla/issues/650). It does not authorize replay, process-restart recovery, or changes to trading/accounting policy.

## Safety and delivery

- Preserve the mandatory durability boundary defined once in [TRADING_FIRST.md — Journal contract boundary](./TRADING_FIRST.md#journal-contract-boundary); do not weaken or extend it as part of optional evidence work.
- All additional evidence is best-effort. Do not await Journal I/O from strategy evaluation, market processing, broker-event callbacks, or fill accounting.
- Keep evidence DTOs plain, bounded, allowlisted, versioned, and serializable. Never serialize arbitrary SDK/request/response objects.
- Never persist API keys, secrets, signatures, listen keys, authorization headers, or credentials.
- EventBus event ID/timestamp and Journal session metadata provide record identity and receipt time. Broker event/transaction times remain separate payload facts.
- Keep exact decimal quantities/prices/fees as strings. Keep exchange IDs as strings in Journal DTOs even when the adapter receives numeric JSON values.
- Preserve source distinctions: normalized Harvester facts use Harvester event names; broker-origin evidence uses a broker-qualified source/schema.

## Evidence coverage matrix

| Evidence | Producer | Journal representation | Correlation |
|---|---|---|---|
| Actionable strategy decisions | Conservative trading engine | `strategy.decision`: strategy, symbol, reference price, decision reason, compact decision inputs, and executable actions | symbol, event ID/time |
| Order submission request | Conservative trading engine before broker placement | `order.submission_requested`: client ID, symbol, side, type, price, quantity, pending status | client order ID |
| Broker order acknowledgement | Conservative trading engine after canonical acknowledgement | `order.submitted`: client/exchange order IDs and canonical status/order facts | client + broker order IDs |
| Broker execution report | Binance user-data adapter for each executionReport | `broker.execution_report`: schema v1 allowlist with source, event/transaction time, order/client/trade IDs, order/last/cumulative quantities and prices, quote totals, commission amount/asset, maker flag, status/type, reject reason | symbol, broker order ID, client order ID, trade ID |
| Applied order state transition | Conservative trading engine after a new registry state is applied | `order.updated`: canonical IDs, side/type/status, original/executed quantities, limit price, broker transaction time, cumulative quote quantity when supplied | client + broker order IDs |
| Submission rejection/unknown outcome | Conservative trading engine | `order.submission_failed`: IDs, classified outcome, safe error name/message/code | client order ID |
| Cancellation intent/outcome | Conservative trading engine | `order.cancel_requested`, `order.cancelled`, `order.cancel_failed` | client + broker order IDs |
| Individual applied execution | Accounting boundary | `execution.fill_applied`: trade/execution IDs, order IDs, side, price, base/quote quantities, actual commission amount/asset, liquidity role, transaction time | fill ID + trade ID + order IDs |
| Duplicate/invalid/unowned execution | User-data/accounting boundary | Existing duplicate, invalid, unowned, and accounting-failed events | fill/order IDs |
| Exchange trading-rule snapshot | Bootstrap after exchange metadata validation | `market.trading_rules_captured`: venue, symbol, base/quote assets, selected order type, supported order types, every supported/unsupported filter and exact decimal value | symbol + event ID/time |
| Account baseline and closing state | Bootstrap account audit | `account.snapshot_captured` and `account.open_orders_captured` | Journal session ID, phase, source timestamp |
| Broker connectivity/readiness | Bootstrap/user-data status callback | Existing connection, subscription, and status-change events with safe error facts | broker + stream + event time |

## Binance executionReport schema v1

The adapter emits a fixed allowlist only. Unknown input properties are discarded. String values are capped at 256 characters.

Fields may be absent when Binance does not supply them:

- Identity/time: `eventTime`, `transactionTime`, `symbol`, `orderId`, `clientOrderId`, `originalClientOrderId`, `tradeId`.
- Order facts: `side`, `orderType`, `timeInForce`, `orderQuantity`, `orderPrice`, `executionType`, `orderStatus`, `working`, `rejectReason`.
- Execution facts: `lastExecutedQuantity`, `cumulativeExecutedQuantity`, `lastExecutedPrice`, `cumulativeQuoteQuantity`, `lastQuoteQuantity`.
- Fee/liquidity facts: `commissionAmount`, `commissionAsset`, `isMaker`.

The broker evidence record is stored separately from normalized `order.updated` and `execution.fill_applied` events. It does not replace canonical domain objects or imply that a broker event has been applied to accounting.

## Known boundaries

- High-frequency market ticks are intentionally not journaled; the decision record captures the price used for an actionable decision.
- The current evidence path preserves executionReport broker facts, not unrestricted WebSocket frames or signed RPC traffic.
- Broker acknowledgements are recorded as canonical order facts; arbitrary raw RPC response objects are not retained.
- Trading-rule snapshots are captured after validation and before engine activation. Later exchange filter changes are not currently streamed or refreshed as Journal events.
- Journal write failure for optional evidence is an observable evidence gap, not a trading-state failure. Existing required durability barriers retain their current fail-closed semantics.
