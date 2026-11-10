# Harvester README Historical Material

- Status: archived
- Type: historical README material and superseded operational detail
- Owner: Harvester
- Archived: 2026-11-09
- Source commit: `7368e5b09ad914b9dc0d39b0813859ed3d1992a0`

> The following sections were removed from the Harvester entry-point README to keep it navigational. Their historical incident notes are preserved verbatim; operational details are superseded by the current canonical runbooks and Journal Operations guide.

- Current Journal procedures: [Journal Operations](../JOURNAL_OPERATIONS.md).
- Current TESTNET procedures: [TESTNET validation runbook](../TESTNET_VALIDATION_RUNBOOK.md) and [TESTNET order tools](../testnet-order-tools.md).
- Current audit authority: [Harvester audit index](README.md) and [Conservative audit](reports/AUDIT.md).

---

### 2026-11-04 TESTNET incident remediation

**BUY-burst clarification:** the twelve DOGEUSDT BUYs were twelve distinct exchange orders with distinct client IDs and broker order IDs; they were not duplicate IDs. All twelve nevertheless used the exact same 0.07598 USDT price and 400 DOGE quantity, executed as TAKER within roughly three seconds. A 12-order burst may be expected during a sharp price dump; twelve independently submitted orders at the identical price are the anomaly. The Conservative strategy interprets priceStepPercent: 0.05 as 0.05% and computes the next BUY from the last reconciled BUY execution price. The repeated identical price is consistent with submissions occurring before the previous BUY fill had updated strategy state. PR #513 adds the immediate-FILLED acknowledgement reconciliation barrier; review and test the non-terminal acknowledgement followed by streamed FILLED/TRADE event path as well. Do not describe this as a client-ID collision or treat the burst count alone as proof of a defect.

PR #513 is a historical incident-remediation checkpoint. Its original residual-suppression behavior is superseded by the current Conservative implementation: residual inventory above `keepQuantity` is sold through when exchange-sellable, while only validated exchange-constrained dust is retained as a keepQuantity bonus. The current lifecycle, commission, dust, and completion implementation is tracked in PR #653 and the current [audit closure](reports/AUDIT.md). CI/test verification remains pending, and no TESTNET restart is authorized by this documentation.


### Follow-up execution-history validation

PR #513 now rejects conflicting duplicate canonical fill records during immediate-FILLED acknowledgement reconciliation. Previously, the path deduplicated by fill ID without comparing payloads; it now pauses the pair if the same ID appears with different Fill.value data. A regression test verifies that no fill is applied before this conflict is rejected.


### TESTNET commission configuration note — 2026-11-04

The Binance Spot TESTNET account initially showed **Commissions: None**. The operator changed the account setting to **0.1% maker & taker** (shown in the later screenshot). Historical incident trades report zero commission; do not retroactively apply 0.1% to them. For future trades, verify the setting is active and reconcile actual per-trade commission amount and asset from Binance. The setting is account-wide across the API keys on that TESTNET account. Harvester must account for actual fees in net-profit and recovery calculations; a configured rate is not a substitute for execution-level commission facts.

### Incident review status — 2026-11-04 (follow-up PR #515)

The previous CI run checked an earlier PR merge ref and failed one Harvester regression because it still expected a successful result for an invalid MIN_NOTIONAL intent. The current branch test now asserts the intended contract: `processMarketPrice()` returns `ok: false` with the MIN_NOTIONAL validation error, pauses the pair once, and does not reevaluate on later ticks. A fresh CI run must verify the exact current PR head before merge.

The earlier maker-only fee-reserve finding is superseded by the fee/order-type policy in the canonical Conservative specification. Tests cover zero, maker-higher, taker-higher, equal, and invalid fee rates. Actual exchange commissions remain authoritative for realized accounting.

The remaining lifecycle overlap matrix and a future closed-session account-baseline audit are follow-up work, not blockers to merging the completed source remediation. Keep Harvester stopped; merge does not authorize TESTNET restart or order submission.


### Incident audit logging requirement — 2026-11-04

The Harvester TESTNET Journal initially appeared to show a +0.20730 USDT discrepancy because the final recovery.cycle_completed event reported +0.36335 while the exchange's session-wide quote cash flow was +0.57065. Reconciliation of all five cycle events resolves this exactly: the previous four cycles sum to +0.20730 and all five sum to +0.57065. Historical exchange executions reported zero commission; the later 0.1% maker/taker setting is not retroactive.

The merged PR #513 source emits structured DEBUG traces for strategy evaluation and every accounting fill. These logs are diagnostic evidence; the durable Journal must not be assumed to contain them. For any incident reconciliation, correlate by exchange trade ID and verify gross quote, actual commission asset/amount, Portfolio cash-flow changes, RecoveryLedger cost/proceeds, cycle completion/reset, and Journal aggregation. Recovery-completion trace and end-to-end journal arithmetic reconciliation remain part of the PR #515 offline verification scope; a future controlled TESTNET run remains separately gated.


### Account-level balance audit

Every explicitly enabled Conservative TESTNET session records an OPENING snapshot before the trading engine can submit its first order and a CLOSING snapshot during graceful shutdown, before broker disconnect. The snapshot includes all assets referenced by configured pair base/quote currencies (enabled or disabled), with exact free, locked, and total quantities; unrelated wallet assets are excluded. A closing snapshot is marked INCOMPLETE when owned-order reconciliation fails, an owned order remains non-terminal, intake fails, or user-data/accounting state is unresolved.

The pure reconcileAccountSnapshotDeltas helper computes exact per-asset free/locked/total changes from OPENING and CLOSING events, including assets that appear or disappear, and propagates INCOMPLETE audit reasons. Balance deltas are an independent account-level cross-check, not a standalone proof of strategy profit. Reconcile every asset delta against executions and commissions, deposits/withdrawals/transfers, other account activity, and the valuation of remaining inventory in a common quote currency. Trade-level fill accounting remains authoritative for realized strategy PnL. Unknown external activity or open orders makes the account-level result incomplete.

### Compare persisted opening and closing balances

After a graceful shutdown, run the read-only Journal audit command from the Harvester app directory:

```bash
pnpm run journal:balance-audit
```

Pass a Journal directory as the first argument when using a non-default location:

```bash
pnpm run journal:balance-audit -- ./logs
```

The command groups records by JSONL session and reports exact per-asset free, locked, and total balance deltas. It exits non-zero if a session is missing either snapshot, has duplicate endpoints, or carries an INCOMPLETE closing audit. The command is read-only and never modifies Journal sessions. It deliberately does not convert these deltas into a profit figure; executions, commissions, external transfers, and remaining inventory valuation still require reconciliation.
