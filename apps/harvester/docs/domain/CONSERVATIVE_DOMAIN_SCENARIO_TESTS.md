# Conservative domain scenario tests

## Purpose and authority

This document contains Conservative-specific scenario examples and the conceptual lifecycle model used by the Conservative scenario initiative.

The strategy-neutral test design, fixture, state-transition proof, accounting-oracle, adversarial coverage, and evidence methodology are defined in the shared [Domain Scenario Testing Methodology](../../../../docs/testing/DOMAIN_SCENARIO_TESTING.md). Do not duplicate or redefine that method here.

The canonical trading contract remains the [Conservative Domain Specification](CONSERVATIVE_DOMAIN_SPECIFICATION.md). This document does not introduce or redefine strategy rules. Coverage tracking and implementation work are owned by [issue #1763](https://github.com/45s/coinzilla/issues/1763).

## Conservative scenario examples

### Initial BUY fill

A scenario should make every financially relevant input explicit. For example, the test fixture may represent DOGEUSDT, configured order quantity 400, BUY execution price 0.10, configured maker/taker fee rates, actual commission amount and asset, minProfit, keepQuantity, order type, price tick, quantity step, minimum/maximum quantity and notional, and current market price.

After applying a valid canonical BUY Fill to the real Portfolio and RecoveryLedger and evaluating the real Conservative policy, assert:

- The strategy-owned Position quantity and spent amount reflect the fill and commission asset rules.
- RecoveryLedger has the canonical accepted fill and correct recovery accounting.
- A recovery SELL intent exists with the exact expected quantity and price/economic target, respecting retained quantity, fee reserve, and exchange filters.
- No next standing BUY intent exists while the Position or RecoveryLedger still represents the active recovery cycle.
- The recovery SELL intent has the exact expected quantity and price/economic target, respecting retained quantity, fee reserve, and exchange filters.
- A new BUY becomes eligible only after terminal order/fill reconciliation, recovery completion, retained-inventory allocation, and recovery-basis reset.
- No duplicate or unsafe intent exists.

Do not assert merely that a single action was returned. Verify its side, purpose, quantity, price, accounting basis, and the exact cycle state that keeps BUY admission closed.

### Pre-existing BUY late fill during recovery

Set up a canonical active recovery Position and recovery SELL together with a standing BUY that was already acknowledged before the recovery cycle became active. Deliver its late/partial fill and its cancellation/terminal evidence in different orders, including delayed and unknown outcomes.

While that pre-existing BUY remains active, an ordinary market-price event must skip only trailing-BUY replacement and still run normal Conservative evaluation so required recovery SELL coverage is established or maintained. The no-new-BUY policy remains enforced by the strategy and final submission gate.

The expected behavior is to apply each canonical BUY fill exactly once, retain the pre-existing order's ownership/lifecycle, reconcile any cancellation race through the existing durable workflow, and recalculate recovery SELL coverage from the updated Position and confirmed proceeds. Do not create a replacement or next standing BUY while the recovery cycle remains unresolved. Pure policy tests assert the decision from a reconciled snapshot; application tests own broker cancellation, race ordering and barriers.

### Partial and completed recovery SELL

Use actual canonical SELL Fill facts, not an assumed requested quantity. Verify base quantity reduction, net proceeds, commission treatment, and recovery remaining after a partial fill. A partial SELL without a new BUY must preserve the existing open order/price when the specification says so.

For a completed recovery cycle, require the canonical terminal order evidence at the application boundary. Assert completion exactly once, retained inventory and constrained dust treatment, recovery-basis reset, and eligibility for the next initial BUY. A replay/duplicate terminal event must not complete or reset the cycle twice.

## Conservative state model

Follow the shared methodology's [state-machine and lifecycle proof](../../../../docs/testing/DOMAIN_SCENARIO_TESTING.md#state-machine-and-lifecycle-proof) requirements. The following conceptual model is Conservative-specific and does not add states or redefine transitions in the canonical specification.

### State model

The following is a conceptual test model. It does not add states or redefine transitions in the canonical Conservative specification. Before implementing a transition, map it to the actual production state representation and authoritative specification. If the model and source/spec disagree, record and resolve the discrepancy; do not encode an invented rule.

~~~mermaid
stateDiagram-v2
    [*] --> NoActiveCycle
    NoActiveCycle --> BuyPending: BUY intent accepted
    BuyPending --> ActivePosition: canonical BUY fill applied
    BuyPending --> NoActiveCycle: proven terminal no-fill outcome
    ActivePosition --> RecoverySellPending: recovery SELL intent accepted
    RecoverySellPending --> RecoverySellOpen: order acknowledged
    RecoverySellPending --> ReconciliationBlocked: submission outcome unknown
    RecoverySellOpen --> PartialRecovery: partial SELL fill
    PartialRecovery --> RecoverySellOpen: remaining order stays valid
    PartialRecovery --> RecoverySellPending: replacement required by canonical policy
    RecoverySellOpen --> CancelPending: replacement/cancel required
    CancelPending --> ReconciliationBlocked: cancel/fill outcome uncertain
    CancelPending --> RecoverySellPending: terminal outcome + fills reconciled
    ReconciliationBlocked --> RecoverySellPending: authoritative evidence reconciled
    RecoverySellOpen --> CompletionEligible: terminal SELL + accounting conditions met
    PartialRecovery --> CompletionEligible: terminal SELL + accounting conditions met
    CompletionEligible --> NoActiveCycle: atomic cycle completion
    CompletionEligible --> ReconciliationBlocked: completion evidence/invariant fails
~~~

ReconciliationBlocked is a safety disposition in this conceptual model, not permission to clear a production latch or invent an automatic retry. A transition out of a blocked condition requires the authoritative evidence and recovery path defined by the existing application contract.

## Conservative required sequence scenarios

The sequence below is a Conservative coverage plan, not a generic strategy lifecycle. Implement only transitions supported by the canonical Conservative specification. A next-cycle BUY can follow only after the completed recovery transition returns to NoActiveCycle. Use the shared methodology for transition evidence, idempotency, conflict, failure-atomicity, and recovery assertions.

Use these as separate, named scenario tests or tightly scoped state-machine test cases. The sequence is a coverage plan; only transitions supported by the canonical specification and current production contract should be implemented.

~~~text
Initial state
  -> Initial BUY accepted
  -> BUY partially filled
  -> BUY fully/terminally reconciled
  -> Recovery SELL planned and accepted
  -> No new BUY while the recovery cycle is unresolved
  -> Any pre-existing standing BUY late fill is reconciled exactly once
  -> Existing recovery SELL cancellation/fill race is reconciled when replacement is required
  -> Recovery SELL recalculated from the updated Position and confirmed net proceeds
  -> Recovery SELL partially filled / sell-through continues
  -> Terminal SELL and complete fill history reconciled
  -> Completion preconditions verified
  -> Retained inventory allocated and Portfolio + RecoveryLedger cycle completion committed atomically
  -> Only then does the next cycle become eligible
~~~

Required adversarial variants include:

- duplicate identical fill before and after terminal order reports;
- same fill/order identity with changed quantity, price, commission asset or market;
- fill before acknowledgement, acknowledgement before fill, and terminal report before delayed fill evidence;
- partial fill racing cancellation, including fill-history gaps and unknown cancel outcome;
- stale, reordered and conflicting status/execution reports;
- repeated, concurrent and re-entrant evaluation while submit/cancel/reconcile is pending, proving the BUY gate cannot be bypassed;
- persistence or projection failure between staged state changes;
- completion attempt below profit threshold, with sellable active residual, with invalid dust evidence, or with incomplete terminal evidence;
- replay of a completed event and stale events from the previous cycle.

## Executable Conservative scenario inventory

The executable definitions live under `test/scenarios/conservative/` and use stable `CON-*` IDs. Shared tooling lives under `test/scenarios/shared/`; it resolves scenario evidence against the existing `docs/critical-behaviors.json` contract and supplemental named test mappings. That critical-behavior file remains authoritative for ownership and named evidence; this suite does not create a parallel registry.

Run the mapped offline suite and generate its three JSON reports:

```bash
pnpm --filter @coinzilla/harvester scenarios:conservative
pnpm --filter @coinzilla/harvester scenarios:conservative -- --id CON-BUY-001
pnpm --filter @coinzilla/harvester scenarios:conservative -- --category recovery-lifecycle
pnpm --filter @coinzilla/harvester scenarios:conservative -- --priority P0
pnpm --filter @coinzilla/harvester scenarios:conservative -- --tag fees
pnpm --filter @coinzilla/harvester scenarios:conservative -- --status MISSING
pnpm --filter @coinzilla/harvester scenarios:conservative -- --list
```

Reports are generated under `reports/conservative-scenarios/`: inventory, execution results, and coverage gaps. The existing `Harvester Targeted Tests` workflow runs this suite only when Conservative scenario-related paths change and uploads these reports. The suite executes existing named Node tests; it does not perform broker or exchange operations.

The current inventory contains 18 scenarios across all 16 categories: 17 TEST-MAPPED and one PARTIAL configuration scenario. CON-PERSIST-002 remains TEST-MAPPED: offline crash/restart regressions prove runtime restoration remains explicitly UNSUPPORTED, while startup tests prove a fresh process derives readiness only from its own PREFLIGHT and current-process user-data; prior-session orders/fills remain external and are not reconstructed into Portfolio, RecoveryLedger, OrderRegistry, or active orders. CON-PERSIST-003 is TEST-MAPPED for recovery-disabled fresh-session startup after prior process history, recovery-enabled rejection of unclean history, clean recovery-enabled observation-only restart, and strategy-scoped RS STOP/account safety behavior. TEST-MAPPED means only that named tests are linked; it is not equivalent to VERIFIED or permission to enable restoration. The coverage report's unmapped-test universe is the named test set in `docs/critical-behaviors.json`, not every Harvester test file.
