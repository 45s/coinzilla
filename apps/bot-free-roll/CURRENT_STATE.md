# Free-Roll Current-State Audit

**Roadmap item:** FR-002  
**Application:** `apps/bot-free-roll`  
**Audited ref:** `main` at `8a1471b01d9e96a457aef58fa3836fb78aaa323c` (merge of PR #229)  
**Audit date:** 2026-10-30  
**Purpose:** Record observable implementation gaps before changing trading behavior.

> This is a source inspection, not a runtime certification. The repository files listed below were reviewed on the audited ref. Automated tests and coverage were not executed in this audit environment; see FR-004. Findings describe code paths, not live-exchange behavior.

---

## 1. Executive summary

The application has a useful event-driven skeleton, per-pair state, a keyed task queue, pause diagnostics, helper-level tests, and a Binance adapter that can retrieve order and trade history. However, the current bot is **not ready for real-money trading** and does not yet satisfy the roadmap's execution-truth, commission-truth, exact-financial-values, inventory, or recovery invariants.

The most important finding is that the exact quote-decimal helpers introduced by PR #228 are not consistently integrated into the bot's state updates. Some state fields are initialized as decimal strings but updated with JavaScript `+=`, which concatenates strings rather than adding decimal values. Other financial calculations convert those strings back to `Number`. This needs a focused regression-fix PR before building more accounting behavior on top.

The current fill path is order-status-driven and estimate-based. It does not build a canonical fill ledger from individual executions, does not deduplicate by trade ID, and does not use actual per-fill commission assets in strategy accounting.

## 2. Findings and gap matrix

Severity:
- **P0 — stop-ship:** can invalidate financial accounting or permit an unsafe trading decision.
- **P1 — high:** missing safety/recovery capability; must be addressed before live trading.
- **P2 — medium:** architecture, correctness, or maintainability gap that should be closed before release.

| ID | Severity | Area | Current evidence | Gap / consequence | Roadmap |
|---|---|---|---|---|---|
| AUD-001 | P0 | Decimal state integration | `src/bot/bot-free-roll.js`: `cycleCost`, `saleProceeds`, and `estimatedRealizedProfit` start as strings; buy/sell accounting updates use `+=`; sell plan converts cost/proceeds with `Number(...)`; completion builds `cycleCost + minProfit`. | String concatenation and Number conversion can corrupt cost/proceeds/P&L and invalidate profitability checks. PR #228 helpers are not applied consistently at these call sites. | FR-023, FR-039–045; fix regression before proceeding |
| AUD-002 | P0 | Actual fill accounting | `#handleOrderEvent` acts on `status === "FILLED"`; `#handleBuyFilled` estimates the full order from submitted quantity/price; `#recordSellFill` estimates from order price/quantity. | Partial executions and actual execution prices/quote quantities are not the source of truth. An order acknowledgement/status is being used to infer economics. | FR-027–030, FR-037 |
| AUD-003 | P0 | Commission asset handling | `estimateBuyAccounting` / `estimateSellAccounting` apply one configured fee rate; strategy event handler does not consume per-fill commission amount/asset. | Quote/base/third-asset commissions, zero fees, mixed fee assets, rebates, and unknown commission data are not accounted from actual fills. | FR-028, FR-031–035 |
| AUD-004 | P0 | SELL approval | `#placeSell` calls `calculateSellPlan` with Number-converted cost/proceeds and estimated fee rate, then submits directly. | No single independent validator proves the proposed SELL meets conservative net profit using complete actual accounting. No explicit fail-closed decision object/reason contract exists. | FR-047–050 |
| AUD-005 | P1 | Partial fills and deduplication | Bot tests include duplicate full BUY FILLED event coverage, but no trade-ID ledger; handler does not apply individual trade executions. | Order-level duplicate behavior is not equivalent to idempotent fill ingestion. Multiple partial fills, stream/history duplicate events, late/out-of-order events, and per-fill dedupe are not covered. | FR-029–030, FR-036 |
| AUD-006 | P1 | Cancel/replace reconciliation | `#cancelSell` infers fill quantity from the adapter's returned remaining quantity; `#replaceTrailingBuy` compares quantities using a floating-point epsilon; neither performs a trade-history reconciliation. | Fill-during-cancel and late execution races can leave local inventory/order state uncertain. A cancel response alone is not an authoritative fill ledger. | FR-054, FR-058–059, FR-065 |
| AUD-007 | P1 | Restart and startup safety | `run()` loads symbol increments and subscribes to user/price streams; no startup reconciliation of balances, open orders, trade history, or persisted bot state is performed. | A restart can begin with empty in-memory strategy state while exchange orders/inventory already exist. | FR-057–066 |
| AUD-008 | P1 | Exchange-neutral broker contract | Strategy calls `broker.getSymbolFilters()` and `subscribeForUserData()`; these are not declared by `CoreBroker`. `CoreBroker` currently contains only a small set of prototype methods. | Strategy depends on undocumented broker-specific capabilities; no shared canonical contracts or capability negotiation exist. | FR-007, FR-015–016 |
| AUD-009 | P1 | Binance adapter precision | `packages/brokers/src/binance/shared/adapt-order.js` converts `origQty`, `executedQty`, and `price` through unary `+`; returns an `Order` with remaining quantity. `getSymbolFilters()` converts tick/step strings to Number. | Exact exchange decimal strings are lost at the adapter boundary; order contract does not preserve original, executed, and remaining quantities separately. | FR-010–014, FR-019, FR-027 |
| AUD-010 | P1 | Trading rules | Binance `getSymbolFilters()` fetches `PRICE_FILTER` and `LOT_SIZE` only. Strategy silently falls back to configured precision when fetching filters fails. | Minimum/maximum quantity, min notional, percent-price bands, supported order types, and rule freshness are not represented. A fallback increment is not proof that an order satisfies current exchange rules. | FR-014, FR-022, FR-024 |
| AUD-011 | P1 | Market data quality | `#handlePrice` converts tick price to Number and checks only finite/positive; no source timestamp, freshness, sequence, gap, or quote validity check. | Stale or delayed price data can trigger orders; price decisions are not exact. | FR-020, FR-024 |
| AUD-012 | P1 | Inventory ownership | Bot stores active/free quantities as Numbers; reservations are represented by current buy/sell order references; there is no ledger for external inventory, locked amounts, fee debits, or cross-pair shared-asset reservations. | Local free/active/sellable quantities cannot be reconciled reliably with actual wallet ownership and order locks. | FR-013, FR-038, FR-043, FR-074–075 |
| AUD-013 | P2 | Domain entity suitability | `packages/entities/src/orders/order.js` requires Number quantity/price and models a single order; `ExecutedOrder` adds order-level commission/status only. `Coin` also stores Number quantity. | Existing entities do not yet express exact decimal money/quantity, individual fills, multiple commissions, balances, or trading rules. Reuse where suitable, but extend/add contracts deliberately rather than forcing fill data into order entities. | FR-007–014 |
| AUD-014 | P2 | Test coverage map | Relevant tests exist in `bot-free-roll.test.js`, `helpers.test.js`, `lifecycle.test.js`, broker SDK history tests, and entity tests. | Current tests cover helper calculations, selected lifecycle behavior, and raw history passthrough; they do not establish actual-fill/commission correctness or restart reconciliation. Coverage baseline and branch gaps remain unmeasured. | FR-004, FR-016, FR-027–086 |
| AUD-015 | P2 | CEX-specific adapter boundary | Binance SDK broker returns raw `getOrderHistory()` / `getMyTrades()` payloads; the strategy has no canonical trade-history/fill port. | Raw CEX records cannot yet be consumed by an exchange-neutral ledger. Adapter normalization is still required. | FR-015, FR-027, FR-036 |

## 3. Existing foundations worth preserving

- `FreeRollBot` already keeps state keyed by symbol and serializes tasks per pair with `createKeyedQueue`.
- Unexpected queued-task failures pause the affected pair and publish diagnostics.
- Event publication and logging failures are guarded in important paths.
- The bot uses separate broker and strategy packages at a high level.
- Binance SDK broker already exposes order history and personal trade history retrieval methods; current tests verify raw trade data, including commission fields, is returned.
- The app uses the native Node.js test runner and already has deterministic helper/lifecycle/bot tests.
- Decimal-string helpers `addDecimal`, `subtractDecimal`, `multiplyDecimal`, and `compareDecimal` exist after PR #228, but integration is incomplete.

Do not rewrite these foundations wholesale. Extend them in small PRs while preserving existing behavior unless a safety invariant requires a deliberate change.

## 4. Existing test map

| Test file | What it currently exercises | Important missing coverage |
|---|---|---|
| `apps/bot-free-roll/src/bot/helpers/helpers.test.js` | Buy threshold examples, tick/step rounding, estimated accounting, decimal helper examples, fee-rate selection, sell-plan examples | Strict decimal parser edge cases, all financial paths remaining string/exact, actual fees by asset, sell validator |
| `apps/bot-free-roll/src/bot/helpers/lifecycle.test.js` | Keyed queue ordering/error behavior and subscription cleanup (verify exact cases when baseline is run) | Queue shutdown/drain semantics, races and restart lifecycle |
| `apps/bot-free-roll/src/bot/bot-free-roll.test.js` | Bot orchestration with fake broker; pair pause; duplicate full BUY FILLED event behavior | Partial fills, actual trade IDs, commission assets, fill/history dedupe, sell cancellation races, restart/reconciliation |
| `packages/brokers/src/binance/broker-sdk/broker.history.test.js` | Raw Binance order/trade history passthrough, including commission amount/asset | Canonical fill normalization, pagination/cursor behavior, malformed payloads |
| `packages/entities/src/orders/*.test.js` | Existing Number-based Order/ExecutedOrder entity behavior | Exact amounts, fill/commission entities, stable fill identity, balance/rules contracts |

## 5. Recommended implementation sequence after this audit

1. **Immediate regression fix (before the fill ledger):** repair the bot's quote accounting call sites so decimal strings are combined with exact helpers, never `+=` or `Number(...)`. Add regression tests for repeated buy/sell accounting and the minimum-profit boundary. Keep the scope narrow; do not attempt the full ledger in the same PR.
2. **FR-003 decisions:** resolve cost-basis method, third-asset valuation policy, external/manual wallet activity, price source, and partial recovery/free-inventory allocation before implementing accounting semantics that depend on them.
3. **FR-004 baseline:** run app/workspace tests and coverage, record actual command output and critical uncovered paths.
4. **FR-007 audit existing entities:** determine which current entities can be safely reused and where new canonical Fill/Commission/Balance/TradingRules contracts belong.
5. **FR-027 onward:** normalize actual per-fill executions in the adapter, preserve commission facts, deduplicate by stable trade identity, and only then move strategy accounting to the ledger.

The immediate regression fix should be assigned a dedicated roadmap ID or explicitly pulled forward as a prerequisite to FR-023. Do not mark later accounting items complete merely because this narrow repair lands.

## 6. Commands for the baseline (not executed in this audit)

From the repository root:

- `pnpm --filter @coinzilla/bot-free-roll test` — app test suite.
- `pnpm --filter @coinzilla/bot-free-roll exec node --test --experimental-test-coverage` — app test coverage.
- `pnpm test` — all workspace package tests.
- `pnpm run check:syntax` — repository JavaScript syntax check.

Record the actual Node.js/pnpm versions and results under FR-004. Do not interpret an unexecuted command as a pass.

## 7. Audit conclusion

The current app is a useful prototype with testable helper and orchestration boundaries, but it is not yet safe to rely on for actual-profit accounting. Highest priority is fixing the incomplete decimal-string integration, then designing actual fill and commission contracts before changing the strategy's accounting model.

**This audit does not authorize live trading.** Keep real-money execution disabled until the roadmap release gates are satisfied and independently reviewed.
