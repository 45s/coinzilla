# Conservative domain scenario tests

## Purpose and authority

This document contains Conservative-specific scenario examples and the conceptual lifecycle model used by the Conservative scenario initiative.

The strategy-neutral test design, fixture, state-transition proof, accounting-oracle, adversarial coverage, and evidence methodology are defined in the shared [Domain Scenario Testing Methodology](../../../../docs/testing/DOMAIN_SCENARIO_TESTING.md). Do not duplicate or redefine that method here.

The canonical trading contract remains the [Conservative Domain Specification](CONSERVATIVE_DOMAIN_SPECIFICATION.md). This document does not introduce or redefine strategy rules. Coverage tracking and implementation work are owned by [issue #1763](https://github.com/45s/coinzilla/issues/1763).

## Conservative scenario examples

## Example behavior: initial BUY fill

A scenario should make every financially relevant input explicit. For example, the test fixture may represent DOGEUSDT, configured order quantity 400, BUY execution price 0.10, configured maker/taker fee rates, actual commission amount and asset, minProfit, keepQuantity, order type, price tick, quantity step, minimum/maximum quantity and notional, and current market price.

After applying a valid canonical BUY Fill to the real Portfolio and RecoveryLedger and evaluating the real Conservative policy, assert:

- The strategy-owned Position quantity and spent amount reflect the fill and commission asset rules.
- RecoveryLedger has the canonical accepted fill and correct recovery accounting.
- A recovery SELL intent exists with the exact expected quantity and price/economic target, respecting retained quantity, fee reserve, and exchange filters.
- A standing BUY intent exists with the correct reason, reference price, configured quantity, and exchange rounding.
- Action ordering only when ordering is part of the contract; otherwise identify actions by named fields.
- No duplicate or unsafe intent exists.

Do not assert merely that “two actions” were returned. An incorrect quantity, fee reserve, price, reason, or cycle state can still produce two actions.

## Example behavior: second BUY fill

Set up the state using the initial-fill scenario or a clear canonical setup, including the existing recovery SELL and its order lifecycle state. Apply the second BUY Fill with its own execution price, quantity and commission facts.

The expected business behavior includes the combined position/accounting state, cancellation/reconciliation requirement for the old recovery SELL, recalculated recovery economics from the updated position and already-confirmed net SELL proceeds, correct next BUY reference, and the safety outcome if old SELL terminal state or fill history is incomplete. Pure policy tests should assert the decision from a reconciled snapshot; application tests own broker cancellation, race ordering and barriers.

## Example behavior: partial and completed recovery SELL

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

### Required sequence scenarios

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
