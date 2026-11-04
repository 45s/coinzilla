# Harvester controlled Binance Spot TESTNET validation runbook

> **Execution gate: CLOSED.** This document is preparation only. Harvester must remain stopped until the operator and assistant explicitly begin the joint TESTNET session. Offline CI is not exchange readiness. No order submission, cancellation, account-setting change, or other exchange write is authorized by this document.

## 1. Scope and hard limits

The first controlled validation is one Conservative pair and one bounded recovery cycle. Do not enable multiple pairs, Aggressive mode, production credentials, or unattended/repeating operation.

Current committed configuration to verify before the session:

| Setting | Expected value |
|---|---:|
| Enabled pair | ZROUSDT only |
| Conservative | enabled |
| Aggressive | disabled |
| Pair investment cap | 100 USDT |
| BUY order quantity | 5 ZRO |
| Free keep quantity | 0.01 ZRO |
| Minimum net profit | 0.01 USDT |
| Price step | 0.05% |
| Maker fee assumption | 0.1% |
| Taker fee assumption | 0.1% |
| Other pairs | disabled |

These are repository configuration expectations, not proof of the live TESTNET account setting or exchange filters. Re-read the exact branch configuration and current exchange market rules at session start. If any value differs, stop and agree a revised limit before enabling trading.

Hard operational limits for the first session:

- Exactly one enabled symbol: ZROUSDT.
- Exactly one Harvester process and one operator-controlled session.
- At most one active Harvester-owned BUY and one active Harvester-owned recovery SELL at a time. A replacement SELL is allowed only after the previous SELL's cancellation is confirmed and its fills are reconciled.
- No manual orders during the run. Record and classify every pre-existing/external open order before starting.
- Never exceed the configured 100 USDT pair investment cap or available free quote balance; the smaller limit wins.
- Do not increase order quantity, investment, keep quantity, or fee assumptions during the session.
- One complete BUY → recovery SELL → cycle-completion sequence is the target. Do not continue into an additional cycle unless separately agreed after reviewing the first.
- No broad cancel-all command. A cancellation must identify a specific Harvester-owned order by symbol, exchange order ID, and client order ID, and be explicitly authorized during the joint session.
- No restart after an unknown submission outcome, disconnect, pause, incomplete reconciliation, or failed audit. Stop and investigate first.

## 2. Preconditions — all must pass before any write

1. Confirm PR #515 is merged into `develop`, the merge commit is recorded, and required CI is green on the synchronized merge result.
2. Confirm the Harvester process is stopped. Check for any other process that could submit or manage orders using the same TESTNET account/API keys.
3. Confirm credentials target Binance Spot TESTNET only. Never load production credentials. Keep secrets out of logs, screenshots, commits, and chat.
4. Verify the account's maker/taker commission setting is 0.1% / 0.1%; record the observation timestamp and evidence. This UI setting is only an expectation: actual per-trade commission amount and asset returned by Binance remain authoritative.
5. Verify the latest `trading-config.json` matches the table above. Verify only ZROUSDT is enabled and Conservative is the only enabled strategy.
6. Verify current exchange symbol filters: tick size, step size, minimum quantity, minimum notional, supported order types, and current best bid/ask. Compare them with Harvester's runtime market-readiness validation. Any mismatch or unsupported rule blocks the run.
7. Verify the Journal is enabled, writable, ready, and durably flushable. Confirm the configured session directory is known, writable, and has adequate space. Trading startup must fail closed if OPENING cannot be durably flushed.
8. Verify the read-only `journal:balance-audit` and `testnet:trades` diagnostics are available. Do not execute any write-capable script as a precondition.
9. Agree the session's start time, operator, assistant, exact symbol, quote/base limits, order-count limit, and stop conditions. If any limit is not explicit, do not start.

## 3. Read-only command reference

Run these commands from `apps/harvester` after confirming `.env.development` contains TESTNET-only credentials. These commands read account state; they do not submit or cancel orders.

```bash
# Full non-zero account inventory (all assets)
pnpm run testnet:balances

# Every currently open order on the account (all symbols)
pnpm run testnet:orders

# Recent ZROUSDT order history (up to 1,000 orders)
pnpm run testnet:history ZROUSDT 1000

# Actual ZROUSDT trades with trade IDs and actual commission facts (up to 1,000 rows)
pnpm run testnet:trades ZROUSDT 1000

# Audit the closed Journal session; default directory is ./logs from apps/harvester
pnpm run journal:balance-audit -- logs
```

The trade command accepts an optional third `FROM_ID` argument:
`pnpm run testnet:trades ZROUSDT 1000 FROM_ID`. If exactly 1,000 rows are returned, retrieve subsequent pages using the next page's first uncollected trade ID (last returned trade ID + 1), preserve every page, and verify there are no gaps or duplicates. A response shorter than the requested limit is not, by itself, proof that all historical account trades were retrieved; bound the query to the session time window and compare against order history and Journal evidence. The order-history command has no cursor argument; use it for recent order inspection, not as a substitute for complete trade-history pagination.

**Never run `pnpm run testnet:cancel-orders` as part of this runbook.** That script cancels every open order across every symbol, including manual/external orders. It violates this runbook's ownership and exact-order cancellation rules. No command in the precondition/baseline procedure is allowed to perform an exchange write.

The account-balance and open-order commands return account-wide state. Preserve every asset/order row and classify pre-existing inventory/orders as external unless separately evidenced as Harvester-owned. The Journal audit is local/read-only and must be run only after graceful shutdown has durably written CLOSING.

## 4. Account baseline and ownership boundary

Before starting Harvester, collect read-only evidence:

- Account balances for every returned asset, including exact free and locked amounts.
- Open orders across the account, including symbol, order ID, client order ID, side, price, original/executed quantity, status, and time.
- Relevant recent account trades for ZROUSDT, including trade ID, order ID, side, price, base quantity, quote quantity, commission amount, commission asset, and timestamp.
- Any deposits, withdrawals, transfers, conversions, or manual trades relevant to the session window.
- Account commission setting and timestamp of verification.

The known account is pre-funded and contains many non-zero assets; the previous snapshot reported 517 non-zero assets. Do not treat account-wide ZRO or USDT balances as Harvester-owned inventory. Do not assume the account is clean. Existing balances and external orders remain outside Harvester's Portfolio/RecoveryLedger.

Record the exact baseline evidence and classify pre-existing orders as external. Do not cancel them as a cleanup shortcut. If an external open order could affect ZROUSDT available balance or ownership attribution, the session is blocked until the operator decides how to handle it.

## 5. OPENING snapshot and startup gate

1. Start only the agreed TESTNET configuration during the joint session.
2. Verify the process reports Conservative TESTNET trading enabled, not read-only or production.
3. Verify broker connection and user-data stream readiness.
4. Verify the durable OPENING account snapshot is recorded and flushed before the trading engine can activate or market data can trigger an order.
5. Confirm the OPENING snapshot includes every broker-returned asset with exact free, locked, and total quantities, and that the Journal session ID and timestamp are recorded.
6. Confirm the Journal contains exactly one valid OPENING endpoint for this session.
7. Confirm ZROUSDT market rules, fee configuration, balances, and readiness are accepted. Confirm all other pairs remain disabled.

**Abort before any order** if OPENING is absent, duplicated, malformed, not durable, incomplete, or cannot be tied to this session; if readiness is not READY; if any unexpected pair is enabled; or if the process logs an unresolved error.

## 6. Controlled order and execution sequence

The operator and assistant explicitly authorize each phase together. Do not treat this document as standing authorization.

1. Observe the initial market price and calculated BUY intent. Verify symbol, side, order type, price tick, quantity step, notional, investment cap, client order ID, and post-only constraints before allowing submission.
2. Verify the exchange acknowledgement and correlate it to the exact client order ID and exchange order ID. There must be no duplicate active BUY.
2a. **Specific regression-race observation:** record each strategy evaluation ID, order intent/client order ID, BUY limit price, `lastBuyPrice` before evaluation, canonical fill trade IDs, and the weighted execution price after reconciliation. A new BUY decision must not use the previous market price or an un-reconciled/empty reference after the preceding BUY has been acknowledged FILLED. A later BUY must be based on the preceding reconciled weighted execution price. If a second BUY is submitted while the prior FILLED acknowledgement's execution history is still being fetched/applied, or if the same BUY price is resubmitted from stale state, abort immediately and preserve evidence. Do not deliberately create twelve live orders to test this; the offline twelve-sequential-immediate-fill regression already exercises twelve transitions at a fixed market input, and the live session is bounded to one recovery cycle.
3. Reconcile every execution report against REST order/trade history. For every fill, record trade ID, order ID, client order ID, side, price, base quantity, quote quantity, commission amount/asset/status, and event time.
4. Verify Portfolio and RecoveryLedger are updated exactly once for each canonical fill. Base-asset commissions affect net base inventory; quote-asset commissions affect net quote cash flow. Unknown, malformed, or unsupported third-asset commission data must fail closed; never estimate realized fees from the configured percentage.
5. Verify the next standing BUY and recovery SELL are consistent with the reconciled fills, outstanding recovery amount, fee reserve, tick/quantity rules, available balances, and the one-BUY/one-SELL limit.
6. If a BUY fills while a recovery SELL is open, verify cancellation is limited to that identified owned SELL. Wait for the cancellation acknowledgement and reconcile any fills that raced with cancellation before allowing a replacement SELL.
7. Verify any partial fills and multiple fills that occur are accumulated by unique trade ID and exact decimal arithmetic. Duplicate identical reports must not double count; conflicting duplicate facts or stale/incomplete REST history require a safe pause. Do not manufacture a cancel/fill race or exceed the one-cycle order limit to force a rare event. If partial-fill/cancel/late-event paths are not exercised naturally in this bounded session, record those live paths as NOT OBSERVED; the merged offline regression matrix remains evidence for implementation behavior, but it is not live exchange proof and cannot be reported as TESTNET acceptance.
8. After the recovery SELL is fully filled, verify actual net proceeds, commissions, recovery completion, realized net profit, and allocation of exactly 0.01 ZRO to free inventory. Any additional residual must remain correctly classified; it must not create a new recovery SELL after the ledger is reset.
9. Stop after the first completed recovery cycle. Do not allow another cycle without a separate explicit decision.

Expected result: one complete controlled BUY/fill → recovery SELL/fill → recovery completion, with a single active next BUY only if the agreed scenario requires it and the operator explicitly elects to leave it open. Otherwise, the session must finish with a deliberate, reconciled shutdown plan. No unexplained orders, fills, commissions, or accounting deltas are acceptable.

## 7. Reconciliation during and after execution

For each order, reconcile the user-data stream with REST order status and complete trade history. Do not infer fills solely from cumulative order status. Use exchange trade IDs as execution identity and verify each trade is applied once.

Reconcile these projections independently:

- Exchange gross execution facts: per-trade price, base quantity, quote quantity, order/trade identity.
- Actual commissions: exact amount, asset, and status for every trade.
- Harvester Portfolio: active/free base inventory and signed quote cash flow.
- RecoveryLedger: buy cost, net sell proceeds, outstanding recovery amount, and realized cycle profit.
- Journal: per-fill records, order lifecycle, recovery cycle completion, and per-session totals.
- Account balance movement: OPENING-to-current deltas for every asset, with external orders/trades/transfers explicitly accounted for.

Portfolio/RecoveryLedger agreement does not by itself prove account-wide reconciliation. Account balance deltas do not by themselves prove PnL. Explain every difference using exact trade/commission facts, locked funds, open orders, external activity, and remaining inventory.

## 8. Graceful CLOSING and balance audit

1. During the joint session, agree whether any final Harvester-owned order must remain open. Prefer no outstanding owned orders for the first closed-session audit.
2. If an order must be canceled, authorize that exact order only, wait for the terminal acknowledgement, and reconcile all fills including cancel/fill races. Never use cancel-all.
3. Stop Harvester gracefully. Shutdown must stop new intake, drain accepted user-data work, reconcile all owned orders, and capture CLOSING while broker REST is still available.
4. Verify one durable CLOSING snapshot exists for the same Journal session and includes every returned asset with exact free, locked, and total amounts.
5. Verify CLOSING is COMPLETE. If reconciliation fails, an owned order remains non-terminal, intake/accounting is unsafe, or flush fails, CLOSING must be INCOMPLETE and the audit fails closed.
6. Run the read-only `journal:balance-audit` against that closed session. Capture its full output and exit code.
7. Retrieve complete TESTNET trade history for the session window and verify pagination/completeness. Correlate every trade with the order journal and commission facts. Preserve raw read-only evidence securely.
8. Reconcile per-asset balance deltas against executions, commissions, open/locked orders, and external account activity. Reconcile cycle profit against exact Portfolio cash flow and RecoveryLedger totals. No unexplained residual is accepted.

## 9. Abort conditions

Immediately stop new order intake and do not restart or resubmit if any of the following occurs:

- Wrong environment, credentials, symbol, strategy, or enabled pair.
- OPENING snapshot or durable Journal flush missing/invalid.
- More than one Harvester process or an unknown process can trade the account.
- Unexpected open order, unknown client order ID, or order not attributable to Harvester.
- More than one active BUY or one active recovery SELL, any second BUY submitted before the prior FILLED acknowledgement is fully reconciled, any repeated same-price BUY attributable to stale strategy state, or any order beyond the agreed cap.
- Order submission has an unknown outcome, acknowledgement identity mismatch, or duplicate active order.
- User-data disconnect, readiness loss, stale market data, or broker REST failure.
- Partial-fill/cancel race, REST/stream disagreement, missing trade IDs, conflicting duplicate facts, or incomplete execution history.
- Missing, unknown, malformed, or unsupported commission asset/status.
- Portfolio, RecoveryLedger, Journal, or exchange facts disagree without a fully evidenced explanation.
- Insufficient balance, filter rejection, post-only rejection loop, unexpected fee, or any risk/limit breach.
- OPENING/CLOSING durability failure or CLOSING marked INCOMPLETE.

On abort: do not blindly retry or restart. Preserve logs and read-only exchange evidence; identify all Harvester-owned orders by exact IDs; determine whether any submission/fill is unresolved; and agree the smallest safe recovery action before any cancellation or new order. A process stop does not cancel exchange orders.

## 10. Evidence checklist

Capture and retain, with secrets redacted:

- Session authorization and exact agreed limits.
- Git commit/PR and CI status used for the session.
- Effective environment mode and enabled-pair configuration.
- Exchange commission-setting evidence and timestamp.
- Market filters and initial best bid/ask.
- Read-only account baseline, all open orders, and relevant trade history.
- OPENING snapshot and durable Journal confirmation.
- Harvester startup/readiness logs.
- Every order intent, acknowledgement, cancellation authorization/result, execution report, REST reconciliation result, and trade row.
- Per-fill commission amount/asset/status and Portfolio/RecoveryLedger before/after evidence.
- Cycle completion record and realized net profit.
- CLOSING snapshot, completeness status, balance-audit output/exit code, and final trade-history completeness evidence.
- Final list of any remaining open orders and their ownership.

Redact API keys, signatures, secrets, and sensitive account identifiers. Do not upload credentials or signed requests.

## 11. Final acceptance

The controlled TESTNET session passes only when:

- Exactly the agreed one-pair/one-cycle limits were respected, with no duplicate/stale same-price BUY burst and every subsequent BUY reference derived from the preceding reconciled weighted fill price.
- Every order and trade is attributable and reconciled.
- Actual commissions are accounted for exactly.
- Portfolio, RecoveryLedger, Journal, and exchange execution facts agree.
- OPENING and COMPLETE CLOSING snapshots are durable and paired.
- The read-only account balance audit has no unexplained deltas.
- No unknown or non-terminal Harvester-owned order remains unless explicitly documented and accepted.
- The operator and assistant review the evidence together and explicitly accept the result.

Until that review, TESTNET validation remains **NOT ACCEPTED**. Harvester remains stopped.
