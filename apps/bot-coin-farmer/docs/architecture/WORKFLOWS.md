# Coin Farmer — Application and Trading Workflows

This document describes the intended end-to-end behavior of CF. All sequences are target workflows, not implemented functionality.

## 1. Bootstrap and process startup

1. Load JSON strategy configuration and environment secrets separately.
2. Validate all configured markets, decimal strings, strategy limits and adapter settings.
3. Construct logger, EventBus, Journal, optional Telegram notifier and state repository.
4. Construct the configured CEX adapter (Binance WebSocket first) and connect required API/stream resources.
5. Query broker capabilities, effective commission eligibility and exact trading rules for each enabled market.
6. Load any persisted CF state (in-memory only in early development; durable repository in the persistence phase).
7. Fetch canonical account balances, open orders and relevant order/fill history.
8. Reconcile local state and broker facts. Unknown orders, incomplete history, unknown fees or unexplained inventory must keep the market blocked.
9. Subscribe to market/user-data streams and start per-market workflows only after readiness gates pass.
10. Publish runtime/market-ready events.

**Never submit an order merely because the WebSocket connection succeeded.** Connection health, market-data health, fee eligibility, trading rules and reconciled state are separate gates.

## 2. Market observation to BUY decision

See [buy-order-flow.mmd](./diagrams/buy-order-flow.mmd).

1. Binance adapter receives last-trade data and maps it into a canonical observation with market identity and source timestamp.
2. Market-data port delivers the observation to the application workflow.
3. Workflow serializes work for the affected market and validates freshness/stream continuity.
4. Domain calculates whether the intended standing BUY is missing or needs a new plan. The price is based on the initial reference or last qualifying BUY and `priceStepPercent`.
5. Domain returns an order intent or a refusal reason. It does not submit.
6. Workflow verifies market readiness, available quote funds, existing order state, reservations and exact TradingRules.
7. Workflow creates a stable client order identity and submits through the trading port.
8. Adapter maps the canonical request to Binance WebSocket API and returns normalized acknowledgement/rejection/unknown outcome.
9. Acknowledgement updates order tracking only. It does not update economic accounting.

Repeated market ticks must not create duplicate BUY orders or duplicate reservations.

## 3. BUY execution and recovery SELL replacement

1. Broker sends an order update and one or more execution fills.
2. Adapter maps each fill to canonical `Fill` and `Commission` facts, preserving trade ID, order ID, market, side, exact price/quantity/quote quantity, liquidity role, execution time and commission completeness.
3. Application applies each fill idempotently to the fill ledger and inventory/accounting projection.
4. While the order is partially filled, record facts but do not advance the strategy to the next order decision (per the current V1 approved policy).
5. When the BUY is fully filled, reconcile the order's final state and all fills.
6. If a prior recovery SELL exists, request cancellation, then query final status and reconcile any fills that raced with cancellation.
7. Recompute active inventory, recovery amount, actual fees, reserved quantities and sellable quantity from the reconciled ledger.
8. Ask the pure SELL approval policy for a candidate. If no valid profitable SELL exists, remain safe and publish a diagnostic; do not force a sale.
9. Maintain the next standing BUY if the strategy state and available funds permit.
10. Submit a replacement recovery SELL only after the prior SELL is terminal and the new plan passes every gate.

A cancel response alone is not proof of zero fills. A timeout is an unknown outcome, not a failure that can be blindly retried.

## 4. SELL execution and free-coin allocation

See [sell-recovery-flow.mmd](./diagrams/sell-recovery-flow.mmd).

1. SELL fills are ingested and recorded individually with actual commission facts.
2. Partial SELL fills update the immutable execution ledger but do not allocate free coins or complete a recovery cycle.
3. On full SELL completion, reconcile all order fills and final status.
4. Calculate cumulative actual net proceeds and compare them with the approved recovery requirement and `minProfit`.
5. If the recovery condition is fully satisfied, transfer exactly the configured `keepQuantity` to the permanently retained free bucket once.
6. Any remaining active quantity stays in the strategy bucket; free inventory is excluded from all later order calculations.
7. If the order is canceled/expired/under-profitable, allocate no free quantity. Reconcile the remaining active position and require a new valid plan.
8. Publish the completion/diagnostic event only after the state transition has been accepted.

## 5. Fill accounting

See [execution-accounting-flow.mmd](./diagrams/execution-accounting-flow.mmd).

- A fill is an immutable economic fact; an order is a lifecycle object.
- Stream and REST history may deliver the same trade. Stable identity and exact fact comparison make application idempotent.
- An identical duplicate is ignored; the same identity with changed economics is an accounting discrepancy and pauses the market.
- Unknown commission status is not equivalent to zero commission.
- Quote/base commissions are accounted according to exact canonical fee asset identity.
- A known third-asset commission requirement rejects the market before trading. An unexpected third-asset commission is preserved as a fact, marks accounting incomplete and pauses the market without conversion or valuation.
- Configured commission percentages are planning assumptions/reserves only, never booked as actual execution fees.

## 6. Recovery after reconnect or restart

See [recovery-sequence.mmd](./diagrams/recovery-sequence.mmd).

1. On disconnect, stream gap, ambiguous order mutation, restart or mismatch, move the affected market to RECONCILING and block order mutations.
2. Restore the last durable state if a durable repository exists. In early in-memory-only milestones, restart recovery is not supported; do not pretend otherwise.
3. Fetch balances, open orders, tracked order history, fills and current trading rules from the broker with completeness/pagination metadata.
4. Validate order identity, fill identity, fee completeness, balance ownership, reservations and ledger invariants.
5. Backfill missing fills idempotently and compare local state with authoritative broker facts.
6. If every required fact is complete and consistent, persist the reconciled checkpoint and move to READY/ACTIVE according to reconstructed state.
7. If any required fact is missing or contradictory, remain PAUSED_UNSAFE and publish an actionable diagnostic. No automatic resume.

## 7. Notifications

See [notification-flow.mmd](./diagrams/notification-flow.mmd).

Application workflows publish stable events such as:
- `order.filled` — an order has reached full execution.
- `execution.fill-recorded` — a unique fill has been accepted into accounting.
- `market.paused` — market is unsafe, with a reason code and safe context.
- `market.reconciled` — recovery succeeded or remains blocked.
- `runtime.started`, `runtime.stopped`, `runtime.error`.

The notification mapper selects useful events, formats safe summaries and invokes Telegram. It must not forward raw exchange payloads, credentials or entire error objects. Telegram send failure is logged and isolated; it never changes the trading state or causes a fill to be unapplied.

## 8. Shutdown

1. Reject new strategy actions and stop market workflows.
2. Drain or safely terminate queued market tasks; preserve unresolved order outcomes as unknown.
3. Unsubscribe from market/user-data streams and disconnect broker clients.
4. Publish final safe summaries and runtime-stopped event.
5. Flush EventBus work.
6. Drain/unsubscribe Telegram notifier.
7. Flush/close Journal.
8. Persist final state if a durable repository is enabled.
9. Close EventBus and logger resources.

Use bounded shutdown waits and record failures. A timeout does not cancel the underlying operation; cleanup logic must not claim a resource was stopped if it may still be active.
