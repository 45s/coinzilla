# Conservative domain scenario tests

## Purpose

Conservative domain scenario tests are readable, deterministic examples of expected trading behavior across multiple real domain components. They complement focused unit tests by verifying that valid inputs and a sequence of domain events produce the expected accounting state, decisions, order intents, and safety dispositions.

The canonical trading contract remains the [Conservative Domain Specification](CONSERVATIVE_DOMAIN_SPECIFICATION.md). This document defines test organization and authoring guidance only; it does not introduce or redefine strategy rules.

Coverage tracking and implementation work are owned by [issue #1763](https://github.com/45s/coinzilla/issues/1763).

## Test types and responsibility

| Test type | What it proves | Typical scope |
| --- | --- | --- |
| Unit test | One calculation, predicate, validator, or state transition is correct in isolation. | A recovery SELL plan, price rounding, fee-rate resolution, or fill fingerprint. |
| Domain scenario test | Several real domain components cooperate to satisfy a business behavior. | Fill → Portfolio/Position/RecoveryLedger → Conservative evaluation → exact order intents. |
| Application integration test | Application orchestration, ports, ordering, reconciliation, submission barriers, and lifecycle work together. | Engine/use-case event flow, cancel/fill race, pending submission, REST/stream reconciliation. |
| Acceptance test | A requirement is satisfied at the boundary selected for acceptance. | Offline acceptance across domain and application layers; exchange acceptance is separately authorized. |
| Replay test | A recorded or carefully reconstructed event sequence reproduces a historical behavior or incident. | Historical BUY/SELL events, actual commission facts, lifecycle and shutdown evidence. |

A scenario test is not a replacement for unit tests. Keep calculation edge cases close to their calculation modules; use scenarios to prove the components compose correctly. Do not call a pure domain scenario an application integration test if it has no application orchestration.

## Scenario anatomy

Write each test as a behavior statement and organize the implementation around **Given / When / Then**:

- **Given:** a named market, strategy configuration, market metadata and trading filters; initial domain state; canonical fills/orders; actual commissions and their assets; any relevant active orders.
- **When:** apply the domain event(s) through the real components and evaluate the real Conservative policy.
- **Then:** assert the resulting accounting projections and exact decisions/intents/dispositions. Verify order side, purpose, type, price, quantity, required proceeds, fees, retained inventory, cycle state and safety outcome as relevant.

Prefer a scenario name that describes the observable business result:

~~~js
describe("Conservative domain scenarios", () => {
  it("places the next standing BUY and recovery SELL after the initial BUY fill", () => {
    // Given: a valid DOGEUSDT market, pair policy, exchange filters,
    //        empty strategy-owned position and a canonical BUY Fill.
    // When: the real Portfolio and RecoveryLedger apply the Fill,
    //       then the real Conservative strategy evaluates the state.
    // Then: assert exact accounting and both expected order intents.
  });
});
~~~

The snippet is illustrative. Use the repository's actual test framework, canonical factories, test naming, and public domain APIs; do not create a parallel domain implementation or an invented helper API merely to match this example.

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

## Fixture and helper guidance

- Use the real domain factories and entities, with canonical normalized inputs.
- Keep fixture inputs explicit. A fixture builder may reduce repetitive valid setup, but callers must be able to see and override market, pair config, order type, fee rates, exchange filters, account/Portfolio state, orders and fill facts.
- Prefer small named builders such as a market fixture or canonical Fill factory only when existing repository utilities do not already provide the capability.
- Do not hide financial values behind opaque defaults. In particular, tests should make commission amount and asset, market, side, quantity, price, and exchange constraints visible.
- Avoid mocks for Portfolio, Position, RecoveryLedger, decimal calculations, or the strategy decision under test. Mock only external ports when testing an application boundary.
- Use exact decimal strings and compare named fields. Avoid floating-point arithmetic in scenario setup and expected values.
- Assert both expected outcomes and important absence conditions (no duplicate intent, no stale order, no cycle reset, no unsafe BUY, no external inventory adoption).
- Include assertion messages that explain the business invariant being protected.
- Keep scenarios focused. Do not combine a full lifecycle and dozens of unrelated failure cases into one mega-test; use named cases or separate tests.
- Keep tests offline, deterministic, credential-free, and independent of live or TESTNET exchange operations.

## Scenario organization

A dedicated scenarios folder is recommended when it makes the behavior suite discoverable without disrupting existing colocated unit-test conventions. Suggested names:

- initial-buy-fill.scenario.test.js
- second-buy-fill.scenario.test.js
- partial-recovery-sell.scenario.test.js
- recovery-completed.scenario.test.js
- buy-during-recovery.scenario.test.js
- dust-and-retained-inventory.scenario.test.js
- fees-and-rounding.scenario.test.js
- exchange-filters.scenario.test.js
- fail-closed.scenario.test.js

These are suggestions, not a mandate to create empty files or move existing tests. First audit current coverage and choose the smallest structure that improves readability.

## Coverage completeness

Use [issue #1763](https://github.com/45s/coinzilla/issues/1763) as the detailed coverage checklist and current gap tracker. The matrix must be source-driven and distinguish:

- Already covered by a named test.
- Covered at a different layer (domain, application integration, or replay).
- Missing regression coverage.
- Intentionally unsupported behavior or an unresolved product-contract decision.

Every applicable behavior, boundary, interaction, and failure mode needs evidence or an explicit owner and disposition. Avoid an unreadable Cartesian product; use equivalence classes and named boundary cases, while retaining independent assertions for distinct invariants. A test count alone is not a completeness claim.

## Definition of done

A scenario suite is considered complete only when the issue matrix is audited against the current canonical specification, production source, existing tests and application/replay coverage; each applicable row is mapped to evidence; uncovered behavior has deterministic tests; existing tests remain intact; and exact-head CI evidence is recorded. Documentation and roadmap status must agree with the issue and PR.

No scenario-test initiative authorizes exchange writes, process restart, live trading, or TESTNET operation.

## State-machine testing: mandatory lifecycle proof

State-machine tests prove that the strategy and its surrounding application move through only permitted business states, preserve accounting across transitions, and fail closed when the evidence needed for a transition is absent. They are not merely tests of status strings. Every transition test must assert the complete relevant state before and after the event, including Portfolio, Position, RecoveryLedger, order identity/status/quantities, reservations or commitments, emitted intents, and safety disposition.

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

### Transition contract

For each production transition, the coverage matrix must record:

| Field | Required proof |
| --- | --- |
| From / event / to | Exact source state, event identity/type, and expected resulting state |
| Preconditions | Required canonical fill/order facts, market/configuration, accounting evidence and terminal proof |
| State mutation | Every changed field in Position, Portfolio, RecoveryLedger, OrderRegistry and commitments |
| Accounting delta | Exact base quantity, quote cost/proceeds, commission amount/asset, realized net profit and retained inventory |
| Emitted effects | Exact intent/disposition, or explicit proof that no intent is emitted |
| Idempotency | Reapplying the same event does not double-apply fills, fees, proceeds, completion or reservations |
| Conflict behavior | Same identity with different payload, stale version/timestamp, wrong market/order/side or conflicting terminal facts are rejected |
| Failure atomicity | Rejected/failed transition leaves all authoritative projections unchanged; no partial commit |
| Recovery | Exact evidence required to safely resume; no blind retry or implicit latch clearing |

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

### Example transition assertion pattern

~~~js
it("does not partially complete a recovery cycle when ledger reset fails", () => {
  // Given: a completion-eligible cycle with exact canonical fills,
  //        reconciled terminal SELL evidence and a ledger that rejects reset.
  const beforePortfolio = portfolio;
  const beforeLedger = recoveryLedger;

  // When: the real completion workflow attempts the transition.
  const result = completeRecoveryCycle(/* canonical inputs */);

  // Then: failure is explicit and both authoritative projections are unchanged.
  assert.equal(result.ok, false, "completion must report the failed transition");
  assert.strictEqual(portfolio, beforePortfolio,
    "Portfolio must not commit before RecoveryLedger completion succeeds");
  assert.strictEqual(recoveryLedger, beforeLedger,
    "RecoveryLedger must preserve the incomplete cycle");
});
~~~

This is a shape example, not a claim about the repository's exact API. Implement with current public APIs and assert deep immutable values where reference identity is not the contract.

### State-machine test rules

1. Test every implemented legal transition at least once with exact post-state assertions.
2. Test every forbidden transition relevant to financial safety and prove no mutation.
3. Test every transition's duplicate/idempotent behavior and conflicting-identity behavior.
4. Assert conservation across projections after each event, not only at the end of a long sequence.
5. Separate domain transition tests from application orchestration tests. Broker cancel/submit, REST/stream ordering, durable barriers and shutdown belong to application owners.
6. Keep a transition matrix with from, event, guard, to, mutation, failure result, test path, and evidence status.
7. A transition is not covered merely because a test asserts its status. It is covered only when the associated accounting, identity, side-effect and failure guarantees are asserted.
