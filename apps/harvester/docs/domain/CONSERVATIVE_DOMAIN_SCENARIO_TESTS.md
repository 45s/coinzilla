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
- A standing BUY intent exists with the correct reason, reference price, configured quantity, and exchange rounding.
- Action ordering only when ordering is part of the contract; otherwise identify actions by named fields.
- No duplicate or unsafe intent exists.

Do not assert merely that “two actions” were returned. An incorrect quantity, fee reserve, price, reason, or cycle state can still produce two actions.

### Second BUY fill

Set up the state using the initial-fill scenario or a clear canonical setup, including the existing recovery SELL and its order lifecycle state. Apply the second BUY Fill with its own execution price, quantity and commission facts.

The expected business behavior includes the combined position/accounting state, cancellation/reconciliation requirement for the old recovery SELL, recalculated recovery economics from the updated position and already-confirmed net SELL proceeds, correct next BUY reference, and the safety outcome if old SELL terminal state or fill history is incomplete. Pure policy tests should assert the decision from a reconciled snapshot; application tests own broker cancellation, race ordering and barriers.

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

The sequence below is a Conservative coverage plan, not a generic strategy lifecycle. Implement only transitions supported by the canonical Conservative specification. Use the shared methodology for transition evidence, idempotency, conflict, failure-atomicity, and recovery assertions.

Use these as separate, named scenario tests or tightly scoped state-machine test cases. The sequence is a coverage plan; only transitions supported by the canonical specification and current production contract should be implemented.

~~~text
Initial state
  -> Initial BUY accepted
  -> BUY partially filled
  -> BUY fully/terminally reconciled
  -> Recovery SELL planned and accepted
  -> Recovery SELL partially filled
  -> Second BUY arrives while recovery SELL exists
  -> Cancel requested
  -> Cancel/fill race reconciled from authoritative evidence
  -> Recovery SELL recalculated from combined cost and confirmed net proceeds
  -> Recovery SELL partially filled again
  -> Terminal SELL reconciled
  -> Completion preconditions verified
  -> Portfolio + RecoveryLedger cycle completion committed atomically
  -> Next cycle becomes eligible
~~~

Required adversarial variants include:

- duplicate identical fill before and after terminal order reports;
- same fill/order identity with changed quantity, price, commission asset or market;
- fill before acknowledgement, acknowledgement before fill, and terminal report before delayed fill evidence;
- partial fill racing cancellation, including fill-history gaps and unknown cancel outcome;
- stale, reordered and conflicting status/execution reports;
- repeated evaluation while submit/cancel/reconcile is pending;
- persistence or projection failure between staged state changes;
- completion attempt below profit threshold, with sellable active residual, with invalid dust evidence, or with incomplete terminal evidence;
- replay of a completed event and stale events from the previous cycle.

## Executable Conservative scenario inventory

The executable scenario definitions live under `test/scenarios/conservative/` and use stable `CON-*` IDs. The shared loader resolves implementation modules and named test cases from the existing `docs/critical-behaviors.json` registry and supplemental scenario-specific mappings in `test/scenarios/shared/additional-test-mappings.js`. That registry remains the source of truth for critical behavior ownership; this suite does not duplicate it.

The inventory currently contains 17 scenarios across all 16 requested categories. The definitions carry preconditions, initial state, ordered input events, expected state/orders/accounting/side effects, invariants, specification requirement IDs, source files, named tests, priority, tags, and evidence status.

Run the full mapped suite and generate the three JSON reports:

```bash
pnpm --filter @coinzilla/harvester scenarios:conservative
```

Run one scenario, a category, or filter the inventory:

```bash
pnpm --filter @coinzilla/harvester scenarios:conservative -- --id CON-BUY-001
pnpm --filter @coinzilla/harvester scenarios:conservative -- --category recovery-lifecycle
pnpm --filter @coinzilla/harvester scenarios:conservative -- --priority P0
pnpm --filter @coinzilla/harvester scenarios:conservative -- --tag fees
pnpm --filter @coinzilla/harvester scenarios:conservative -- --status MISSING
pnpm --filter @coinzilla/harvester scenarios:conservative -- --list
```

Reports are generated under `reports/conservative-scenarios/`:

- `scenario-inventory.json` — scenario definitions, category/priority/status totals, and evidence mappings.
- `scenario-results.json` — per-scenario and per-test execution outcomes for the selected run.
- `scenario-coverage.json` — critical gaps, scenarios without tests, uncovered requirements/critical behaviors, and critical-registry tests not mapped to a scenario.

The dedicated `Harvester Conservative scenarios` workflow runs this offline suite for scenario-related pull requests and uploads the reports as the `conservative-scenario-reports` artifact. It uses Node's built-in test runner and deterministic existing test cases; it does not call a live exchange or use credentials.

### Evidence status interpretation

The repository's shared vocabulary is retained: `VERIFIED`, `PARTIAL`, `MISSING`, `BLOCKED`, `SPECIFIED`, `TEST-MAPPED`, and `UNSUPPORTED`. `TEST-MAPPED` means a named test path and title are linked; it is not equivalent to `VERIFIED`. Promotion to `VERIFIED` requires assertion-level business-outcome review and exact commit/test-command evidence.

The initial inventory marks the invalid-configuration scenario `PARTIAL`: global strategy routing and mode tests exist, but Conservative pair-specific financial validation remains incomplete. Runtime restart/state restoration is `UNSUPPORTED` under the active Conservative specification §7 and remains subject to the separate acceptance gates in #654. Offline persistence tests are not runtime restoration evidence.

The report's unmapped-test universe is the named test set in `docs/critical-behaviors.json`; supplemental direct mappings include selected `strategy.test.js` and `resolve-harvester-options.test.js` cases. It does not claim to scan every Harvester test file. This limitation is recorded in the generated coverage report.

