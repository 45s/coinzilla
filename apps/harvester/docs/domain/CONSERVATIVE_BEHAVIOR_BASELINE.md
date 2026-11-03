# Conservative Behavior Baseline

**Owner:** Harvester domain  
**Status:** Behavioral contract for the Conservative strategy  
**Purpose:** Keep the strategy rules understandable and maintainable without depending on any separate application, repository path, or historical implementation.

## Core model

Conservative is a standing-order accumulation strategy. It repeatedly buys base asset below the market, recovers the quote capital spent through a recovery SELL, earns at least the configured minimum profit, and retains the configured base quantity as free inventory.

A standing BUY and a recovery SELL may be active at the same time. This is intentional strategy behavior, not an accidental duplicate-order condition.

## BUY lifecycle

1. On the first valid market price, submit an initial BUY limit one configured price step below that price.
2. While this initial BUY is active, trail it upward as the market rises. Cancel and reconcile the old order before placing a replacement.
3. Once a BUY has filled, calculate the next standing BUY one configured step below the last BUY fill price. Do not trail this subsequent BUY while recovery is outstanding.
4. Apply only confirmed execution fills to inventory and recovery cost. Partial fills update accounting incrementally, but do not trigger the completed-order transition until the order is fully reconciled.
5. After the BUY is fully reconciled, submit or replace the recovery SELL first. Submit the next standing BUY only after recovery SELL submission succeeds.

## Recovery SELL lifecycle

- Accumulate actual BUY quote cost, including quote-asset commissions.
- Accumulate actual net SELL proceeds, subtracting quote-asset commissions.
- Plan SELL quantity from active strategy inventory after reserving the retained quantity and a conservative base-fee allowance.
- Round SELL quantity down to the exchange quantity step and SELL price up to the price tick.
- A planning fee reserve is not an actual booked expense. Actual confirmed commission facts control accounting.
- Reconcile partial SELL fills before cancellation or replacement. Replacements do not reset cycle accounting.
- A recovery cycle completes only when the SELL is terminal and fully reconciled, net proceeds cover BUY cost plus minimum profit, and the required retained inventory remains available.
- On successful completion, allocate the retained quantity to free inventory, reset cycle recovery totals and per-cycle fee observations according to the approved fee policy, and resume trailing for the next standing BUY.
- If the profit target, inventory requirement, fill reconciliation, or order outcome is uncertain, pause safely and preserve the accounting state.

## Accounting rules

For gross base quantity q, gross quote notional v, base commission cb, and quote commission cq:

| Execution | Active base delta | Recovery quote accounting |
|---|---:|---:|
| BUY | +(q - cb) | buyCost += v + cq |
| SELL | -(q + cb) | netSellProceeds += v - cq |

- A duplicate fill with identical facts is a no-op.
- Reuse of a fill identity with conflicting facts is rejected.
- Missing or incomplete commission facts are not treated as zero.
- Unsupported third-asset commissions fail closed until a valuation policy is explicitly designed.
- Strategy-owned inventory is separate from external/manual account inventory.
- A SELL must never consume more active strategy inventory than is available.

## Harvester implementation alignment

The current Harvester domain already has Portfolio, RecoveryLedger, fill fingerprints, recovery SELL planning, and completion checks. The next work should compare one concrete behavior at a time against this baseline.

Known areas to verify in focused steps:
1. Initial BUY trailing and safe cancel/reconcile/replace.
2. SELL-before-next-BUY submission ordering and pause behavior when SELL submission fails.
3. Fee reserve activation and reset timing.
4. Recovery completion with zero retained quantity and residual active inventory.
5. Commission-entry validation and exact fill reconciliation.
6. Atomic visibility when Portfolio and RecoveryLedger apply the same fill.

These are implementation alignment tasks, not a request to redesign the strategy or reopen every financial rule. Keep any genuine product ambiguity narrow and discuss it before changing behavior.

## Related documents

- [Conservative Domain Specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md)
- [Accounting Invariants](./ACCOUNTING_INVARIANTS.md)
- [Domain Glossary](./DOMAIN_GLOSSARY.md)
