# Harvester controlled Binance Spot TESTNET validation runbook

> This is an execution and evidence checklist, not a strategy specification. All Conservative expected behavior is derived from [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). If a checklist statement differs, the canonical specification controls.

> **Execution gate: CLOSED / PAUSED.** This document is preparation only. Harvester must remain stopped until the operator and assistant explicitly begin an authorized joint TESTNET session. Offline CI is not exchange readiness. No order submission, cancellation, account-setting change, or other exchange write is authorized by this document.
>
> **Regional eligibility pause (2026-11-08):** The prior hosted Binance Spot TESTNET attempt returned HTTP 451 due to regional eligibility restrictions. This is an external environment limitation, not evidence of a Harvester code defect. The operator cannot change location; do not ask them to do so or repeatedly retry the same blocked path. TESTNET exchange acceptance remains UNVERIFIED and PAUSED until an eligible, authorized environment is available. Offline engineering, deterministic tests, and CI may continue independently. This note does not authorize live trading or any exchange write.
>
> **Pair-scope mismatch — hard hold (2026-11-09):** The last documented validation plan expected DOGEUSDT and ZROUSDT. Merged PR #836 historically changed the default configuration to disable both and enable only ZROFDUSD; the current `config/index.js` enables LINKFDUSD and ZROFDUSD. Neither configuration-only adjustment records a replacement TESTNET session plan. The old pair-specific limits and steps below are retained as historical context, not current instructions. Do not change the config, enable/disable pairs, or perform any exchange write until the pair scope is explicitly agreed, the config and runbook are reconciled, and a separate TESTNET session is authorized. This mismatch is independent of the regional eligibility pause.

## 1. Scope and hard limits

The last documented controlled validation plan targeted two Conservative pairs, DOGEUSDT and ZROUSDT, with one bounded recovery cycle per pair. That plan is superseded by the current committed configuration and is not an active or approved session scope.

Previous plan values (historical only; not current configuration or approved run limits):

| Setting | Previous plan value (historical) |
|---|---:|
| Enabled pairs | DOGEUSDT and ZROUSDT |
| Conservative | enabled |
| Aggressive | disabled |
| Pair investment cap | 100 USDT |
| BUY order quantity | 5 ZRO |
| Configured keepQuantity | 0.01 ZRO (previous plan) |
| Minimum net profit | 0.01 USDT |
| Price step | 0.05% |
| Maker fee assumption | 0.1% |
| Taker fee assumption | 0.1% |
| Other pairs (SOLFDUSD, ZROFDUSD) | disabled |

These values preserve the previous plan for provenance; they are not current repository configuration or approved run limits. The current committed `config/index.js` enables `LINKFDUSD` and `ZROFDUSD`: `investment: 200` FDUSD, `orderQuantity: 2` LINK, `keepQuantity: 0.01` LINK, `priceStepPercent: 0.3`, `makerPercent: 0`, and `takerPercent: 0.075`. The `LINKFDUSD` pair's `minProfit` is configured on that pair and is `0.01` FDUSD. These config values do not approve a TESTNET session. No replacement pair scope is recorded; keep the execution gate closed.

Hard operational limits for any future session (none is currently approved):

- Pair selection is unresolved. The previous plan targeted DOGEUSDT and ZROUSDT; the current config enables LINKFDUSD and ZROFDUSD. Do not enable or disable pairs to make these documents agree without an explicit scope decision.
- Exactly one Harvester process and one operator-controlled session.
- At most one active Harvester-owned BUY and one active recovery SELL per pair. A replacement SELL is allowed only after the previous SELL's terminal exchange state and all actual fills/commissions are reconciled.
- No manual orders during the run. This is a controlled validation/reproducibility constraint, not the normal runtime ownership policy: manual Binance Web/CScalp orders are ignored by default, but they can still change free balances and make exchange submissions fail. Record and classify every pre-existing/external open order before starting.
- The previous plan's 100 USDT per-pair / 200 USDT combined caps are historical only; no current TESTNET quote/base or combined limits are approved for ZROFDUSD.
- Do not infer or modify order quantity, investment, keep quantity, or fee assumptions. Any future session requires an explicitly agreed scope and limits.
- The previous one-cycle-per-pair target is not an active target until the pair scope is reconciled.
- No broad cancel-all command. A cancellation must identify a specific Harvester-owned order by symbol, exchange order ID, and client order ID, and be explicitly authorized during the joint session.
- No restart after an unknown submission outcome, disconnect, pause, incomplete reconciliation, or failed audit. Stop and investigate first.

## 2. Preconditions — all must pass before any write

1. Confirm PRs #513, #515, #545, #546, #552, #553, #554, and #559 are merged into `develop`; record the latest merge commit and verify required CI is green on the exact synchronized `develop` head. A historical green run on an earlier PR head is not sufficient.
2. Confirm the Harvester process is stopped. Check for any other process that could submit or manage orders using the same TESTNET account/API keys.
3. Confirm credentials target Binance Spot TESTNET only. Never load production credentials. Keep secrets out of logs, screenshots, commits, and chat.
4. For any future approved scope, verify the actual account maker/taker commission settings and each pair's configured fee assumptions against current exchange facts; the previous USDT plan assumed 0.1% / 0.1%, while the current LINKFDUSD config assumes maker 0% / taker 0.075%, and ZROFDUSD assumes maker 0% / taker 0.1%. Record the observation timestamp and evidence. The UI setting is only an expectation: actual per-trade commission amount and asset returned by Binance remain authoritative.
5. **Current hard blocker:** the latest `config/index.js` enables LINKFDUSD and ZROFDUSD, while the last documented plan expects DOGEUSDT and ZROUSDT. Do not edit the config or start a session until an explicit pair scope and per-pair limits are agreed and recorded in a superseding runbook section.
6. After scope reconciliation only, verify current exchange symbol filters for every pair in the newly agreed scope: tick size, step size, minimum quantity, minimum notional, supported order types, and current best bid/ask. Compare them with Harvester's runtime market-readiness validation. Any mismatch or unsupported rule blocks that pair and the joint run.
7. Verify the Journal is enabled, writable, ready, and durably flushable. Confirm the configured session directory is known, writable, and has adequate space. Every broker-connected startup, including read-only mode, must fail closed if either PREFLIGHT account event cannot be durably flushed.
8. Verify the read-only `journal:balance-audit` and `testnet:trades` diagnostics are available. Do not execute any write-capable script as a precondition.
9. Agree the session's start time, operator, assistant, every symbol in the explicitly approved scope, per-pair quote/base limits, combined quote limit, order-count limits, and stop conditions. If the pair scope or any limit is not explicit, do not start.

## 3. Read-only command reference

> The ZROUSDT-specific history/trade commands below are read-only references for the previous incident; ZROUSDT is currently disabled. They do not establish the next session's pair scope. The standalone `testnet:sell-zro` helper is a ZROUSDT MARKET SELL exchange write and is not authorized by this CLOSED / PAUSED runbook; do not invoke it. The `testnet:cancel-orders` helper is an account-wide cancellation write that proceeds automatically after a warning without interactive confirmation; it is also not authorized.

Run these commands from `apps/harvester` after confirming `.env.development` contains TESTNET-only credentials. These commands read account state; they do not submit or cancel orders.

```bash
# One-shot WebSocket account audit: balances + account-wide open orders, journaled as PREFLIGHT
pnpm run testnet:audit

# Optional individual read-only diagnostics
# Complete account inventory (all exchange-returned assets, including zero balances)
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

The primary account-audit evidence is the automatic PREFLIGHT audit performed by the normal broker-connected `pnpm run dev` startup. Do not run `pnpm run testnet:balances` or `pnpm run testnet:orders` repeatedly, and do not require a separate audit command before every dev start. `pnpm run testnet:audit` is an optional standalone read-only diagnostic only when an independent snapshot is specifically needed without starting Harvester; it creates a separate Journal session, flushes the two PREFLIGHT events, and disconnects without changing exchange state. Exit code 2 means the open-order ownership audit is BLOCKED by unowned orders, not that the audit failed or that trading startup is globally rejected. The individual balances/orders commands remain optional diagnostics; their output does not replace the automatic startup Journal evidence. Preserve the Journal session and classify pre-existing inventory/orders as external unless separately evidenced as Harvester-owned. The separate `journal:balance-audit` report is still for a closed Harvester session and is not a substitute for this live preflight.

## 4. Account baseline and ownership boundary

Before starting Harvester, its broker-connected startup audit (including read-only mode) collects and journals the authoritative configured-market account balances and all account-wide open orders automatically. The manual read-only commands in section 3 remain available for ad-hoc diagnosis, but are no longer a required repeated precondition. Preserve the two startup audit events from the same Journal session as the baseline evidence:

- `account.snapshot_captured`: configured-market base/quote assets (including disabled configured pairs) plus third-asset commission baselines actually used, with exact free/locked/total quantities and exchange source timestamp. Unrelated wallet assets are excluded.
- `account.open_orders_captured`: all account-wide open orders, including symbol, broker/client order IDs, side, type, price, original/executed quantity, status, and observation time.
- Historical incident evidence: relevant account trades for ZROUSDT, including trade ID, order ID, side, price, base quantity, quote quantity, commission amount, commission asset, and timestamp. ZROUSDT is not currently enabled.
- Any deposits, withdrawals, transfers, conversions, or manual trades relevant to the session window.
- Account commission setting and timestamp of verification.

The known account is pre-funded and contains many non-zero assets; the previous snapshot reported 517 non-zero assets. Do not treat account-wide ZRO or USDT balances as Harvester-owned inventory. Do not assume the account is clean. Existing balances and external orders remain outside Harvester's Portfolio/RecoveryLedger.

Record the exact baseline evidence and classify pre-existing orders as external/unowned. Do not cancel them as a cleanup shortcut. A pre-existing external order does not by itself block startup; its locked quantity must be reflected in the authoritative free/locked balance snapshot, and it must never be adopted or modified. If the account snapshot is incomplete or the available free balance is insufficient, the existing safety/commitment gates must prevent the affected trading action.

## 5. PREFLIGHT account audit and startup gate

The account baseline is captured automatically on every broker-connected Harvester startup, including read-only mode. You do not need to run `pnpm run testnet:balances` or `pnpm run testnet:orders` before a normal `dev` start. The engine object is composed before user-data subscription, but its `canTrade` gate remains closed. Before market-data subscriptions and before user-data readiness opens, Harvester fetches the configured-market-asset balance snapshot and account-wide open orders (without a symbol filter), writes both `account.snapshot_captured` and `account.open_orders_captured` with `phase: PREFLIGHT`, and waits for their durable-facts and Journal barriers. The balance allowlist covers every base/quote asset referenced by every configured pair, including disabled pairs, while excluding unrelated exchange-wallet assets. The raw PREFLIGHT broker balance list is retained only in a temporary in-memory lookup map so a later third-asset commission can be compared with its original baseline. A targeted `COMMISSION_BASELINE` event contains exactly one newly used third-asset fee balance, which is then included in subsequent tracked snapshots. The order event includes all currently open orders and a READY/BLOCKED ownership-audit decision. Any pre-existing open order is external/unowned. Under the owner-approved default `externalOrdersPolicy: "ignore"`, its presence alone does not reject trading startup; Harvester never adopts, cancels, or modifies an external order. An explicit `"block"` policy retains a same-symbol restriction, and unmatched Harvester-reserved `h-` orders remain fail-closed. Strategy commitments must still use authoritative free balances, and insufficient or incomplete balance data remains fail-closed. A failed or malformed balance/order query, failed event mapping/publication, or failed durable-facts/Journal barrier blocks every broker-connected startup. Same-process reconnect repeats the account/open-order audit with phase `RECOVERY` before acknowledging the broker generation. Trading-enabled graceful shutdown publishes a `CLOSING` account-balance audit after owned-order reconciliation; it does not publish a CLOSING open-orders snapshot.

1. Start only the agreed TESTNET configuration during the joint session.
2. Verify the process reports Conservative TESTNET trading enabled, not read-only or production.
3. Verify broker connection and user-data stream readiness.
4. Verify both durable PREFLIGHT records (balances and account-wide open orders) are recorded and flushed before market subscriptions or trading-engine activation.
5. Confirm the balance snapshot includes every base/quote asset referenced by every configured pair (enabled or disabled), with exact free, locked, and total quantities; unrelated wallet assets are excluded. Record the Journal session ID and exchange source timestamp separately from local capture time.
6. Inspect every entry in `account.open_orders_captured`, record its ownership, and confirm no external order is adopted or modified. `readiness: BLOCKED` caused solely by pre-existing external/unowned orders is an ownership-audit classification, not a global trading-startup rejection under the current policy. Trading still requires complete durable PREFLIGHT records, valid enabled-market metadata, and sufficient authoritative free balances; any failed or contradictory audit data remains fail-closed.
7. After the pair scope is explicitly reconciled, confirm the market rules, fee configuration, balances, and readiness for every approved pair.

**Abort before any order** while the pair-scope/config mismatch remains. After a replacement scope is documented, also abort if PREFLIGHT is absent, duplicated, malformed, not durable, incomplete, or cannot be tied to this session; if the PREFLIGHT account audit is incomplete, malformed, non-durable, or contradictory; if the enabled pair set differs from the newly recorded approved scope; or if the process logs an unresolved error.

## 6. Controlled order and execution sequence

The operator and assistant explicitly authorize each phase together. Do not treat this document as standing authorization.

1. For each enabled pair, observe its initial market price and calculated BUY intent. Verify symbol, side, order type, price tick, quantity step, notional, per-pair investment cap, client order ID, and post-only constraints before allowing submission.
2. Verify the exchange acknowledgement and correlate it to the exact client order ID and exchange order ID. There must be no duplicate active BUY.
   - **Specific regression-race observation:** record each strategy evaluation ID, order intent/client order ID, BUY limit price, `lastBuyPrice` before evaluation, canonical fill trade IDs, and the weighted execution price after reconciliation. A new BUY decision must not use the previous market price or an un-reconciled/empty reference after the preceding BUY has been acknowledged FILLED. A later BUY must be based on the preceding reconciled weighted execution price. If a second BUY is submitted while the prior FILLED acknowledgement's execution history is still being fetched/applied, or if the same BUY price is resubmitted from stale state, abort immediately and preserve evidence. Do not deliberately create twelve live orders to test this; the offline twelve-sequential-immediate-fill regression already exercises twelve transitions at a fixed market input, and the live session is bounded to one recovery cycle.
3. Reconcile every execution report against Binance WebSocket API order/trade history. For every fill, record trade ID, order ID, client order ID, side, price, base quantity, quote quantity, commission amount/asset/status, and event time.
4. Verify Portfolio and RecoveryLedger are updated exactly once for each canonical fill. Base-asset commissions affect net base inventory; quote-asset commissions affect net quote cash flow. Third-asset commission data requires reliable quote-currency valuation; otherwise fail closed. Never estimate actual realized fees from the configured percentage.
5. Verify the next standing BUY and recovery SELL against the canonical specification, reconciled position quantity/spent, cumulative net SELL proceeds, actual commissions, applicable fee reserve, exchange filters, available balances, and the one-BUY/one-SELL limit.
6. If a BUY fills while a recovery SELL is open, apply the BUY fill once, cancel only that identified owned SELL, reconcile its terminal state and every actual fill/commission (including fill-during-cancel), update accounting, and only then plan a replacement. If the SELL becomes FILLED during cancellation, process it as FILLED. Incomplete reconciliation fails closed.
7. Verify any partial fills and multiple fills are accumulated by unique trade ID and exact decimal arithmetic. A partial SELL without a new BUY must remain the same exchange order at the same price. Duplicate identical reports must not double count; conflicting duplicate facts or stale/incomplete WebSocket API history require a safe pause. Do not manufacture a cancel/fill race or exceed the one-cycle order limit to force a rare event. If partial-fill/cancel/late-event paths are not exercised naturally in this bounded session, record those live paths as NOT OBSERVED; the merged offline regression matrix remains evidence for implementation behavior, but it is not live exchange proof and cannot be reported as TESTNET acceptance.
8. After the recovery SELL is terminal, verify actual net proceeds, commissions, full accumulated cost recovery, the configured minimum net profit in the pair's quote asset, sell-through of all sellable inventory above exact configured keepQuantity, and exact retained allocation. If exchange-constrained dust remains, verify its exact quantity and limiting filter and that its original basis is preserved; do not treat it as extra retained inventory or reset the cycle while position quantity is above keepQuantity.
9. Stop after the first completed recovery cycle. Do not allow another cycle without a separate explicit decision.

Expected result: the symbol set, per-pair cycle count, and limits must be written into an approved scope section after the mismatch is resolved. Do not use the historical DOGEUSDT/ZROUSDT expected result. For each approved pair, retain the one-active-BUY/one-active-recovery-SELL invariant and finish with a deliberate, reconciled shutdown plan. No unexplained orders, fills, commissions, or accounting deltas are acceptable.

## 7. Reconciliation during and after execution

For each order, reconcile the user-data stream with WebSocket API order status and complete trade history. Do not infer fills solely from cumulative order status. Use exchange trade IDs as execution identity and verify each trade is applied once.

Reconcile these projections independently:

- Exchange gross execution facts: per-trade price, base quantity, quote quantity, order/trade identity.
- Actual commissions: exact amount, asset, and status for every trade.
- Harvester Portfolio: active/free base inventory and signed quote cash flow.
- RecoveryLedger: buy cost, net sell proceeds, outstanding recovery amount, and realized cycle profit.
- Journal: per-fill records, order lifecycle, recovery cycle completion, and per-session totals.
- Account balance movement: PREFLIGHT-to-current deltas for every tracked configured-market/commission asset; unrelated wallet-asset movement is outside the Harvester account-snapshot DTO and must be reconciled separately if relevant.

Portfolio/RecoveryLedger agreement does not by itself prove account-wide reconciliation. Account balance deltas do not by themselves prove PnL. Explain every difference using exact trade/commission facts, locked funds, open orders, external activity, and remaining inventory.

## 8. Graceful CLOSING and balance audit

1. During the joint session, agree whether any final Harvester-owned order must remain open. Prefer no outstanding owned orders for the first closed-session audit.
2. If an order must be canceled, authorize that exact order only, wait for the terminal acknowledgement, and reconcile all fills including cancel/fill races. Never use cancel-all.
3. Stop Harvester gracefully. Shutdown stops market-price/book intake and drains accepted market callbacks, reconciles owned orders before cancellation, cancels only acknowledged strategy-owned BUY orders once, keeps user-data intake active while cancellation-racing fills are processed, preserves all SELL orders, drains accepted user-data work, and performs a second owned-order reconciliation as verification only (there is no second BUY-cancellation pass). It then stops user-data intake and captures CLOSING while the broker WebSocket API remains connected.
4. Verify one durable CLOSING snapshot exists for the same Journal session and includes the configured-market base/quote assets plus third-asset commission baselines actually used, with exact free, locked, and total amounts. Unrelated wallet assets are excluded.
5. Verify CLOSING is COMPLETE. Known open SELL orders are expected to remain active and are not unresolved. If a BUY remains open, an order state is unknown, reconciliation fails, intake/accounting is unsafe, or flush fails, CLOSING must be INCOMPLETE; shutdown reports failure and retains the process lock.
6. Run the read-only `journal:balance-audit` against that closed session. Capture its full output and exit code.
7. Retrieve complete TESTNET trade history for the session window and verify pagination/completeness. Correlate every trade with the order journal and commission facts. Preserve raw read-only evidence securely.
8. Reconcile per-asset balance deltas against executions, commissions, open/locked orders, and external account activity. Reconcile cycle profit against exact Portfolio cash flow and RecoveryLedger totals. No unexplained residual is accepted.

## 9. Abort conditions

Immediately stop new order intake and do not restart or resubmit if any of the following occurs:

- Wrong environment, credentials, symbol, strategy, or enabled pair.
- PREFLIGHT account/open-order audit or its durable-facts/Journal acknowledgement missing/invalid; on reconnect, the equivalent RECOVERY barrier must also complete.
- More than one Harvester process or an unknown process can trade the account.
- Unexpected open order, unknown client order ID, or order not attributable to Harvester.
- More than one active BUY or one active recovery SELL, any second BUY submitted before the prior FILLED acknowledgement is fully reconciled, any repeated same-price BUY attributable to stale strategy state, or any order beyond the agreed cap.
- Order submission has an unknown outcome, acknowledgement identity mismatch, or duplicate active order.
- User-data disconnect, readiness loss, stale market data, or Binance WebSocket API request/response failure.
- Partial-fill/cancel race, request/response/stream disagreement, missing trade IDs, conflicting duplicate facts, or incomplete execution history.
- Missing, unknown, malformed, or unsupported commission asset/status.
- Portfolio, RecoveryLedger, Journal, or exchange facts disagree without a fully evidenced explanation.
- Insufficient balance, filter rejection, post-only rejection loop, unexpected fee, or any risk/limit breach.
- PREFLIGHT/RECOVERY/CLOSING durability failure, or CLOSING marked INCOMPLETE.

On abort: do not blindly retry or restart. While the process remains alive, its recovery path may perform a read-only canonical lookup by the original clientOrderId, then reconcile canonical order history and actual fills. This lookup never authorizes a retry or automatic resume. If the order cannot be resolved completely, keep the pair paused, stop the process, preserve logs and read-only exchange evidence, and investigate the exact clientOrderId/order history/trade history together before any cancellation or new order. A process stop does not cancel exchange orders.

## 10. Evidence checklist

Capture and retain, with secrets redacted:

- Session authorization and exact agreed limits.
- Git commit/PR and CI status used for the session.
- Effective environment mode and enabled-pair configuration.
- Exchange commission-setting evidence and timestamp.
- Market filters and initial best bid/ask.
- Read-only account baseline, all open orders, relevant trade history, and any clientOrderId lookup/order-history/fill reconciliation evidence from an unknown submission.
- PREFLIGHT account snapshot and durable-facts/Journal confirmation.
- Harvester startup/readiness logs.
- Every order intent, acknowledgement, cancellation authorization/result, execution report, WebSocket API request/response reconciliation result, and trade row.
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
- PREFLIGHT and COMPLETE CLOSING snapshots are durable and paired for a trading-enabled session.
- The read-only account balance audit has no unexplained deltas.
- No unknown or non-terminal Harvester-owned order remains unless explicitly documented and accepted.
- The operator and assistant review the evidence together and explicitly accept the result.

Until that review, TESTNET validation remains **NOT ACCEPTED**. Harvester remains stopped.

## 12. 2026-11-04 acknowledgement and shutdown-history follow-up

The latest incident involved ZROUSDT orders 698704, 698745, and 698746. Binance `myTrades` fills do not include `clientOrderId`; correlate them to the owned order through exchange order ID, market, and side. An absent fill client ID is expected; a present but conflicting ID is not. Binance `allOrders.orderId` is a lower-bound cursor, so canonical history must be filtered to the exact requested exchange order ID before shutdown reconciliation expects one record. Do not weaken order identity, side, market, order intent, status, or execution-quantity checks.

The engine must retain a known broker order ID even if immediate FILLED-ack execution-history reconciliation fails. Preserve the CanonicalOrder invariant that PENDING cannot carry a broker ID: represent the acknowledged-but-unreconciled order as UNKNOWN with zero reconciled quantity, keep the pair paused, apply later canonical events exactly once, and reconcile at shutdown by that broker ID. A paused pair must remain non-submittable even if broker connectivity/readiness is otherwise healthy.

The observed SELL 698745 cancellation follows the Conservative BUY-filled path: cancel the old recovery SELL, reconcile its fills, and wait for a subsequent eligible market event to evaluate a replacement against the new inventory. The supplied cancellation client ID `IR2BlFAQOVPlsCtcQqq2A5` cannot be attributed to Binance `c`, `C`, or a cancel request without the raw execution report; capture both fields in any future evidence. These offline fixes do not authorize live validation.

Exact accounting regression baseline: 9939 = 5 ZRO × 1.792 = 8.96 USDT gross, 0.005 ZRO commission; 9940 = 5 ZRO × 1.789 = 8.945 USDT gross, 0.005 ZRO commission. Combined net base 9.990 ZRO, buy cost/recovery 17.905 USDT, sell proceeds 0, realized net profit -17.905 USDT. Reconcile actual Journal records against these values during the next joint session.

### Offline contract checks added during PR #529 review

Canonical `allOrders` history must retain the requested order's exact identity and authoritative status. For the target row, require matching `symbol`, exchange `orderId`, Harvester `clientOrderId`, `side`, supported `type`, recognized non-empty `status`, exact `origQty`, and exact `executedQty` (plus `price` for limit orders). Missing `time`, `updateTime`, and unrelated Binance metadata are optional and must not invalidate an otherwise complete canonical order. A missing or unsupported status must fail closed; it must not silently become an UNKNOWN historical snapshot.

A cursor page may contain orders after the requested `orderId`; filter to the exact exchange order ID before adapting the target row. An absent target row is incomplete history, not proof that the order never existed. Shutdown reconciliation must require exactly one target row and independently match its immutable identity against the Harvester registry.

The offline regression suite also covers fill-history visibility lag: a FILLED acknowledgement with no currently visible trades remains UNKNOWN with the acknowledged broker order ID and zero reconciled quantity; the pair stays paused. Once exact trade history becomes visible, WebSocket API request/response reconciliation must match the order's cumulative executed quantity, apply each trade once, and leave the pause in place. Conflicting broker order ID, market, side, or a present-but-different client order ID is rejected before accounting.

These are offline tests only. They do not authorize or substitute for the separately controlled TESTNET validation.

## Startup PREFLIGHT account audit (all broker-connected modes)

The engine object is composed before user-data subscription, but its `canTrade` gate remains closed. Before market-data subscriptions and before user-data readiness opens, Harvester uses its existing broker connection to fetch the configured-market balance snapshot and account-wide open orders. It publishes `account.snapshot_captured` and `account.open_orders_captured` with phase `PREFLIGHT`, committing the account-snapshot durable fact before the Journal event and its durable flush. Verify both records in the Journal for every broker-connected dev startup, including read-only runs. Configuration-only startup without a broker does not query the exchange or perform this account audit. The balance event records exact free, locked, and total quantities for configured-market base/quote assets (including disabled configured markets) and any third-asset commission baseline actually used; unrelated wallet assets are excluded. The raw PREFLIGHT balance response is held only in a temporary in-memory lookup map. A targeted `COMMISSION_BASELINE` event records one newly used third-asset fee. Existing orders are external/unowned: the audit does not adopt or change them. A `BLOCKED` open-order audit caused only by manual/external orders is an ownership classification, not a global startup rejection under the default `externalOrdersPolicy: "ignore"`; the explicit `"block"` policy restricts the affected symbol, and unmatched Harvester-reserved `h-` orders remain fail-closed. Same-process reconnect repeats account and open-order audits with phase `RECOVERY`; trading-enabled graceful shutdown records a `CLOSING` account-balance audit but no CLOSING open-orders event. Any exchange query, event publication, or required durable-facts/Journal barrier failure blocks the relevant startup/recovery action. This audit is observational and does not authorize TESTNET order activity.

## Development diagnostic log evidence

For a development session, preserve the three independent logging destinations
alongside the Journal session:

- Terminal: INFO and higher by default.
- `logs/harvester.log`: DEBUG and higher, one structured JSON entry per line.
- `logs/harvester-trace.log`: TRACE and higher, one structured JSON entry per line.

Changing the terminal threshold with `/log info|debug|trace` does not change
either file threshold. Consecutive identical terminal entries are summarized;
changed values are shown, and both JSONL files retain every record. Capture both JSONL files when reviewing an incident;
they are diagnostic evidence and do not replace the durable Journal, canonical
exchange order/trade history, or account snapshots. Keep the files private:
the shared logger redacts recognized sensitive fields, but free-form messages
and stack text must not contain credentials or signed request data.

The logging refactor is observational only. It does not authorize a TESTNET
session, order submission/cancellation, or any account mutation.

## Recovery failure classification — offline contract

A broker `recovered` status is not evidence that Harvester is ready. Do not
interpret it as a successful application reconciliation. The acceptance
sequence remains canonical owned-order history and complete fills, queued
event drain, fresh balances and account-wide open orders, both durable
RECOVERY audit flushes, generation/event-sequence revalidation, exact broker
acknowledgement, and matching global `reconciled`.

The application distinguishes terminal integrity failures from retryable
workflow failures:

- Ownership/fill identity conflicts and accounting-projection/parity failures
  remain terminal and prevent acknowledgement.
- Order-transition, WebSocket API history, and Journal-durability failures keep
  readiness closed and can retry only after a new single-flight attempt
  repeats the full authoritative checks.
- Missing or unclassified failure metadata defaults to terminal fail-closed
  behavior.

A retryable failure observed while draining queued events aborts that recovery
attempt before broker acknowledgement. A later reminder starts a new attempt;
it does not merely clear a flag or resume trading. These are offline code/test
contracts, not TESTNET acceptance. The runbook execution gate remains
**CLOSED / PAUSED** and no live or TESTNET order operation is authorized.

## External open-order handling

Account-wide open orders are always audited and remain unowned/untouched unless their identity matches an already tracked Harvester order. Manual Binance Web/CScalp orders are ignored by default for strategy eligibility. Set `externalOrdersPolicy: "block"` on a pair to restore same-symbol blocking for manual/external orders. External execution reports under the default `"ignore"` policy are diagnostic-only and are never added to Portfolio or RecoveryLedger.

Harvester-generated client IDs use the reserved `h-` prefix. An unmatched open order or execution report in that namespace may belong to a previous Harvester process and remains fail-closed for its symbol regardless of the external-order policy; the production entry point also rejects a second process session while a prior ADR-0001 `PROCESS_STARTED` fact remains. Automatic runtime restoration is still not implemented. Manual trading can consume or add exchange inventory, so Harvester's independent strategy accounting does not guarantee that Binance will have sufficient free balance for every Harvester order. This is offline source/test behavior only; it does not authorize live/TESTNET operations or process restarts.
