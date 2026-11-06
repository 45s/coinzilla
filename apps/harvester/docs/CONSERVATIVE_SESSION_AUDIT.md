# Conservative Trading Session Audit

Use this checklist after **any** Harvester Conservative trading session. It is date-independent and evaluates what actually happened, not whether the process started, stayed online, or reported a completed cycle.

## Verdicts

Assign one verdict to every criterion:

- **FOLLOWED** — available evidence confirms the rule was respected.
- **VIOLATED** — evidence confirms the rule was broken.
- **UNVERIFIED** — evidence is missing, incomplete, or contradictory.

Never treat missing evidence as proof of compliance. Include relevant order IDs, trade IDs, timestamps, and calculations for every finding.

## Audit checklist

| # | Verify | What must be true |
|---|---|---|
| 1 | Initial BUY and trailing | The first BUY is one configured priceStepPercent below the first valid price. While in the initial trailing phase, upward replacement follows the configured step and only happens after cancellation is reconciled. |
| 2 | BUY execution and reference | Only confirmed fills change inventory or invested cost. A completed BUY is reconciled against all its fills. The next standing BUY uses the completed order's actual VWAP and is fixed one step below that reference while recovery is outstanding. |
| 3 | BUY order discipline | No duplicate active BUY is created. Partial fills, cancellation races, and uncertain outcomes are reconciled before another order is submitted. |
| 4 | Recovery SELL | SELL quantity excludes keepQuantity; price planning covers cumulative actual BUY cost, configured minProfit, and the configured fee reserve. Quantity is rounded down and price rounded up to exchange increments. |
| 5 | BUY/SELL sequencing | After a BUY is fully reconciled, the recovery SELL is submitted first. The next standing BUY is submitted only after successful SELL acknowledgement. A standing BUY and recovery SELL may then coexist. |
| 6 | Commissions and accounting | Actual exchange fills and actual commission amount/asset drive accounting. BUY quote commissions increase recovery cost; SELL quote commissions reduce net proceeds; base commissions affect inventory. Unsupported or incomplete commission facts must fail closed, not be assumed zero. |
| 7 | Recovery completion | A cycle completes only after a terminal fully filled SELL whose distinct reconciled fills equal the broker's executed and original quantities, all fills are accounted once, remaining active inventory is at least keepQuantity, and cumulative net SELL proceeds are at least cumulative BUY cost plus minProfit. |
| 8 | Retained inventory and reset | On successful recovery, exactly keepQuantity moves to free inventory; any excess remains active. Cycle totals reset only after successful completion. Free inventory is not sold as active strategy inventory. |
| 9 | Exchange and runtime safety | Orders respect exchange filters, balance/inventory availability, and POST-ONLY book checks where applicable. Stale/invalid prices, unknown outcomes, inconsistent fills, or unsafe reconciliation pause the affected pair rather than trigger guessed orders. |
| 10 | Final reconciliation | Exchange trade history, order history, Harvester accounting, and closing account evidence reconcile. Every balance/inventory difference is explained; unowned external inventory is not attributed to Harvester. |

## Evidence to collect

For each market audited, use the available evidence from:

- Exchange order history and individual trade/fill records (including commission amount and asset).
- Harvester order decisions, submissions, acknowledgements, cancellations, and execution events.
- The session's effective strategy configuration: priceStepPercent, orderQuantity, keepQuantity, minProfit, makerPercent, and applicable exchange filters.
- Opening/closing account snapshots and Harvester's fill-driven Portfolio/RecoveryLedger state.

Exchange fills are authoritative for what executed. Harvester logs and Journal records help explain decisions and processing, but they do not replace exchange execution facts or prove accounting correctness by themselves.

## Audit result

Summarize the session with:

- **Overall result:** FOLLOWED / VIOLATED / UNVERIFIED.
- **Confirmed violations:** criterion number, what happened, and supporting order/trade IDs.
- **Unverified criteria:** what evidence is missing.
- **Financial reconciliation:** actual BUY cost, actual net SELL proceeds, commissions by asset, realized net result, active inventory, and retained free inventory.
- **Conclusion:** whether the observed session followed the Conservative contract, and why.

A session is compliant only when every applicable criterion is FOLLOWED and the financial/account reconciliation is complete. Any VIOLATED criterion means the session was not fully compliant. Any UNVERIFIED criterion means compliance has not been established.

## Source of truth

This checklist is an audit aid, not a second strategy specification. Resolve exact behavior against the [Conservative Domain Specification](./domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) and [Harvester Trading Strategies](./trading-strategies.md). If this checklist conflicts with either source, the domain specification governs.
