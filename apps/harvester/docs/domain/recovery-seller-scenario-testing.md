---
title: Recovery Seller Domain Scenario Testing Playbook
status: active
type: testing
owner: harvester
created: 2026-11-24
---

# Recovery Seller (RS) domain scenario testing playbook

**Purpose:** this is the implementation contract for an AI agent asked to build or extend Recovery Seller domain scenarios. An agent must be able to follow it from a clean repository checkout without relying on chat history, guessing architecture, or asking the owner to restate decisions.

**Scope:** scenario design, executable scenario architecture, fixtures, domain/application boundaries, financial oracles, coverage evidence, documentation synchronization, issue maintenance, and phased delivery.

**This document does not change RS trading behavior.** The draft [Recovery Seller Domain Specification](recovery-seller-domain-specification.md), its accepted decisions, and the owning issue remain the authority for business behavior. This playbook explains how to prove that behavior. It must never invent retry, replacement, automatic STOP clearing, liquidation, dust, restart, or recovery policy.

## 1. Read this first: authority and ownership

An AI agent must read these sources before designing or editing an RS scenario. The order is deliberate.

| Order | Source | What it controls | What it does not control |
| --- | --- | --- | --- |
| 1 | Root [AGENTS.md](../../../../AGENTS.md) and [Harvester AGENTS.md](../../AGENTS.md) | Mandatory agent, branch, safety, docs and delivery rules | RS business rules |
| 2 | [ENGINEERING_STANDARDS.md](../../../../ENGINEERING_STANDARDS.md), [AI_AGENT_WORKFLOW.md](../../../../AI_AGENT_WORKFLOW.md), [Task Workflows](../../../../docs/engineering/TASK_WORKFLOWS.md) | Repository engineering, TDD, branch freshness, issue/PR and documentation workflow | RS business rules |
| 3 | [TRADING_FIRST.md](../TRADING_FIRST.md) | Harvester trading safety and product priority | Detailed RS accounting formulas |
| 4 | [Recovery Seller Domain Specification](recovery-seller-domain-specification.md) | RS behavior contract, accounting, lifecycle and safety invariants | Scenario coverage status |
| 5 | [Recovery Seller Implementation Roadmap](recovery-seller-implementation-roadmap.md) | RS implementation phases and dependencies | Scenario coverage status |
| 6 | **This playbook** | Exact RS scenario-authoring and implementation method | New trading policy |
| 7 | [Issue #1780](https://github.com/45s/coinzilla/issues/1780) | Live RS scenario matrix, priority, blockers, current evidence and next action | Generic scenario methodology |
| 8 | [Domain Scenario Testing Methodology](../../../../docs/testing/DOMAIN_SCENARIO_TESTING.md) | Shared strategy-neutral test-design method | RS-specific rules or matrices |
| 9 | [Repository Scenario Catalog](../../../../docs/testing/SCENARIO_CATALOG.md) | Repository-wide behavior navigation and concise evidence mapping | Detailed RS matrix or behavior authority |
| 10 | [Domain Test Inventory](DOMAIN_TEST_INVENTORY.md) and [critical behavior contract](../critical-behaviors.json) | Supplemental source/test inventory and critical-module ownership | New RS scenario coverage credit |

### 1.1 Single ownership rules

- The RS specification owns expected RS behavior. If it is draft, contradictory, or silent, do not fill the gap with assumptions.
- Issue #1780 owns RS-001 through RS-010, subcase expansion, risk priority, implementation sequence, blockers and evidence.
- The shared methodology owns generic scenario-testing rules. Do not copy it into RS docs or change it just to add an RS-specific rule.
- The repository catalog is a navigation layer. Keep its RS section concise and link to this playbook and #1780.
- The Harvester domain inventory remains a supplemental index of existing source/tests. It is not the new scenario matrix.
- The Harvester roadmap is a short phase/status summary. Do not paste the full issue or this playbook into it.
- The critical-behavior JSON is a separate enforced critical-module/test contract. Do not repurpose it as the scenario registry.
- A test filename, passing test count, line coverage percentage, or existing regression test is never sufficient proof of an RS matrix row.

### 1.2 Source-of-truth conflict rule

When two sources disagree:

1. Record the exact conflicting statements and source locations.
2. Inspect current implementation and configuration to understand what exists. Implementation is evidence of current behavior, not automatic approval to change the product contract.
3. Mark affected scenarios BLOCKED.
4. Link the discrepancy to #1780 and, when it is a separate production defect, its own issue.
5. Ask for owner resolution only when the conflict cannot be settled by an already approved decision.
6. Do not silently choose the implementation, specification, or whichever statement appears newest.

A scenario agent may document a discrepancy. It may not resolve a trading-policy disagreement by changing production code or rewriting expected outcomes.

## 2. Mission, boundaries and success definition

### 2.1 Mission

Build a new, independently readable RS scenario suite that proves observable business behavior through realistic sequences, exact financial/accounting assertions, state-transition proofs, and safety outcomes.

For every important RS behavior, the suite must answer:

- What exact business rule is being proved?
- What initial Portfolio, Position, cycle, order, ownership, custody and reservation facts exist?
- Which real production decision/workflow receives those facts?
- Which ordered event or action occurs?
- What exact decision, quantities, money, accounting projections, lifecycle state and side effects must result?
- What must never happen?
- Which boundary, duplicate, conflict, reorder, partial, unknown and failure variants have been proved?
- Which exact named test proves each claim?
- On which exact commit and CI run was that test verified?

### 2.2 Explicit non-goals

This initiative does not authorize:

- Changing RS trading policy, configuration defaults, strategy activation or runtime behavior merely to make a scenario pass.
- Changing CG/Conservative behavior.
- Reusing or crediting existing RS unit, workflow, runtime, operator or integration tests as scenario coverage.
- Rewriting existing tests into a new framework before the new scenario design is understood.
- Implementing a second Portfolio, Position, Fill, OrderRegistry, accounting engine, exchange-filter engine or RS state machine inside test helpers.
- Broker/API calls, order placement/cancellation, credential use, exchange sessions, TESTNET/LIVE experiments, or exchange-state changes.
- Restart/replay support, standalone final-residual liquidation, advanced pause/disable/abandon/resume lifecycle flows, or third-asset commission valuation without an independently approved contract and source.
- Inventing automatic STOP clearing, weakening the evidence-backed administrator resolution contract, SELL retry/replacement, post-fill recovery, continuation after terminal CANCELED/EXPIRED outcomes with prior partial fills, dust treatment or new-cycle behavior.
- Building a generic test framework for all strategies inside this RS-specific task.

### 2.3 What counts as success

The suite is successful when the matrix is complete and every supported, unblocked requirement has scenario evidence at the correct layer. A row is VERIFIED only when all required subcases are proven, assertions are independently reviewed, the exact named tests pass, the commit SHA and CI evidence are recorded, and the tests are merged to develop.

A PARTIAL row stays PARTIAL even if every currently written test passes. A BLOCKED or UNSUPPORTED row is an honest outcome, not a test failure to work around.

## 3. Repository map: current files and planned files

### 3.1 Existing production source tree

This is the source ownership map at the initial audit checkpoint. Re-check the current tree before implementation; source ownership can move.

~~~text
apps/harvester/
├── config/
│   └── strategies/
│       └── rs-recovery-seller.js
├── rs-recovery-seller.js
└── src/
    ├── domain/
    │   ├── app-config.js
    │   └── strategies/
    │       └── recovery-seller/
    │           ├── calculate-profitability.js
    │           ├── calculate-sell-plan.js
    │           ├── cycle-state.js
    │           ├── evaluate-buy-decision.js
    │           ├── evaluate-sell-decision.js
    │           ├── legacy-accounting-state.js
    │           ├── legacy-position.js
    │           ├── legacy-spot-allocation.js
    │           ├── lifecycle-decision.js
    │           ├── lifecycle-state.js
    │           ├── mixed-sell-fill-accounting.js
    │           ├── mixed-sell-fill-allocation.js
    │           ├── mixed-sell-fill-reconciliation.js
    │           ├── recovery-seller-accounting-error.js
    │           └── stop-decision.js
    └── use-cases/
        ├── create-recovery-seller-accounting-workflow.js
        ├── create-recovery-seller-action-authorizer.js
        ├── create-recovery-seller-order-submitter.js
        ├── create-recovery-seller-runtime-evaluator.js
        ├── create-recovery-seller-stop-workflow.js
        ├── create-recovery-seller-transition-evaluator.js
        ├── record-recovery-seller-mixed-sell-reconciled.js
        ├── recovery-seller-order-callbacks.js
        ├── recovery-seller-submission-ownership.js
        └── resolve-recovery-seller-stop.js
~~~

This is a responsibility map, not a promise that every listed module must be imported by every scenario. Follow dependency direction and use the smallest real production composition that proves the business claim.

### 3.1.1 Existing production-file responsibilities

This table describes the current develop implementation at the audit checkpoint. It is a source map, not a requirement to import every module into every scenario. Tests should exercise the narrowest public production boundary that proves the business claim.

| Existing file | Responsibility and scenario boundary |
| --- | --- |
| apps/harvester/src/domain/app-config.js | Validates application configuration, selects pairs for the resolved trading environment and resolves runtime configuration. It does not own RS profitability or inventory policy. |
| apps/harvester/src/domain/strategies/recovery-seller/calculate-profitability.js | Calculates the independent recovery, legacy and combined-cycle profitability gates from supplied exact values. |
| apps/harvester/src/domain/strategies/recovery-seller/calculate-sell-plan.js | Plans the additive recovery-plus-legacy SELL, eligible legacy slice, fee gross-up, quantity allocation and minimum price using exact decimal arithmetic. |
| apps/harvester/src/domain/strategies/recovery-seller/cycle-state.js | Owns immutable cycle identity, one SELL identity per cycle, unknown submission state, terminal reconciliation outcome and next-cycle preconditions. |
| apps/harvester/src/domain/strategies/recovery-seller/evaluate-buy-decision.js | Pure RS BUY eligibility and intent planning using configured tranche quantity, cadence/reference price and market precision. |
| apps/harvester/src/domain/strategies/recovery-seller/evaluate-sell-decision.js | Pure pre-submission SELL policy: fee/order-type selection, filter validation, planned order and fail-closed STOP outcome. It does not submit or retry. |
| apps/harvester/src/domain/strategies/recovery-seller/legacy-accounting-state.js | Creates/reads the legacy-position map and derives additional tracked quote cash flow/base quantity from verified account and Portfolio state. |
| apps/harvester/src/domain/strategies/recovery-seller/legacy-position.js | Creates fixed original legacy basis, caps each cycle's legacy slice at the remaining quantity and records reconciled legacy sales without rewriting original average cost. |
| apps/harvester/src/domain/strategies/recovery-seller/legacy-spot-allocation.js | Derives verified additional Spot custody by subtracting aggregate Portfolio base quantity from authoritative Spot totals and capping by authorized legacy remainder. |
| apps/harvester/src/domain/strategies/recovery-seller/lifecycle-decision.js | Defines pure per-order lifecycle outcomes/transitions, including WAIT/RECONCILE behavior and the one-order lifecycle rules. |
| apps/harvester/src/domain/strategies/recovery-seller/lifecycle-state.js | Composes cycle lifecycle state with sticky STOP state for unknown sole-SELL outcomes and guarded next-cycle transitions. |
| apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-accounting.js | Applies a fully reconciled canonical mixed SELL to both recovery Portfolio and legacy projections atomically; no input snapshot is mutated on failure. |
| apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-allocation.js | Binds one canonical Fill to registered RS order ownership and splits gross base quantity, quote proceeds and commission facts between recovery and legacy. |
| apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-reconciliation.js | Stages canonical Fill allocations, detects duplicate/conflicting identities, validates terminal order/history completeness and produces reconciled allocation evidence. |
| apps/harvester/src/domain/strategies/recovery-seller/recovery-seller-accounting-error.js | Defines typed RS accounting errors for domain/application failure boundaries. |
| apps/harvester/src/domain/strategies/recovery-seller/stop-decision.js | Defines sticky STOP decisions/state/gating and the evidence-backed administrator resolution preconditions. STOP blocks new BUY spending, not an otherwise valid recovery SELL. |
| apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js | Coordinates RS BUY accounting and terminal mixed-SELL accounting across shared Portfolio, legacy accounting, order registry and cycle snapshots. |
| apps/harvester/src/use-cases/create-recovery-seller-action-authorizer.js | Authorizes RS actions against shared account-wide quote/base commitments, RS budget, recovery inventory and verified unreserved legacy Spot. |
| apps/harvester/src/use-cases/create-recovery-seller-order-submitter.js | Coordinates durable submission intent, broker submission, acknowledgement and unknown/unresolved submission outcomes for RS-owned orders. |
| apps/harvester/src/use-cases/create-recovery-seller-runtime-evaluator.js | Composes RS runtime readiness, market state, STOP and strategy evaluation at the runtime boundary. |
| apps/harvester/src/use-cases/create-recovery-seller-stop-workflow.js | Restores and persists the durable RS STOP blocker/state used by runtime safety gates. |
| apps/harvester/src/use-cases/create-recovery-seller-transition-evaluator.js | Composes pure RS BUY/SELL policies with the real accounting-workflow snapshot and decides whether to continue a BUY tranche or submit the sole SELL. |
| apps/harvester/src/use-cases/record-recovery-seller-mixed-sell-reconciled.js | Persists the durable terminal mixed-SELL completion fact only after both accounting projections and profitability outcome are verified; controls reservation-release boundary. |
| apps/harvester/src/use-cases/recovery-seller-order-callbacks.js | Supplies RS-owned pending, acknowledgement, submission-failure/deferred and execution callbacks to the shared submitter/event workflow. |
| apps/harvester/src/use-cases/recovery-seller-submission-ownership.js | Re-exports the shared domain validator for immutable RS submission ownership; do not duplicate ownership validation in scenario helpers. |
| apps/harvester/src/use-cases/resolve-recovery-seller-stop.js | Implements the evidence-backed durable administrator resolution use case. The operator facade must expose it only through its existing trusted-operator authorization boundary. |

Shared collaborators live outside the RS-specific tree: shared Portfolio/Position accounting, canonical Fill/Order identity and OrderRegistry, account snapshots and commitment allocation, the serialized Trading Engine, market TradingRules, Journal and Operational State Store. Inspect their actual consumers and imports before adding a fake port or duplicate abstraction.

### 3.2 Existing scenario test tree

PR #1793 is merged. These four files are the initial new scenario-evidence slice:

~~~text
apps/harvester/test/
└── scenarios/
    ├── recovery-seller-cycle-lifecycle.scenario.test.js
    ├── recovery-seller-mixed-sell-accounting.scenario.test.js
    ├── recovery-seller-profitability.scenario.test.js
    └── recovery-seller-sell-planner.scenario.test.js
~~~

PR #1823 adds five nested scenario files:

- `recovery-seller/registry-and-runner.scenario.test.js` — registry and runner contract tests.
- `recovery-seller/authorization-custody.scenario.test.js` — RS-001 authorization/custody.
- `recovery-seller/buy-accounting.scenario.test.js` — RS-002 BUY accounting.
- `recovery-seller/mixed-sell-planning.scenario.test.js` — RS-003-001…008 planner/custody/reservation and Fill-allocation cases, plus RS-003-009-A (tiny exponent-notation quantity/price-step boundary) and RS-003-009-B (post-snapshot CG SELL commitment), both TEST-MAPPED. The exponent case exercises the exact shared decimal parser and planner; it does not claim full exchange-filter coverage. RS-003-010-A additionally maps a real supported MIN_NOTIONAL violation through the production SELL evaluator and asserts BLOCK, sticky STOP and no order intent. RS-003-011-A maps missing required MIN_NOTIONAL metadata to the same fail-closed result; these are narrow filter cases, not full exchange-filter verification.
- `recovery-seller/mixed-sell-fill-allocation.scenario.test.js` — RS-003-008 exact canonical SELL Fill recovery/legacy split and base, quote-proceeds and quote-commission conservation.

**Exact named-test mapping is mandatory.** A scenario's `test.file` and `test.title` (and every subcase mapping) must point to a real test declaration in the current tree. Path existence alone is insufficient. The registry-and-runner test suite checks every mapping by reading the referenced file and requiring either the exact literal title or an explicit `test(scenario.test.title)` registration that consumes scenario-owned title records. When tests move or are renamed, update the scenario registry in the same change; never leave a plausible but nonexistent title in a `TEST-MAPPED` record.

All five files must be listed in `apps/harvester/package.json` `config.targetedTestFiles`. A targeted-test pass is valid only when its log shows these files were executed.

These files prove only the assertions documented in #1780 and the repository catalog. Their presence does not make the framework complete and does not make RS-001/002/008 covered. Do not rename or move them merely to match a proposed future tree.

### 3.3 Planned scenario framework tree

The following is the target structure for the first framework PR and later family expansion. It is test-only. Keep existing flat scenario files until a separately justified migration is accepted.

~~~text
apps/harvester/test/scenarios/
├── recovery-seller/                         # New RS framework
│   ├── registry/
│   │   ├── index.js                         # Stable scenario registry export
│   │   ├── define-scenario.js               # Scenario record validation/factory
│   │   ├── validate-registry.js              # IDs, references, schema and completeness
│   │   ├── config-fields.js                  # RS config field inventory
│   │   ├── domain-rules.js                   # Stable RS rule identifiers
│   │   ├── decisions.js                      # Decision/outcome identifiers
│   │   ├── states.js                         # Actual RS cycle-state identifiers
│   │   ├── transitions.js                    # Valid transition inventory
│   │   └── invariants.js                     # Stable invariant identifiers
│   ├── scenarios/
│   │   ├── authorization-custody.js          # RS-001
│   │   ├── buy-accounting.js                 # RS-002
│   │   ├── mixed-sell-planning.js             # RS-003
│   │   ├── profitability.js                   # RS-004
│   │   ├── sell-lifecycle.js                  # RS-005
│   │   ├── mixed-sell-accounting.js           # RS-006
│   │   ├── unknown-outcomes.js                # RS-007
│   │   ├── shared-account-concurrency.js      # RS-008
│   │   ├── stop-and-failures.js               # RS-009, only after resolution
│   │   └── deferred-capabilities.js           # RS-010 disposition records only
│   ├── runners/
│   │   ├── run-domain-scenario.js              # Real domain components, no broker
│   │   ├── run-application-scenario.js         # Real use cases, fake external ports
│   │   └── execute-scenario-steps.js           # Thin ordered step dispatcher
│   ├── support/
│   │   ├── create-rs-market-fixture.js          # Explicit canonical domain setup
│   │   ├── create-offline-broker.js             # Controlled broker port
│   │   ├── create-deterministic-store.js        # Controlled persistence port
│   │   ├── controlled-event-delivery.js         # REST/stream ordering and duplicates
│   │   ├── failure-injection.js                 # Named boundary failures
│   │   └── financial-oracles.js                 # Independent test-only arithmetic
│   ├── reports/
│   │   ├── parse-test-results.js                # Actual test-run evidence
│   │   └── generate-coverage-report.js          # Registry + execution + review status
│   ├── registry-and-runner.scenario.test.js    # PR 1 / RS-004-011
│   ├── authorization-custody.scenario.test.js  # PR 2 / RS-001
│   ├── buy-accounting.scenario.test.js         # PR 2 / RS-002
│   ├── mixed-sell-planning.scenario.test.js    # PR 3 / RS-003
│   ├── profitability.scenario.test.js          # PR 3 / RS-004
│   ├── sell-lifecycle.scenario.test.js          # PR 4 / RS-005
│   ├── unknown-outcomes.scenario.test.js        # PR 4 / RS-007
│   ├── mixed-sell-accounting.scenario.test.js   # PR 5 / RS-006
│   ├── shared-account-concurrency.scenario.test.js # PR 6 / RS-008
│   └── stop-and-failures.scenario.test.js       # PR 7 / RS-009, after owner decision
├── recovery-seller-cycle-lifecycle.scenario.test.js
├── recovery-seller-mixed-sell-accounting.scenario.test.js
├── recovery-seller-profitability.scenario.test.js
└── recovery-seller-sell-planner.scenario.test.js
~~~

Introduce this tree incrementally. PR 1 must not create empty directories or speculative abstractions for all future phases. Create only the registry/schema/validator/runner pieces required by the first registered scenario. Add each family module when its first scenario is implemented.

### 3.4 Documentation and issue tree

~~~text
apps/harvester/
├── AGENTS.md
├── ROADMAP.md                              # Short phase summary and next action
└── docs/
    └── domain/
        ├── README.md                       # Domain docs index
        ├── recovery-seller-domain-specification.md
        ├── recovery-seller-implementation-roadmap.md
        ├── recovery-seller-scenario-testing.md  # This playbook
        └── DOMAIN_TEST_INVENTORY.md        # Supplemental existing-test inventory

docs/testing/
├── DOMAIN_SCENARIO_TESTING.md              # Shared strategy-neutral method
└── SCENARIO_CATALOG.md                     # Repository-wide scenario navigation

GitHub:
├── #1779  Shared scenario methodology (completed dependency)
├── #1780  RS scenario matrix, priorities, blockers and evidence (primary owner)
├── #1783  Repository-wide scenario catalog (cross-domain index)
└── #1809  Production workflow-to-SELL-evaluator cycle-state defect
~~~

## 4. RS domain model that scenarios must preserve

Read the corresponding sections in the canonical RS specification before writing an assertion. The summaries below are guardrails, not replacements for that specification.

### 4.1 Inventory is not one number

Keep these concepts distinct in every fixture and assertion:

| Concept | Meaning | Scenario mistake to avoid |
| --- | --- | --- |
| Recovery inventory | Net base quantity acquired from canonical BUY fills owned by the current RS cycle/Position | Using requested BUY quantity or gross base before base commission |
| Recovery cost | Actual quote cost attributed to confirmed recovery BUY fills, including supported actual fee treatment | Recalculating from a current market price |
| Legacy basis | Operator-declared historical investment and original quantity | Treating configuration as a synthetic Portfolio fill |
| Legacy remaining quantity | Authorized legacy quantity remaining after completed cycles | Resetting it to original configured amount every cycle |
| Verified Spot custody | Authoritative Spot `Balance.total` attributable to authorized legacy inventory after subtracting aggregate Portfolio base custody; this proves custody, not free-to-trade quantity | Treating wallet total, EARN or off-Spot quantity as sellable; treating total Spot custody as immediately spendable |
| Account reservation | Inventory/quote committed by active account orders and strategies | Counting a reservation twice or ignoring another strategy's reservation |
| Canonical Portfolio | Actual confirmed account accounting with strategy-owned Positions | Creating a parallel test Portfolio implementation |

Historical basis/provenance and current custody are independent facts. A transfer between Spot and EARN changes custody/availability; it does not rewrite historical acquisition basis.

**Do not collapse custody verification and spendable-balance allocation into one subtraction.** The current production flow has two distinct stages:

1. `calculateVerifiedLegacySpotAllocation()` uses the authoritative Spot `Balance.total.amount`, subtracts aggregate base quantity already represented by every shared Portfolio Position for that asset, and caps the additional quantity at authorized remaining legacy quantity. This produces an additional tracked Spot-custody allocation outside Portfolio; it does not prove that all of that quantity is free or unreserved.
2. The shared account allocator obtains the account snapshot's free base/quote balances and compares current Portfolio, additional tracked inventory, and account-wide active-order commitments with the corresponding snapshot baselines. It applies only post-snapshot deltas. Pair-owned active inventory/SELL commitments are evaluated separately from account-wide commitments. This prevents historical locks/commitments already reflected in the snapshot free balance from being subtracted a second time, while still accounting for new commitments created after the snapshot.

Relevant production boundaries:

- `apps/harvester/src/domain/strategies/recovery-seller/legacy-spot-allocation.js` — total Spot custody minus aggregate Portfolio base, capped by authorized legacy remainder.
- `apps/harvester/src/use-cases/strategy-account-balance-context.js` — reads snapshot free balances and computes account-wide active BUY/SELL commitments.
- `apps/harvester/src/domain/orders/allocate-order-commitments.js` — applies snapshot-relative Portfolio/additional-inventory/commitment deltas and enforces remaining account and pair capacity.
- `apps/harvester/src/use-cases/create-recovery-seller-action-authorizer.js` — supplies RS-owned active orders and the recovery-plus-verified-legacy candidate to the shared allocator.

**Never subtract `Balance.locked`, the same active-order commitment, or the same Portfolio quantity twice.** Do not replace the snapshot-relative allocator with a naive formula such as `Balance.total - Portfolio - all active orders`; the actual account-free-balance and baseline contract is more specific. Scenarios must assert both the custody result and the final executable/deferred allocation when testing these boundaries.

### 4.2 Additive legacy SELL quantity

`sellQuantity` is the configured additional legacy base quantity for a cycle. The conceptual quantity is:

~~~text
SELL base target = actual net recovery base quantity
                 + eligible legacy base quantity
~~~

The original legacy average cost is fixed:

~~~text
original legacy average cost = legacyPosition.invested
                             / legacyPosition.quantity
~~~

The supported legacy-basis configuration has exactly these source values: `legacyPosition.invested` (original quote investment) and `legacyPosition.quantity` (original base quantity). Average cost is a derived value, not a separately configured input: `invested / quantity`. Do not add, accept, validate, or invent an `averageCost` configuration field or a contradictory-average-cost scenario. RS-001-003 therefore covers invalid/missing invested and quantity values only; its eight A–H subcases are the complete input-validation set for this contract.

Do not recompute that average after a legacy disposal. After a cycle has successfully completed, decrement remaining logical legacy quantity exactly once by the legacy base quantity actually disposed (normally one configured `sellQuantity` lot; use the smaller remaining amount only under the approved smaller-remainder rule). Do not decrement on SELL planning, order submission, partial-fill delivery, an unconfirmed terminal state, or duplicate replay. The decrement is committed only after complete terminal fill/commission reconciliation and the atomic recovery/legacy accounting transition succeeds.

The configured `investment` is the recovery-tranche BUY budget. It is separate from `legacyPosition.invested`, which is the original historical quote cost used to establish legacy basis.

Eligible legacy quantity is bounded by authorized remaining legacy quantity, verified Spot availability and unreserved account inventory. The configured value is not the total SELL quantity and not a maximum cap on recovery inventory.

Specification illustration only:

~~~text
Recovery = 400 DOGE
Legacy slice = 1 DOGE
Conceptual combined quantity = 401 DOGE
~~~

This illustration proves additive semantics only. It does not define DOGE price, commission, market filters or operator defaults.

### 4.3 Exact RS cycle states

The current domain module `cycle-state.js` defines these states:

| State | Meaning |
| --- | --- |
| `ACCUMULATING` | Cycle may accumulate eligible BUY tranches; no SELL identity is recorded |
| `SELL_SUBMITTED` | The cycle's sole SELL identity is recorded |
| `RECONCILIATION_REQUIRED` | Submitted SELL outcome is unknown/incomplete and requires authoritative reconciliation |
| `UNRESOLVED` | Terminal facts exist, but the cycle did not satisfy all closure conditions |
| `CLOSED` | Sole SELL is fully reconciled and all required profitability/accounting conditions passed |

Do not add a state because a test sequence would be easier to express. Re-read the current state factory and validator; state objects include invariants, not just a status string.

At the audited source checkpoint, an accumulating state requires:

~~~js
{
  cycleId,
  positionId,
  status: "ACCUMULATING",
  sellOrderIdentity: null,
  terminalOrderStatus: null,
  terminalReconciled: false,
  profitabilityEligible: null,
}
~~~

This exact shape is a source observation. The canonical factory remains the preferred fixture builder; do not hand-construct a second state model.

### 4.4 One SELL lifecycle

- One recovery cycle may submit only one SELL order lifecycle.
- Repeated evaluation cannot create a second SELL.
- An unknown submission keeps the original client identity and reservation; reconciliation is not permission to resubmit.
- `PARTIALLY_FILLED` is a nonterminal order status, not a terminal outcome. Its canonical fills are staged, the sole SELL remains active, and the reservation remains held while the order is still open; do not close the cycle or latch global STOP solely because of this nonterminal status.
- A terminal `CANCELED` or `EXPIRED` order may contain prior partial fills. Reconcile the complete canonical fill set and commissions before applying the approved terminal outcome; the cycle remains UNRESOLVED. A global STOP latched for the outcome blocks additional BUY spending only. `REJECTED` and other terminal outcomes likewise do not authorize a replacement SELL or a new BUY cycle.
- A cycle closes only after a fully reconciled FILLED SELL, successful accounting/commitment handling and all applicable profitability gates.
- A later cycle is distinct and requires an eligible CLOSED prior cycle under the approved contract.
- Reaching the RS recovery investment limit blocks new BUYs only. An already-open recovery SELL remains live and untouched: do not cancel, replace or reprice it because the BUY budget is exhausted. Continue canonical fill/order reconciliation until its terminal outcome is known before considering another cycle.
- Do not import Conservative SELL replacement/cancellation behavior.

### 4.5 Profitability is three independent gates

Recovery, legacy (when legacy is included), and combined-cycle profitability must each pass their own applicable condition. Positive profit in one allocation cannot subsidize a loss in another.

A test must assert all three calculated results and the final eligibility decision. Do not assert only a combined total or a boolean.

### 4.6 Actual fills are accounting authority

An order intent, broker acknowledgement, requested quantity, price quote, cancellation request or operator authorization is not an execution. Only canonical confirmed fills change actual holdings. Identical canonical replay is idempotent; conflicting facts under an existing identity must be rejected without partial mutation.

### 4.7 Global safety and reconciliation

**Account-scoped admission precedence:** an active `scope: ACCOUNT` safety blocker is a stronger shared-engine gate than market-level strategy-pause or volatility exceptions. It blocks every BUY/SELL submission across strategies, markets, sides and purposes, including the Recovery Seller recovery-SELL exception. Existing-order reconciliation and confirmed-fill accounting remain non-trading work and continue under their own safety contracts. See [TRADING_FIRST.md](../TRADING_FIRST.md) and [ADR-0008](../architecture/decisions/0008-strategy-safety-pause-cancels-owned-buys.md).

The RS contract requires unexpected, missing, contradictory or unsupported conditions to fail closed. Already-submitted orders and confirmed fills still require reconciliation/accounting; STOP is not permission to abandon them.

The owner resolved the STOP contract on 2026-11-24: STOP blocks additional BUY investment only; otherwise-valid recovery SELLs and reconciliation continue; an authorized administrator may clear STOP only after the cause is fixed, reconciliation/accounting evidence is complete, and the resolution fact is durable. See section 13.

## 5. Configuration inventory and change impact

The audited strategy-level configuration is:

| Level | Field | Scenario impact |
| --- | --- | --- |
| Strategy | `enabled` | Strategy activation/default contract |
| Strategy | `pairs` | Configured market set |
| Pair | `enabled` | Market eligibility |
| Pair | `tradingEnvironment` | TESTNET/LIVE market selection |
| Pair | `enableVolatilityProtection` | Market safety eligibility |
| Pair | `externalOrdersPolicy` | Optional external-order disposition |
| Pair | `orderQuantity` | Recovery BUY tranche |
| Pair | `investment` | Per-pair recovery BUY budget |
| Pair | `sellQuantity` | Additive legacy SELL slice |
| Pair | `legacyPosition.invested` | Operator-declared historical quote investment |
| Pair | `legacyPosition.quantity` | Operator-declared original base quantity |
| Pair | `minProfit` | Minimum required recovery/combined profit |
| Pair | `priceStepPercent` | Price planning input |
| Pair | `makerPercent` | Maker fee reserve |
| Pair | `takerPercent` | Taker fee reserve |
| Resolved runtime market metadata (not operator-authored pair fields) | `pricePrecision` | Exchange-derived price precision from token/market metadata |
| Resolved runtime market metadata (not operator-authored pair fields) | `quantityPrecision` | Exchange-derived quantity precision from token/market metadata |

Primary source paths:

- Operator-maintained pair entries: `apps/harvester/rs-recovery-seller.js`.
- Strategy config composition: `apps/harvester/config/strategies/rs-recovery-seller.js`.
- Config validation/resolution: `apps/harvester/src/domain/app-config.js`.
- Exchange-derived precision source: `apps/harvester/token-specification.json`; do not add `pricePrecision` or `quantityPrecision` to operator-maintained RS pair entries.

External pair entries must use the existing `TRADING_ENVIRONMENTS.BOTH`, `.TESTNET` or `.LIVE` constants and the existing `EXTERNAL_ORDERS_POLICIES.IGNORE` or `.BLOCK` constants; preserve their serialized values. Do not add a second environment/policy vocabulary or create duplicate pair configuration boundaries.

The strategy config currently sets `enabled: true`. This is settled, not an open discrepancy: owner-approved issue [#1713](https://github.com/45s/coinzilla/issues/1713) and merged [PR #1711](https://github.com/45s/coinzilla/pull/1711) approved the enabled-by-default setting, and the canonical RS specification §15 was corrected to match. Preserve this decision; do not reintroduce a disabled-default blocker or change the default in scenario work. Per-pair `enabled` and `tradingEnvironment` remain authoritative for market-route eligibility. This configuration default does not start Harvester or authorize a TESTNET/LIVE exchange session.

**Volatility is market-owned, not RS-owned.** This is an implemented shared-market contract, not a planned RS-specific engine. Current production path (verified after merged [PR #1744](https://github.com/45s/coinzilla/pull/1744), tracked by [#1728](https://github.com/45s/coinzilla/issues/1728)):

- `src/bootstrap/config/resolve-harvester-options.js` builds `marketPairs` from the environment-selected CG pairs plus enabled RS pairs; when both strategies enable the same market, conflicting explicit `enableVolatilityProtection` values are rejected.
- `src/bootstrap/start-harvester.js` passes the effective `startup.pairs` as `volatilityPairs` to the shared Trading Engine and passes the market-data pair set to candle-history startup.
- `src/use-cases/conservative-trading-engine.js` initializes volatility state from `volatilityPairs` and supplies one common market protection eligibility gate to strategy submissions.
- `src/use-cases/create-candle-history-service.js` creates history/state by market symbol for enabled markets with volatility protection enabled; it does not own CG/RS strategy inventory.
- `src/use-cases/create-submission-gate.js` applies the same market-volatility blocker to both strategy submission paths, with an explicit `SELL` + `RECOVERY_SELL` exception for volatility only (all other safety gates still apply).
- `src/use-cases/volatility-protection-workflow.js` scopes volatility-triggered cancellation to Harvester-owned BUY orders; it does not cancel SELL orders or external/manual orders.

An enabled RS-only market therefore receives the same market-level state/gate without a CG execution route. RS scenarios must prove that the real RS submission path respects this shared gate, including the approved recovery-SELL exception and disabled-market behavior. They must not calculate volatility, own candle history, create an RS volatility state machine or duplicate market tests. See [Harvester Volatility Protection](../volatility-protection.md), [#1728](https://github.com/45s/coinzilla/issues/1728) and [PR #1744](https://github.com/45s/coinzilla/pull/1744). This RS proof is reserved as `RS-008-017`.

The runtime references `thirdAssetFeeQuoteValue` in some paths, but it is not part of the validated operator pair configuration contract. Do not document it as a supported user-configurable field or fabricate its source.

**Change-impact rule:** whenever an RS configuration field is added, removed, renamed, retyped, defaulted, or changes validation, the implementing agent must update:

1. The configuration field catalog in the scenario registry.
2. Relevant RS rule/decision links.
3. The scenario matrix and boundary/invalid cases.
4. The repository catalog if observable behavior changes.
5. #1780 and the Harvester roadmap.
6. This playbook only when the scenario-authoring contract or inventory itself changes.

A source diff cannot reliably infer new business meaning. Explicit domain review is mandatory.

## 6. Scenario identity, schema and registry contract

### 6.1 Stable identifiers

Use a stable family ID and stable case ID:

- Family IDs: `RS-001` through `RS-010`.
- Individual case IDs: `RS-001-001`, `RS-001-002`, and so on.
- In §11.1, each numbered required case reserves the matching case ID in that family. For example, RS-004 required case 3 is `RS-004-003`. The IDs remain reserved even while their status is `MISSING`, `BLOCKED` or `UNSUPPORTED`.
- If one numbered case contains multiple independently falsifiable behaviors, retain its parent ID and use letter suffixes such as `RS-003-009-A` and `RS-003-009-B`. Do not hide distinct assertions inside one opaque test.
- Add new cases with the next unused numeric ID in their primary family; never renumber existing cases when inserting or splitting work.
- Never recycle a removed ID for a different behavior.
- A rename of a test title does not change its scenario ID.
- If one case is split, preserve the original ID for the behavior that remains and assign new IDs to genuinely new behaviors; document the mapping.
- Every case belongs to exactly one primary family. It may cover multiple rules/invariants.

### 6.2 Required scenario record

Every executable registry record must contain:

| Field | Required meaning |
| --- | --- |
| `id` | Stable individual scenario ID |
| `family` | RS-001…RS-010 |
| `name` | Plain-English observable business outcome |
| `priority` | P0, P1 or P2 |
| `authority` | Exact specification section and approved decision references |
| `layer` | DOMAIN or APPLICATION; REPLAY only as a deferred disposition |
| `configFields` | Relevant validated RS configuration field IDs |
| `covers.rules` | Stable domain-rule IDs |
| `covers.decisions` | Stable decision/outcome IDs |
| `covers.states` | Actual lifecycle state IDs |
| `covers.transitions` | Stable transition IDs |
| `covers.invariants` | Stable invariant IDs |
| `given` | Explicit canonical initial business facts |
| `when` | Ordered actions/events with identities |
| `then` | Exact observable outputs and state/accounting effects |
| `mustNot` | Forbidden behavior and side effects |
| `subcases` | Array of stable subcase records; each has its own ID, description, status, exact test mapping and evidence |
| `implementation` | Actual production source ownership paths |
| `test` | Exact test file and named test title |
| `status` | Canonical shared-method status |
| `evidence` | Exact command, SHA, workflow and merge evidence; null until verified |

This is a test-authoring schema, not a production DTO or runtime API.

### 6.3 Canonical JavaScript record shape

The registry uses named exports and plain immutable data. The initial implementation must follow existing Harvester ESM/JSDoc conventions.

~~~js
export const recoveryOnlyProfitabilityScenario = Object.freeze({
  id: "RS-004-001",
  family: "RS-004",
  name: "recovery-only cycle still passes its required profit gates",
  priority: "P0",
  authority: [
    "recovery-seller-domain-specification.md#profitability",
    "issue-1780: scenario matrix D and H",
  ],
  layer: "DOMAIN",
  configFields: [
    "RS_PAIR.minProfit",
    "RS_PAIR.sellQuantity",
  ],
  covers: {
    rules: [
      "RS_PROFIT_RECOVERY_MINIMUM",
      "RS_PROFIT_COMBINED_MINIMUM",
      "RS_LEGACY_EXHAUSTION",
    ],
    decisions: ["RS_SELL_ELIGIBILITY"],
    states: ["ACCUMULATING", "SELL_SUBMITTED", "CLOSED"],
    transitions: [
      "RS_ACCUMULATING_TO_SELL_SUBMITTED",
      "RS_FILLED_RECONCILED_TO_CLOSED",
    ],
    invariants: [
      "RS_NO_CROSS_SUBSIDY",
      "RS_LEGACY_EXHAUSTION_DOES_NOT_DISABLE_RECOVERY",
    ],
  },
  given: {
    cycle: {
      cycleId: "rs-scenario-cycle-001",
      positionId: "rs-scenario-position-001",
      status: "ACCUMULATING",
    },
    sellOrderIdentity: {
      clientOrderId: "rs-scenario-mixed-sell-001",
    },
    recoveryCostBasisQuote: "10",
    recoveryNetQuoteProceeds: "10.01",
    legacyBaseDebit: "0",
    legacyNetQuoteProceeds: "0",
    minProfitQuote: "0.01",
  },
  when: [
    { type: "evaluate-recovery-only-profitability" },
    {
      type: "record-sole-sell-submission",
      identity: "rs-scenario-mixed-sell-001",
    },
    {
      type: "reconcile-filled-sell",
      identity: "rs-scenario-mixed-sell-001",
      reconciliationComplete: true,
    },
  ],
  then: {
    legacyApplicable: false,
    recoveryNetProfitQuote: "0.01",
    recoveryEligible: true,
    combinedNetProfitQuote: "0.01",
    combinedEligible: true,
    overallEligible: true,
    cycleStatus: "CLOSED",
  },
  mustNot: [
    "invent or reuse exhausted legacy quantity",
    "skip recovery or combined profitability after legacy exhaustion",
    "close before complete terminal reconciliation",
  ],
  subcases: [
    {
      id: "RS-004-001-A",
      description: "recovery profit exactly at minProfit",
      status: "TEST-MAPPED",
      test: "recovery-only operation still requires recovery and combined profit after legacy exhaustion",
      evidence: {
        exactHead: "4d59272ea22317b3540d2356082b270328542c7e",
        mergedToDevelop: true,
        mergeCommit: "9902d6a01d675a988a40f0fb2130c3eb477675ef",
        ci: "29 successful checks; read-only Binance TESTNET integration skipped",
        exactCommand: null,
      },
    },
    {
      id: "RS-004-001-B",
      description: "recovery profit one smallest exact unit below minProfit",
      status: "MISSING",
      test: null,
      evidence: null,
    },
    {
      id: "RS-004-001-C",
      description: "recovery profit one smallest exact unit above minProfit",
      status: "MISSING",
      test: null,
      evidence: null,
    },
  ],
  implementation: [
    "apps/harvester/src/domain/strategies/recovery-seller/calculate-profitability.js",
    "apps/harvester/src/domain/strategies/recovery-seller/evaluate-sell-decision.js",
    "apps/harvester/src/domain/strategies/recovery-seller/cycle-state.js",
  ],
  test: {
    file: "apps/harvester/test/scenarios/recovery-seller-profitability.scenario.test.js",
    title: "recovery-only operation still requires recovery and combined profit after legacy exhaustion",
  },
  status: "PARTIAL",
  evidence: {
    exactHead: "4d59272ea22317b3540d2356082b270328542c7e",
    mergedToDevelop: true,
    mergeCommit: "9902d6a01d675a988a40f0fb2130c3eb477675ef",
    exactCommand: null,
    note: "The existing exact-threshold case is mapped; adjacent below/above subcases remain missing.",
  },
});
~~~

The example illustrates the schema only. Before implementing it, verify every rule ID, field, source path and test title against the current registry and implementation. Never copy an illustrative record and assume its expected numbers are correct.

### 6.4 Human-readable YAML fixture schema

The issue matrix and catalog may show a compact YAML representation for review. It must mirror the executable record and be labeled illustrative if not linked to an actual registry case.

~~~yaml
scenario:
  id: RS-003-001
  family: RS-003
  priority: P0
  authority:
    - document: recovery-seller-domain-specification.md
      section: sellQuantity is additive
  layer: DOMAIN
  configFields:
    - RS_PAIR.sellQuantity
    - RS_PAIR.legacyPosition.invested
    - RS_PAIR.legacyPosition.quantity
  given:
    cycle:
      cycleId: rs-cycle-001
      positionId: rs-position-001
      status: ACCUMULATING
    recovery:
      netQuantity: "1"
      costQuote: "10"
    legacy:
      authorizedRemainingQuantity: "0.01"
      verifiedSpotUnreservedQuantity: "0.01"
      fixedAverageCostQuotePerBase: "20"
    minProfitQuote: "0.01"
  when:
    - event: evaluate-mixed-sell-plan
  then:
    combinedQuantity: "1.01"
    requiredNetProceedsQuote: "20.20"
    unroundedLimitPriceQuotePerBase: "20.00"
  mustNot:
    - treat sellQuantity as total SELL quantity
    - include off-Spot or reserved legacy quantity
    - replace independent gates with combined-only profitability
  subcases:
    - id: RS-003-001-A
      description: configured legacy slice exceeds verified Spot remainder
      status: SPECIFIED
      test: null
      evidence: null
    - id: RS-003-001-B
      description: legacy exhausted and recovery-only operation
      status: SPECIFIED
      test: null
      evidence: null
    - id: RS-003-001-C
      description: exact tick, step and notional boundaries
      status: SPECIFIED
      test: null
      evidence: null
  implementation:
    - apps/harvester/src/domain/strategies/recovery-seller/calculate-sell-plan.js
  test:
    file: NOT MAPPED
    title: NOT MAPPED
  status: SPECIFIED
  evidence: null
~~~

### 6.5 Registry validation rules

The registry validator must fail when:

- An ID is duplicated, malformed, recycled or missing.
- A family ID is not one of RS-001…RS-010.
- A required field is missing or has the wrong shape.
- A status is outside the canonical vocabulary.
- A rule, decision, state, transition, invariant or config-field reference is unknown.
- A scenario claims an implementation path that does not exist.
- A VERIFIED record lacks a test file, named case, exact SHA and required evidence.
- A BLOCKED record has no explanation and explicit unblock condition.
- An UNSUPPORTED record claims executable support or omits its contract reason.
- A test mapping is copied from an existing ordinary RS regression test and presented as new #1780 scenario evidence.

The validator checks references and structure. It does not prove that assertions are meaningful or that a financial oracle is correct; those require review.

### 6.6 Ordered runner handler contract

The thin ordered step dispatcher may execute only an **own property** explicitly registered in the supplied handler map. Inherited names such as `toString` or `constructor` are not scenario operations and must fail as missing handlers. Do not let JavaScript prototype properties silently satisfy a declared step type.

## 7. Stable rule, decision, state and invariant catalogs

The first registry slice must establish identifiers for real concepts used by scenarios. IDs are stable references, not a new domain implementation.

### 7.1 Configuration field IDs

Use namespaced IDs such as:

- `RS_STRATEGY.enabled`
- `RS_STRATEGY.pairs`
- `RS_PAIR.enabled`
- `RS_PAIR.tradingEnvironment`
- `RS_PAIR.enableVolatilityProtection`
- `RS_PAIR.externalOrdersPolicy`
- `RS_PAIR.orderQuantity`
- `RS_PAIR.investment`
- `RS_PAIR.sellQuantity`
- `RS_PAIR.legacyPosition.invested`
- `RS_PAIR.legacyPosition.quantity`
- `RS_PAIR.minProfit`
- `RS_PAIR.priceStepPercent`
- `RS_PAIR.makerPercent`
- `RS_PAIR.takerPercent`
- `RS_MARKET.pricePrecision` (resolved runtime metadata, not an operator pair field)
- `RS_MARKET.quantityPrecision` (resolved runtime metadata, not an operator pair field)

These names describe the current config contract. Update them only after verifying current validator/config source.

### 7.2 Rule IDs

Start with stable rule IDs grouped by concern. A rule ID must have one concise business meaning and a link to its authority.

Examples:

- Authorization/custody: `RS_LEGACY_BASIS_REQUIRED`, `RS_SPOT_CUSTODY_REQUIRED`, `RS_EXTERNAL_INVENTORY_NOT_OWNED`.
- BUY: `RS_BUY_CONFIRMED_FILL_ONLY`, `RS_BUY_NET_BASE_AFTER_FEES`, `RS_BUY_ACTUAL_QUOTE_COST`, `RS_BUY_BUDGET_LIMIT`.
- SELL: `RS_SELL_ADDITIVE_LEGACY_SLICE`, `RS_SELL_VERIFIED_UNRESERVED_QUANTITY`, `RS_SELL_ONE_LIFECYCLE_PER_CYCLE`.
- Profit: `RS_PROFIT_RECOVERY_MINIMUM`, `RS_PROFIT_LEGACY_NON_NEGATIVE`, `RS_PROFIT_COMBINED_MINIMUM`, `RS_NO_CROSS_SUBSIDY`.
- Accounting: `RS_CANONICAL_FILL_EXACT_ONCE`, `RS_MIXED_ALLOCATION_CONSERVATION`, `RS_DUAL_PROJECTION_ATOMICITY`.
- Safety: `RS_UNKNOWN_OUTCOME_NO_RETRY`, `RS_STOP_BLOCKS_NEW_TRADING`, `RS_RECONCILIATION_CONTINUES`.
- Shared account: `RS_ACCOUNT_BASE_RESERVATION`, `RS_ACCOUNT_QUOTE_RESERVATION`, `RS_STRATEGY_OWNERSHIP_ISOLATION`.

Do not create duplicate rule IDs for the same rule. If the contract changes, update the authority reference and scenario impact.

### 7.3 Decision IDs

At minimum, identify the decisions whose observable outcomes are tested:

- `RS_BUY_ELIGIBILITY`
- `RS_SELL_ELIGIBILITY`
- `RS_SELL_PLAN`
- `RS_ORDER_LIFECYCLE`
- `RS_TERMINAL_RECONCILIATION`
- `RS_STOP_GATE`
- `RS_ACCOUNT_ALLOCATION`

Actual decision outcome strings are the production contract. Current lifecycle outcomes include `SUBMIT`, `WAIT`, `BLOCK` and `RECONCILE`. Verify source enums/constants rather than duplicating strings in multiple registries.

### 7.4 State and transition IDs

Cycle states are the five values listed in section 4.3. Transition IDs should describe actual permitted transitions, not every imagined graph edge. Examples:

- `RS_ACCUMULATING_TO_SELL_SUBMITTED`
- `RS_SELL_SUBMITTED_TO_RECONCILIATION_REQUIRED`
- `RS_SELL_SUBMITTED_TO_UNRESOLVED`
- `RS_RECONCILIATION_REQUIRED_TO_UNRESOLVED`
- `RS_RECONCILED_FILLED_TO_CLOSED`
- `RS_CLOSED_TO_NEXT_ACCUMULATING_CYCLE`

The exact validator/factory is authoritative. For every transition, record:

1. Previous full state.
2. Event identity and facts.
3. Guard/preconditions.
4. Next full state.
5. Portfolio/Position/order/reservation mutation.
6. Accounting delta.
7. Emitted side effects.
8. Duplicate/conflict behavior.
9. Failure atomicity and reconciliation outcome.

A status-only assertion is not transition proof.

### 7.5 Invariant IDs

Start with these invariant categories:

- Stable ownership: strategy, market, Position, cycle, order and fill identities agree.
- No synthetic inventory: config and balances do not create fills.
- Custody conservation: only verified, unreserved Spot is eligible for a Spot SELL.
- Quantity conservation: recovery allocation + legacy allocation equals canonical SELL Fill quantity under approved fee treatment.
- Financial conservation: all actual costs, proceeds and commissions are allocated once.
- No cross-subsidy: recovery, legacy and combined gates are independently evaluated.
- Exact-once: identical canonical events do not mutate accounting twice.
- Conflict rejection: changed facts under a stable identity do not partially mutate state.
- Atomicity: recovery and legacy projections commit together or neither changes.
- One SELL: a cycle cannot acquire a second SELL identity.
- Reservation conservation: commitments cannot exceed account-available quote/base.
- STOP safety: new BUY spending is blocked; otherwise-valid recovery SELLs and permitted reconciliation/accounting continue.
- Cycle closure: only approved fully reconciled outcomes close a cycle.

An invariant ID is not covered by one happy-path test. It needs adversarial cases that could falsify it.

## 8. Test-layer selection and production composition

Follow the shared [Domain Scenario Testing Methodology](../../../../docs/testing/DOMAIN_SCENARIO_TESTING.md). RS-specific layer choices are:

### 8.1 DOMAIN scenarios

Use DOMAIN when the claim is a deterministic RS policy, calculation, allocation, state transition or accounting rule.

- Compose real RS domain modules.
- Use canonical domain entities/factories for Portfolio, Position, Fill, Order and market metadata.
- Do not create broker mocks for a pure calculation.
- Do not hand-code a fake RS evaluator or accounting projection.
- Assert exact returned decisions and full relevant state.

Typical real components include:

- `calculate-profitability.js`
- `calculate-sell-plan.js`
- `cycle-state.js`
- `evaluate-buy-decision.js`
- `evaluate-sell-decision.js`
- `legacy-position.js`
- `legacy-spot-allocation.js`
- `mixed-sell-fill-allocation.js`
- `mixed-sell-fill-accounting.js`
- `mixed-sell-fill-reconciliation.js`
- `lifecycle-decision.js`
- `stop-decision.js`

### 8.2 APPLICATION scenarios

Use APPLICATION when the claim depends on orchestration, broker-call count, order identity, durable reservation, REST/stream reconciliation, event ordering, persistence or atomic workflow boundaries.

Compose real use cases and inject deterministic fake external ports:

- `create-recovery-seller-accounting-workflow.js`
- `create-recovery-seller-action-authorizer.js`
- `create-recovery-seller-order-submitter.js`
- `create-recovery-seller-runtime-evaluator.js`
- `create-recovery-seller-stop-workflow.js`
- `create-recovery-seller-transition-evaluator.js`
- `record-recovery-seller-mixed-sell-reconciled.js`
- `resolve-recovery-seller-stop.js` only for behavior permitted by the resolved contract.

A domain test cannot claim that the broker was called once, a reservation is durable, or a persistence barrier was crossed. Those are application-level assertions.

Scenario Runner application-level cases tracked under issue #1836 are maintained separately in `docs/testing/SCENARIO_CATALOG.md`. They exercise production use cases with simulated ports, but they do not count as domain scenario-suite coverage under #1780 and must not promote an RS family to VERIFIED.

### 8.3 REPLAY scenarios

Full RS process restart/replay is currently unsupported/deferred. Do not add tests that claim restart restoration works. A test may verify that unsupported RS replay is rejected or that an existing CG-only replay path does not accidentally restore RS, but label the exact claim and do not promote it to supported restart coverage.

### 8.4 Test layer decision table

| Business claim | Required layer |
| --- | --- |
| Exact fee-aware SELL proceeds target | DOMAIN, plus APPLICATION no-submit boundary if order submission is claimed |
| Additive recovery + legacy allocation | DOMAIN |
| Actual canonical Fill attribution and accounting | DOMAIN; APPLICATION if event/reconciliation workflow is claimed |
| One SELL identity per cycle | DOMAIN state transition and APPLICATION broker-call/reservation proof |
| Unknown submission cannot retry | APPLICATION |
| REST-first and stream-first duplicate handling | APPLICATION with controlled event delivery |
| Recovery/legacy projections commit together | DOMAIN projection plus APPLICATION durable boundary when persistence is part of the claim |
| CG and RS cannot over-reserve account base/quote | Real shared allocator, composed in APPLICATION scenario for cross-strategy runtime claims |
| STOP blocks new BUY spending; eligible recovery SELL and reconciliation continue | APPLICATION |
| Process restart restores RS state | UNSUPPORTED until separately authorized |

## 9. Fixtures, builders and deterministic external ports

### 9.1 Fixture rules

A fixture must expose the business facts a reader needs to understand the scenario. Do not hide key inputs in opaque helper defaults.

Required principles:

- Use exact decimal strings at scenario boundaries.
- Create canonical Portfolio/Position/Fill/Order objects with production factories/constructors.
- Include strategy, market, Position, cycle, order and fill identity wherever the production contract requires them.
- Separate operator legacy basis from verified Spot custody.
- Separate exchange free balance from total wallet/EARN balance.
- Include existing account commitments and reservations when relevant.
- Keep maker/taker fees, fee asset, price, quantity, precision and TradingRules explicit.
- Use fixed IDs and deterministic timestamps.
- Keep fixture defaults neutral; no magic DOGE/ZRO production assumptions.
- Return immutable snapshots or fresh state per scenario; avoid state leaking between cases.
- Do not use the same production helper to calculate both actual and expected financial values.

A builder may reduce mechanical construction. It must not decide whether an order is eligible, calculate expected profitability, allocate inventory, or apply a fill using a parallel implementation.

Follow Harvester's DDD boundary: pure deterministic trading calculations/decisions are domain functions; state-owning classes enforce lifecycle invariants; use cases coordinate workflows through injected ports. Use named exports and the established ESM/JSDoc style; do not add default exports to Harvester domain/config modules. Every assertion must have a detailed failure message, compare named fields rather than opaque tuples, and use plain-English test names that explain the business behavior.

### 9.2 Fixture responsibility

| Builder | May do | Must not do |
| --- | --- | --- |
| Market fixture | Create explicit market symbol, asset metadata, precision and TradingRules | Silently make invalid filters valid |
| Portfolio fixture | Instantiate real Portfolio and strategy-owned Position objects | Reimplement Portfolio accounting |
| Fill fixture | Construct canonical Fill from explicit execution facts | Derive expected profit with production calculation |
| Order fixture | Construct canonical order/ownership identity | Invent accepted order ownership |
| Spot custody fixture | Supply a named authoritative snapshot | Treat wallet total/EARN as free Spot |
| Broker fake | Record calls and return configured outcomes | Decide RS policy |
| Store fake | Record writes and fail at named boundaries | Simulate durable success without recording it |
| Event controller | Deliver exact events in selected order | Mutate accounting behind production workflow |
| Failure injector | Fail at a named boundary | Skip the production boundary being tested |
| Financial oracle | Independently calculate expected amounts from primitive inputs | Import the production helper under test |

### 9.3 Application fake broker contract

The fake broker must be controllable for at least:

- Accepted order with canonical response.
- Explicit rejection.
- Timeout before acceptance.
- Timeout after broker acceptance but before response.
- Unknown outcome with original client identity.
- Active/open order query.
- Terminal order query.
- Missing order history.
- Partial fill followed by terminal state.
- Duplicate execution event.
- Conflicting execution facts.
- REST and stream delivery in either order.

The fake must expose a call log. Assertions inspect exact call count, symbol, side, quantity, price, client identity and order type as relevant. A test claiming no retry must assert that the second broker submission did not happen.

### 9.4 Persistence fake contract

The persistence fake must record operation order and allow failures at explicit boundaries:

- Before durable order intent.
- After durable intent but before broker call.
- After broker acceptance but before durable acknowledgement.
- Before fill fact append.
- After fill fact append but before projection commit.
- Recovery projection failure.
- Legacy projection failure.
- Before/after reservation release.
- Before/after terminal cycle outcome persistence.

Do not call an in-memory mutation durable. If a scenario claims durable ordering, assert the recorded append/flush/commit boundary and resulting state.

### 9.5 Controlled event delivery

Support explicit sequences such as:

~~~text
REST history -> stream fill -> duplicate REST history
stream fill -> REST history -> duplicate stream fill
partial stream fill -> terminal REST snapshot -> late duplicate stream fill
unknown submit response -> order lookup active -> terminal history
unknown submit response -> order lookup not found
unknown submit response -> lookup failure
~~~

Every event must carry canonical identity and exact facts. Identical duplicates should be no-ops. Conflicting facts must be rejected without partial mutation. Incomplete history must not be treated as a complete terminal result.

## 10. Independent financial oracles

### 10.1 Exact decimal requirements

- Use the repository's established exact decimal primitives for production values and test comparisons.
- Scenario input values must be strings such as `"0.01"`, not JavaScript floating-point literals.
- Do not use `Number`, `parseFloat`, or binary floating-point arithmetic to derive financial expected values.
- Keep units explicit: base quantity, quote amount, price per base, commission amount and commission asset.
- Assert exact serialized decimal results where the boundary exposes canonical decimal strings.
- Independently derive expected results from scenario inputs. Do not call the production planner/profitability helper to calculate the expected value.

### 10.2 Required mixed SELL oracle example

The RS specification's no-commission ZRO example is the reference worked example:

| Input | Value |
| --- | ---: |
| Recovery quantity | 1 ZRO |
| Recovery cost | 10.00 USDT |
| Legacy quantity | 0.01 ZRO |
| Legacy average cost | 20.00 USDT/ZRO |
| Legacy cost | 0.20 USDT |
| Minimum profit | 0.01 USDT |
| Combined quantity | 1.01 ZRO |

Derive the minimum net proceeds independently:

~~~text
Recovery requirement = (10.00 + 0.01) * 1.01 / 1
                     = 10.1101 USDT

Legacy requirement   = 0.20 * 1.01 / 0.01
                     = 20.20 USDT

Combined requirement = 10.00 + 0.20 + 0.01
                     = 10.21 USDT

Required proceeds    = max(10.1101, 20.20, 10.21)
                     = 20.20 USDT

Unrounded price      = 20.20 / 1.01
                     = 20.00 USDT/ZRO
~~~

This proves why a combined-only calculation is incorrect: 10.21 USDT does not satisfy the independent 20.20 USDT legacy proceeds requirement.

### 10.3 Cross-subsidy examples

Both directions must fail:

| Recovery profit | Legacy profit | Combined profit | Expected |
| ---: | ---: | ---: | --- |
| +0.15 USDT | -0.01 USDT | +0.14 USDT | FAIL: legacy gate |
| -0.005 USDT | +0.10 USDT | +0.095 USDT | FAIL: recovery gate |

A passing combined result never overrides a failing required allocation.

### 10.4 Fee handling

Scenarios must distinguish:

- BUY base-asset commission: reduces net acquired base quantity.
- BUY quote-asset commission: increases actual quote cost.
- SELL base-asset commission: affects base quantity allocation according to the approved accounting contract.
- SELL quote-asset commission: reduces net quote proceeds.
- Third-asset commission: requires authoritative quote valuation; missing/ambiguous valuation must not be treated as zero.
- Multiple commission records and mixed fee assets: aggregate exactly once, with correct ownership and allocation.

Do not hard-code a fee assumption just because a fixture uses it. Label synthetic fixture prices, proceeds and commissions explicitly.

### 10.5 Boundaries

For each applicable monetary/quantity threshold, cover:

- Exactly equal.
- One smallest meaningful exact unit below.
- One smallest meaningful exact unit above.

For exchange rules, use the real TradingRules contract and test tick size, step size, minimum/maximum price, minimum/maximum quantity and minimum/maximum notional as applicable. Assert exact rounded quantity/price and net proceeds, not only whether a plan exists. Include tiny quantities whose decimal serialization may use exponent notation, wrong symbol/base/quote metadata, and UTC timestamp/freshness plus canonical market-readiness boundaries wherever they gate an RS decision.

### 10.6 Worked fee and accounting oracle examples

These examples are synthetic fixtures designed to make the arithmetic auditable. They are not market recommendations, runtime defaults or approved fee schedules. Expected values are derived below from the stated facts; never call the production planner/accounting/profitability function to calculate the expected result. Use exact decimal strings (or exact rational arithmetic) in the test. Do not convert any input to JavaScript Number.

#### 10.6.1 BUY commission asset changes a different quantity

**Base-asset fee**

~~~text
Canonical BUY Fill:
  gross base quantity = 1.000000 BTC
  gross quote quantity = 10.000000 USDT
  base commission = 0.001000 BTC

Net acquired base = 1.000000 - 0.001000
                  = 0.999000 BTC

Actual quote cost = 10.000000 USDT
~~~

The base fee reduces acquired Position quantity. It does not increase quote spend.

**Quote-asset fee**

~~~text
Canonical BUY Fill:
  gross base quantity = 1.000000 BTC
  gross quote quantity = 10.000000 USDT
  quote commission = 0.010000 USDT

Net acquired base = 1.000000 BTC
Actual quote cost = 10.000000 + 0.010000
                  = 10.010000 USDT
~~~

The quote fee increases the recovery cost basis. Do not subtract it from base quantity.

#### 10.6.2 Partial fills and multiple BUY tranches

One BUY order may produce multiple canonical fills. Apply each Fill once; aggregate confirmed facts, not the requested order quantity.

~~~text
Partial Fill A:
  gross base = 0.400000
  gross quote = 4.000000
  base fee = 0.000400
  net base = 0.399600

Partial Fill B:
  gross base = 0.600000
  gross quote = 6.600000
  base fee = 0.000600
  net base = 0.599400

Order totals:
  gross base = 1.000000
  gross quote = 10.600000
  base fees = 0.001000
  net acquired base = 0.999000
  actual quote cost = 10.600000
~~~

For separate BUY tranches at different prices, retain each canonical Fill's actual cost and fee asset:

~~~text
Tranche A:
  gross base = 1.000000
  gross quote = 10.000000
  base fee = 0.001000
  net base = 0.999000
  quote cost = 10.000000

Tranche B:
  gross base = 2.000000
  gross quote = 24.000000
  quote fee = 0.024000
  net base = 2.000000
  quote cost = 24.024000

Combined:
  gross base = 3.000000
  net base = 2.999000
  gross quote = 34.000000
  actual quote cost = 34.024000
  gross execution VWAP = 34.000000 / 3.000000
  net-base cost per unit = 34.024000 / 2.999000
~~~

The VWAP expression and the net-base cost expression are deliberately different. Do not use gross execution VWAP as a substitute for fee-aware cost per acquired net base. Legacy original invested quote/quantity/average cost is independent and must not be rewritten by these recovery BUY tranches.

#### 10.6.3 One canonical mixed SELL Fill with base and quote commissions

This example demonstrates the exact split implemented for a single canonical Fill. The legacy authorization has 0.010010 ZRO verified and unreserved; the configured per-cycle legacy slice is sellQuantity = 0.010000 ZRO. The extra 0.000010 ZRO covers the base-asset commission. Recovery inventory available is 0.990990 ZRO.

~~~text
Canonical SELL Fill:
  gross base quantity = 1.000000 ZRO
  gross quote proceeds = 21.000000 USDT
  base commission = 0.001000 ZRO
  quote commission = 0.021000 USDT

Gross allocation:
  recovery = 0.990000 ZRO (99% of Fill quantity)
  legacy   = 0.010000 ZRO (1% of Fill quantity)

Base commission split:
  recovery = 0.001000 * 99% = 0.000990 ZRO
  legacy   = 0.001000 - 0.000990 = 0.000010 ZRO

Base debit:
  recovery = 0.990000 + 0.000990 = 0.990990 ZRO
  legacy   = 0.010000 + 0.000010 = 0.010010 ZRO
  total    = 1.001000 ZRO

Gross quote proceeds split:
  recovery = 21.000000 * 99% = 20.790000 USDT
  legacy   = 21.000000 - 20.790000 = 0.210000 USDT

Quote commission split:
  recovery = 0.021000 * 99% = 0.020790 USDT
  legacy   = 0.021000 - 0.020790 = 0.000210 USDT

Net quote proceeds:
  recovery = 20.790000 - 0.020790 = 20.769210 USDT
  legacy   = 0.210000 - 0.000210 = 0.209790 USDT
  total    = 20.979000 USDT
~~~

For this illustrative profitability check, use recovery cost basis 10.000000 USDT, legacy average cost 20.000000 USDT/ZRO, and minProfit = 0.010000 USDT:

~~~text
Legacy cost consumed = 0.010010 * 20.000000
                     = 0.200200 USDT

Recovery net profit = 20.769210 - 10.000000
                    = 10.769210 USDT  (passes 0.010000 minimum)

Legacy net profit   = 0.209790 - 0.200200
                    = 0.009590 USDT   (passes non-loss gate)

Combined net profit = 20.979000 - (10.000000 + 0.200200)
                    = 10.778800 USDT  (passes 0.010000 minimum)
~~~

The accounting assertions are the base debits 0.990990 + 0.010010 = 1.001000 ZRO and net proceeds 20.769210 + 0.209790 = 20.979000 USDT. The original Fill remains the sole execution fact. The allocation metadata does not create synthetic recovery or legacy Fills.

#### 10.6.4 Quote-fee gross-up and exchange tick rounding

Assume the independent proceeds oracle requires 20.20 USDT net, the quote fee reserve is 0.001 (0.1%), total SELL quantity is 1.01, and the market price tick is 0.01.

~~~text
Gross quote target = 20.20 / (1 - 0.001)
                   = 20.20 / 0.999
                   = 20.220220... USDT

Unrounded minimum price = 20.220220... / 1.01
                        = 20.020020... USDT

Round price UP to 0.01 tick:
  planned price = 20.03 USDT

At 1.01 quantity:
  gross quote proceeds = 1.01 * 20.03
                       = 20.2303 USDT
  quote fee = 20.2303 * 0.001
            = 0.0202303 USDT
  net quote proceeds = 20.2303 - 0.0202303
                     = 20.2100697 USDT
~~~

The rounded plan preserves the required 20.20 USDT net proceeds. The repeating division must use the repository's exact decimal scale/rounding contract; the independent oracle should compare the resulting tick-aligned price and proceeds, not a JavaScript floating-point approximation.

For a base-asset SELL fee, the order quantity must also be grossed up against available base. Example: 1.001000 ZRO available, base fee rate 0.001, and quantity step 0.001 produce a gross order quantity of 1.000 ZRO, base fee 0.001 ZRO, and total base debit 1.001 ZRO. The order quantity alone is not the full base debit.

#### 10.6.5 Exact profitability threshold neighbors

If the quote precision for the scenario supports six decimal places, use this illustrative boundary:

~~~text
recoveryCostBasis = 10.000000 USDT
minProfit = 0.010000 USDT
required recovery net proceeds = 10.010000 USDT

10.009999 -> FAIL (one quote unit below)
10.010000 -> PASS (exact equality)
10.010001 -> PASS (one quote unit above)
~~~

The actual smallest unit must come from the market/quote precision under test. Do not assume six decimal places for every market. Test recovery, legacy and combined gates independently; a passing combined result never repairs a failing allocation gate.

#### 10.6.6 Dust is a post-completion classification, not a filter bypass

Assume a cycle has already reached terminal FILLED, complete reconciliation, atomic accounting commit, released reservations and passed every applicable profitability gate. A residual of 0.020 ZRO at 100 USDT/ZRO is worth 2.00 USDT. If the current MIN_NOTIONAL is 5.00 USDT and quantity/step constraints otherwise pass, this residual may be recorded as retained bonus dust with exact quantity 0.020 ZRO and limiting filter MIN_NOTIONAL. It is permanently excluded from future recovery inventory, legacy inventory, SELL targets and profitability.

The same 0.020 ZRO proposed as a candidate SELL before successful cycle completion is not dust: the candidate violates MIN_NOTIONAL and follows the approved global STOP/filter-failure contract. A residual that remains sellable is not dust and cannot be silently discarded. This example does not authorize standalone final-residual liquidation without a new BUY; that behavior remains unresolved.

### 10.7 Complete end-to-end worked scenarios

Sections 10.2–10.6 provide focused arithmetic oracles. The scenarios below connect those calculations to Portfolio/Position facts, legacy custody, order identity, lifecycle transitions, final accounting and forbidden side effects. They are **illustrative contract walkthroughs**, not production DTO fixtures: the Portfolio/Position blocks are logical audit views, not claims about the exact serialized object shape. Executable tests must construct the actual production entities through their canonical factories and assert their real fields.

Every important scenario added to the registry must include this same evidence sequence:

1. Initial shared Portfolio and strategy-owned Position snapshot.
2. Separately identified legacy basis, verified Spot custody and unreserved quantity.
3. Exact canonical BUY/SELL Fill facts, including fee asset and amount.
4. Ordered decisions, order identities, state transitions and reservation changes.
5. Independently calculated recovery, legacy and combined accounting.
6. Final Portfolio/Position and legacy projection, including unchanged unrelated ownership.
7. Explicit expected decision and a list of side effects that must not occur.

A scenario that starts only from a prebuilt recovery Position may still be useful for a narrow SELL-domain rule, but it does not prove the preceding BUY workflow. Link it to a separate BUY scenario rather than claiming full-cycle coverage.

#### RS-E2E-001 — successful mixed cycle with two BUY fills and two SELL fills

**Purpose:** prove that actual BUY commissions establish net recovery inventory/cost, that the configured legacy slice is additive, that partial SELL fills are staged under one order identity, and that terminal reconciliation commits both accounting projections exactly once.

**Configuration and initial facts**

~~~text
Market: ZRO/USDT
orderQuantity: 1.000000 ZRO
sellQuantity: 0.010000 ZRO
legacyPosition.quantity: 0.010000 ZRO
legacyPosition.invested: 0.200000 USDT
legacy average cost: 20.000000 USDT/ZRO
minProfit: 0.010000 USDT
SELL quote commission: 0.1%
Other commissions: none
~~~

Logical initial Portfolio / Position snapshot:

| Owner / projection | Base quantity | Recovery cost / spent | Notes |
| --- | ---: | ---: | --- |
| RS recovery Position | 0.000000 ZRO | 0.000000 USDT | New cycle; no confirmed BUY fills |
| Other strategy Position(s) | 0.000000 ZRO | 0.000000 USDT | No ZRO claim in this fixture |
| RS legacy authorization | 0.010000 ZRO | 0.200000 USDT historical basis | Separate from the RS recovery Position |
| Spot ZRO custody snapshot | 0.010000 ZRO | — | Total and free are both 0.010000 before the recovery BUY |

The fixture must also state that there are no active ZRO SELL reservations, no pending/unknown RS order, and no other account commitment that reduces the available balance. Do not infer free balance from total custody in a test that includes locks or commitments.

**BUY facts and first transition**

One BUY order identity, `rs-e2e-001-buy`, is filled in two canonical executions:

~~~text
Fill B1:
  gross base = 0.400000 ZRO
  gross quote = 4.000000 USDT
  quote commission = 0.004000 USDT
  net base = 0.400000 ZRO
  actual quote cost = 4.004000 USDT

Fill B2:
  gross base = 0.600000 ZRO
  gross quote = 6.000000 USDT
  quote commission = 0.006000 USDT
  net base = 0.600000 ZRO
  actual quote cost = 6.006000 USDT

BUY totals:
  confirmed gross base = 1.000000 ZRO
  net recovery quantity = 1.000000 ZRO
  actual recovery cost = 10.010000 USDT
~~~

After B1, the RS Position reflects only 0.400000 net ZRO and 4.004000 USDT cost. After B2, it reflects 1.000000 net ZRO and 10.010000 USDT cost. The cycle remains `ACCUMULATING`; an order acknowledgement alone must not create either amount.

**SELL planning and fills**

The target is the net recovery inventory plus the eligible legacy slice:

~~~text
Recovery quantity = 1.000000 ZRO
Legacy quantity = 0.010000 ZRO
SELL target = 1.010000 ZRO
~~~

One SELL identity, `rs-e2e-001-sell`, is submitted. Its two canonical partial fills are:

~~~text
Fill S1:
  gross base = 0.500000 ZRO
  gross quote = 10.500000 USDT
  quote commission = 0.010500 USDT
  net quote = 10.489500 USDT

Fill S2:
  gross base = 0.510000 ZRO
  gross quote = 10.710000 USDT
  quote commission = 0.010710 USDT
  net quote = 10.699290 USDT

SELL totals:
  gross base = 1.010000 ZRO
  gross quote = 21.210000 USDT
  quote commission = 0.021210 USDT
  net quote proceeds = 21.188790 USDT
~~~

The order remains the sole active SELL after S1. S2 does not by itself prove terminal completion. The scenario then supplies authoritative terminal `FILLED` order history containing exactly S1 and S2; REST/stream duplicates of either canonical Fill are delivered and must be idempotent.

For the independent allocation oracle, the gross base split is 1.000000 ZRO recovery and 0.010000 ZRO legacy (100:1). The quote proceeds and quote fee use that same split:

~~~text
Recovery gross proceeds = 21.000000 USDT
Recovery quote fee = 0.021000 USDT
Recovery net proceeds = 20.979000 USDT

Legacy gross proceeds = 0.210000 USDT
Legacy quote fee = 0.000210 USDT
Legacy net proceeds = 0.209790 USDT

Recovery cost = 10.010000 USDT
Legacy cost consumed = 0.010000 * 20.000000
                    = 0.200000 USDT

Recovery net profit = 20.979000 - 10.010000
                    = 10.969000 USDT

Legacy net profit = 0.209790 - 0.200000
                  = 0.009790 USDT

Combined net profit = 21.188790 - (10.010000 + 0.200000)
                    = 10.978790 USDT
~~~

All applicable gates pass: recovery profit is at least 0.010000 USDT, legacy is non-loss-making, and combined profit is at least 0.010000 USDT.

**Required transition and final state**

~~~text
ACCUMULATING
  -- confirmed BUY fills B1 and B2 -->
ACCUMULATING (1.000000 net recovery ZRO; 10.010000 USDT cost)
  -- submit sole SELL identity rs-e2e-001-sell -->
SELL_SUBMITTED
  -- S1 partial fill -->
SELL_SUBMITTED (S1 staged; reservation remains)
  -- S2 partial fill -->
SELL_SUBMITTED (S1 and S2 staged; reservation remains until terminal facts)
  -- terminal FILLED + complete canonical history + atomic accounting -->
CLOSED
~~~

Final logical accounting:

| Projection | Final base quantity | Cost basis consumed | Net proceeds | Net result |
| --- | ---: | ---: | ---: | ---: |
| RS recovery Position/cycle | 0.000000 ZRO | 10.010000 USDT | 20.979000 USDT | +10.969000 USDT |
| RS legacy allocation | 0.000000 ZRO remaining from authorized slice | 0.200000 USDT | 0.209790 USDT | +0.009790 USDT |
| Combined cycle | 1.010000 ZRO sold | 10.210000 USDT | 21.188790 USDT | +10.978790 USDT |

The RS recovery Position has no remaining quantity from this cycle. The legacy remainder is decremented by exactly 0.010000 ZRO, once, only after the complete terminal reconciliation and atomic recovery/legacy accounting commit. Unrelated Portfolio Positions and other strategy budgets remain unchanged. The order reservation is released only after the authoritative terminal state and complete fill reconciliation.

**Expected decision:** SELL is eligible; after complete terminal reconciliation and successful accounting, the cycle is `CLOSED`.

**Forbidden side effects:** no second SELL identity; no replacement/reprice after S1; no legacy decrement on planning, submission or partial-fill delivery; no duplicate accounting for replayed S1/S2; no fee treated as zero; no double subtraction of Spot locks/commitments; no mutation of another strategy's Position or budget; no next cycle before closure.

#### RS-E2E-002 — recovery profit cannot subsidize a legacy loss

**Purpose:** prove that a positive recovery result and positive combined result cannot override a failing legacy gate.

Initial logical state:

| Projection | Quantity | Cost |
| --- | ---: | ---: |
| RS recovery Position | 1.000000 ZRO | 10.000000 USDT |
| RS legacy authorization | 0.010000 ZRO | 0.200000 USDT (20.000000 USDT/ZRO) |
| Combined candidate | 1.010000 ZRO | 10.200000 USDT |

There are no active orders or reservations. The single SELL order is fully filled for 1.010000 ZRO at 15.000000 USDT/ZRO. No commission applies. The exact allocation is:

~~~text
Recovery gross/net proceeds = 1.000000 * 15.000000
                            = 15.000000 USDT
Legacy gross/net proceeds = 0.010000 * 15.000000
                          = 0.150000 USDT

Recovery profit = 15.000000 - 10.000000
                = +5.000000 USDT  (passes)

Legacy profit = 0.150000 - 0.200000
              = -0.050000 USDT  (fails)

Combined profit = 15.150000 - 10.200000
                = +4.950000 USDT  (passes)
~~~

This is a pre-submission decision scenario: the SELL is only a candidate, not an execution. No canonical SELL Fill exists. The production evaluator must reject the candidate before broker submission. The Portfolio/Position and legacy projections therefore remain exactly as initialized: recovery quantity 1.000000 ZRO and cost 10.000000 USDT; legacy quantity 0.010000 ZRO and basis 0.200000 USDT; no proceeds and no realized accounting delta. The cycle remains `ACCUMULATING`.

**Expected decision:** `BLOCK`/ineligible before submission because `RS_PROFIT_LEGACY_NON_NEGATIVE` fails, even though recovery and combined gates pass. Assert the exact production decision value returned by the evaluator.

**Forbidden side effects:** no broker call; no SELL identity or reservation; no Portfolio/Position mutation; no legacy decrement; no cross-subsidy; no hiding the legacy loss in a combined number.

#### RS-E2E-003 — unknown SELL submission is reconciled, never blindly retried

**Purpose:** prove that an ambiguous broker response preserves the original order identity and reservation and does not create a duplicate SELL.

Initial logical state:

| Projection | Quantity | Cost |
| --- | ---: | ---: |
| RS recovery Position | 1.000000 ZRO | 10.000000 USDT |
| RS legacy authorization | 0.010000 ZRO | 0.200000 USDT |
| Eligible SELL candidate | 1.010000 ZRO | — |

There are no pre-existing orders or reservations. The application durably records the sole client identity `rs-e2e-003-sell` and its base reservation, then calls the broker once. The broker may have accepted the order, but the response times out before the application receives an acknowledgement.

~~~text
Before submit:
  cycle = ACCUMULATING
  sell identity = none
  confirmed SELL fills = none
  SELL reservation = 0

Durable intent + broker call:
  client identity = rs-e2e-003-sell
  broker submit calls = 1
  response = unknown / timeout

After unknown outcome:
  cycle = RECONCILIATION_REQUIRED
  sell identity = rs-e2e-003-sell (preserved)
  confirmed SELL fills = none
  reservation = 1.010000 ZRO (retained)
  Portfolio / Position accounting = unchanged
~~~

The next application action is reconciliation using the same client/order identity. The test must cover at least: order found active; terminal order found with complete fills; order lookup not found; and lookup itself unavailable. Until authoritative facts resolve the outcome, no new SELL or BUY is permitted. A not-found response alone is not permission to submit a replacement unless an explicitly approved contract says so; the current contract says no blind retry.

**Expected decision:** `RECONCILE`; retain the original identity and commitment. If reconciliation remains unavailable, remain blocked/unresolved according to the current state contract.

**Forbidden side effects:** no second broker submit; no new client ID; no reservation release on timeout; no synthetic fill or Portfolio mutation; no treating timeout as rejection; no new cycle.

#### 10.7.4 How to extend these walkthroughs

Use the same structure for every high-risk family, not only the three examples above. At minimum, the scenario implementation sequence should add complete walkthroughs for:

- BUY base-fee and quote-fee attribution, multiple tranches, duplicate and conflicting canonical fills (RS-002).
- SELL partial fill followed by terminal `CANCELED`/`EXPIRED` with prior fills, including full fill-history reconciliation and reservation release (RS-005/006).
- Recovery/legacy atomic projection failure at each commit boundary (RS-006).
- CG/RS shared account base and quote commitments, snapshot-relative allocation, and strategy-budget isolation (RS-008).
- Market-owned volatility gate for RS-only markets, including the approved recovery-SELL exception (RS-008).
- STOP blocking new BUY spending while eligible recovery SELL and permitted fill/order reconciliation continue (RS-009).
- Third-asset commission valuation missing, stale, ambiguous and authoritative (RS-004/006), only when an approved valuation source exists.
- Restart/replay behavior only after a separate contract and implementation are authorized (RS-010).

Do not mark a family VERIFIED merely because one walkthrough exists. Each required case/subcase still needs its own stable ID, exact assertions, named test, evidence and status in the registry and #1780. The examples here are explanatory oracles until executable tests are mapped and merged.

## 11. Scenario family matrix and required subcases

Issue #1780 is the live detailed checklist. This section explains what each family must prove and how to recognize incomplete coverage. Do not delete or silently reduce any row from #1780.

### RS-001 — Authorization, legacy basis and verified Spot custody (P0)

**Business question:** does RS sell only explicitly authorized legacy quantity that is currently verified, available and unreserved in Spot?

Required cases:

1. Valid operator-declared original invested quote and original base quantity.
2. Exact average historical cost derived from those original values.
3. Missing, zero, negative, malformed or contradictory basis fails closed.
4. Configured legacy basis does not create synthetic Portfolio fills.
5. Verified Spot custody is independent of historical basis.
6. Wallet total includes Spot plus EARN/other custody; only verified Spot is eligible.
7. Spot quantity below required slice blocks without consuming off-Spot inventory.
8. External/manual/startup-snapshot orders and inventory are not adopted as RS-owned.
9. Existing CG/other-strategy allocations reduce physical availability without becoming RS ownership.
10. Stale, missing, incomplete or conflicting custody evidence fails closed.
11. Spot transfers change availability only through approved evidence; historical basis remains unchanged.
12. Reservations and account snapshot baselines are not double-counted.
13. Derive the verified legacy Spot allocation from the authoritative Spot account total for the canonical base asset minus all Portfolio Positions for that base asset; cap the remainder by the operator-authorized remaining legacy quantity. The shared account allocator separately accounts for active/in-flight reservations. Do not subtract snapshot locks twice or count a reservation in both the baseline and current delta.
14. Missing authorized balances, stale/incomplete snapshots, or authoritative Spot total below aggregate Portfolio base quantity fail closed. Do not infer Spot from EARN/off-Spot quantity or external/manual inventory.

Core source ownership: `legacy-position.js`, `legacy-spot-allocation.js`, shared Portfolio/account snapshot/commitment allocation, action authorizer.

Required assertions: exact legacy basis, remaining quantity, verified Spot quantity, unreserved quantity, order ownership, no synthetic Fill, no unauthorized SELL intent.

### RS-002 — Recovery BUY eligibility and canonical BUY accounting (P0)

**Business question:** does recovery inventory reflect only confirmed canonical RS BUY fills and actual commissions?

Required cases:

1. Valid initial recovery BUY eligibility from an empty recovery allocation.
2. BUY is blocked when authorization, legacy basis, market readiness, account snapshot, investment budget or safety evidence is invalid/missing.
3. Exact BUY intent identity, market, side, order type, price, quantity, quote commitment and reason/disposition.
4. BUY fill ownership dispatches to RS accounting and never to CG accounting.
5. Full BUY fill updates shared Portfolio and the correct RS Position exactly once.
6. Partial BUY fill updates only confirmed executed quantity/cost/fees; the unfilled quote commitment remains reserved.
7. Multiple BUY fills at equal and different prices produce exact accumulated cost, net base quantity and actual execution VWAP.
8. BUY base-asset commission reduces net acquired base.
9. BUY quote-asset commission increases actual quote cost.
10. Zero commission and multiple supported fee records are accounted exactly.
11. Third-asset fee valuation is currently UNSUPPORTED/BLOCKED: no authoritative execution-time quote-value source is approved. Missing/ambiguous valuation fails closed and is not treated as zero. If a source is approved later, test its asset identity, quote asset, rate/value and timestamp/freshness.
12. Duplicate identical BUY Fill is idempotent across repeated delivery.
13. Same Fill identity with changed quantity, price, market, order or commission is rejected without partial mutation.
14. Fill for wrong strategy/Position/order/market/side cannot be attributed to RS.
15. Overfill, impossible quantity, invalid precision, negative/zero values or commission beyond supported bounds are rejected safely.
16. BUY acknowledgement before fill, fill before acknowledgement and immediate terminal acknowledgement preserve exact accounting and order ownership.
17. Unknown BUY submission outcome blocks unsafe duplicate BUY and retains identity/commitment for reconciliation.
18. Open/partial/unknown BUY lifecycle blocks the next BUY at every boundary required by the contract.
19. Investment cap below, at and above the boundary is enforced exactly; committed quote is included and not double-counted.
20. Multiple BUY tranches do not rewrite legacy basis.
21. Per-pair RS budget cannot borrow unused CG or other-strategy budget.

Core source ownership: accounting workflow, Portfolio/Position, canonical Fill identity, BUY evaluator, action authorizer, order submitter.

Required assertions: actual net base, quote cost, VWAP, applied Fill identities, pending commitment, ownership, exact broker-call count and no duplicate action.

### RS-003 — Additive mixed SELL planning and allocation (P0)

**Business question:** is the SELL target derived from actual net recovery inventory plus only eligible legacy quantity, with exact ownership and no over-allocation?

Required cases:

1. Recovery net base quantity plus the configured additive legacy slice.
2. Legacy remaining quantity smaller than configured sellQuantity uses only the approved smaller remainder.
3. Legacy exhaustion selects recovery-only cycle behavior; no legacy quantity is fabricated or reused.
4. Verified Spot quantity below, equal to and above the required legacy slice.
5. Verified Spot allocation derives from authoritative Spot total minus all Portfolio Positions for the canonical base asset, capped by authorized remaining legacy quantity.
6. Account-wide existing SELL reservations and shared base commitments are respected.
7. Cross-market reservations and same-market CG/RS reservations cannot double-sell the same physical base inventory.
8. Exact recovery/legacy allocation split and quantity conservation.
9. Real TradingRules filters, including quantity/notional and tick/step boundaries; include tiny exact decimal quantities whose serialized representation may use exponent notation as subcase `RS-003-009-A`.

   **Current crosswalk:** `RS-003-009-A` remains MISSING for the tiny exponent-notation TradingRules boundary. `RS-003-009-B` is TEST-MAPPED for a cross-market CG SELL commitment registered after the account snapshot; the scenario record is PARTIAL until both subcases are complete.
10. Any candidate SELL violating a supported price/quantity increment, min/max price, min/max quantity or min/max notional filter latches global sticky STOP; no automatic adjustment, split, retry or dust reinterpretation.
11. Missing required filter metadata fails closed/STOPs under the approved market contract.
12. After a successfully completed cycle is fully reconciled and all applicable profitability gates pass, a residual unsellable solely because of current quantity/notional filters is retained as bonus dust; record exact residual and limiting filter.
13. Retained bonus dust is permanently excluded from all future RS recovery/legacy inventory, SELL targets, profitability and available-inventory calculations.
14. Price-filter failures, unavailable commission valuation, incomplete fill/order reconciliation, active reservations or other unresolved accounting/risk conditions are not dust and block successful completion.
15. Ordinary sellable residual is not dust and cannot be hidden or discarded; dust classification cannot bypass the combined profitability gate.
16. Missing custody, invalid precision, invalid filter metadata and allocation ambiguity fail closed.
17. Allocation precision/rounding ambiguity fails closed; quantity is never silently shifted between recovery and legacy.
18. No broker submission occurs for any blocked or below-target plan.
19. Base-, quote- and mixed-commission allocation follows actual canonical fills.
20. The complete real accounting-workflow input is accepted by the default SELL evaluator; this application subcase remains blocked by #1809 until fixed.
21. Exact planned SELL price, quantity, order type, fee reserve, net proceeds and recovery/legacy allocation split are asserted, not only intent count.

Core source ownership: `calculate-sell-plan.js`, `evaluate-sell-decision.js`, `legacy-spot-allocation.js`, accounting workflow, shared allocator/TradingRules.

**Known blocker:** #1809 recorded the real accounting-workflow transition snapshot emitting an accumulating cycle state that the default SELL evaluator rejected. The production fix is in [PR #1815](https://github.com/45s/coinzilla/pull/1815), with real workflow/default-evaluator tests for eligible mixed SELL, missing verified Spot custody and existing-order/STOP/pause/reconciliation precedence. Keep the application subcase blocked until that PR is merged and exact merged-head verification is recorded.

### RS-004 — Independent profitability and fee-aware SELL economics (P0)

**Business question:** do recovery, legacy and combined profitability independently satisfy their own requirements?

Required cases:

1. Recovery profitability gate passes exactly at the configured minimum-profit threshold.
2. Recovery profitability fails just below the threshold.
3. Recovery profitability exceeds the threshold by the smallest meaningful exact increment.
4. Legacy profitability gate passes at break-even where the contract permits it.
5. Legacy profitability fails below break-even and blocks SELL eligibility as specified.
6. Legacy profitability passes above break-even.
7. Combined-cycle profitability gate is independently evaluated and cannot replace either allocation gate.
8. Recovery profitable plus legacy loss-making is rejected even if the combined cycle is profitable.
9. Legacy profitable plus recovery loss-making is rejected even if the combined cycle is profitable.
10. Combined profitable while one allocation fails is rejected.
11. All independent gates passing produces the expected eligible result.
12. Recovery-only operation still enforces recovery and combined gates after legacy exhaustion.
13. All gates use actual net proceeds and actual fee assets, not gross order value.
14. Mixed SELL target uses the approved maximum of the independent allocation net-proceeds requirements with exact fee gross-up.
15. LIMIT_MAKER uses the configured maker fee reserve; ordinary LIMIT uses the approved higher maker/taker reserve.
16. makerPercent zero/non-zero selects the owner-approved order type exactly.
17. SELL price/quantity rounding at tick/step boundaries preserves required net proceeds.
18. Missing/invalid fee configuration or filter metadata fails closed.
19. No SELL intent is emitted if any required profitability or exchange-readiness gate fails.
20. Exact expected SELL price, quantity, order type, fee reserve, net proceeds and allocation split are asserted.
21. Post-fill actual adverse profitability commits confirmed facts exactly once, preserves ownership/reservation evidence and latches the approved STOP; no follow-up SELL, replacement, BUY or cycle reset is authorized.

Core source ownership: `calculate-profitability.js`, `calculate-sell-plan.js`, `evaluate-sell-decision.js`, application transition evaluator and accounting workflow.

### RS-005 — One SELL lifecycle per cycle (P0)

**Business question:** can one cycle ever create more than one SELL lifecycle or release its reservation too early?

Required cases:

1. A cycle can acquire only one SELL reservation and one SELL order identity.
2. First SELL identity is recorded before the approved broker-I/O boundary.
3. Repeated evaluation while the SELL is pending/open cannot create another SELL broker call.
4. SELL reservation is created only at the approved durable submission boundary.
5. Reservation remains held while submission outcome is unknown.
6. SELL acknowledgement preserves the original canonical order identity and reservation.
7. Partial SELL fills are staged and do not prematurely commit mixed allocation projections.
8. Complete terminal SELL reconciles the complete canonical REST/stream Fill set before atomic commit.
9. Reservation releases only after successful terminal mixed-SELL accounting.
10. PARTIALLY_FILLED is nonterminal: keep the sole SELL active and its reservation held. A terminal CANCELED/REJECTED/EXPIRED outcome may include prior partial fills; reconcile the complete canonical Fill set and commissions, then leave the cycle UNRESOLVED. A global STOP blocks additional BUY spending only; no replacement SELL or next BUY is created from this unresolved cycle. The STOP latch does not itself prohibit an otherwise-valid first SELL in a different cycle whose sole SELL lifecycle remains unused.
11. Unknown, incomplete, conflicting or duplicate terminal facts cannot close twice or release twice.
12. Duplicate completion request/event is idempotent; stale fills/reports from a completed cycle cannot affect the next cycle.
13. A new cycle is created only after approved terminal reconciliation, accounting commit and completion gates pass.
14. Legacy exhaustion transitions to recovery-only cycles only under the explicit contract.
15. Reaching the recovery investment limit blocks new BUYs only; an already-open recovery SELL remains live and untouched, is not canceled/replaced/repriced, and continues through terminal reconciliation.

Core source ownership: cycle state, lifecycle decision, accounting workflow, order submitter, order callbacks, reservation and terminal reconciliation.

### RS-006 — Exact-once mixed SELL accounting and atomicity (P0)

**Business question:** do recovery and legacy projections consume the same canonical execution evidence and commit together?

Required cases:

1. Recovery and legacy allocations remain distinct while sharing one actual Portfolio/custody aggregate.
2. One canonical SELL Fill is split between recovery and legacy using the approved allocation contract.
3. Multiple partial SELL fills are accumulated and reconciled exactly.
4. Allocation sum equals canonical SELL Fill quantity under approved fee treatment; partial SELL consumes exact allocated quantities and fees from the correct allocation.
5. Recovery and legacy projections derive from identical accepted Fill facts; recovery allocation uses only canonical RS recovery fills and attributed proceeds.
6. SELL base-asset commission reduces net base quantity/proceeds allocation according to the approved accounting contract.
7. SELL quote-asset commission reduces net quote proceeds exactly.
8. Third-asset SELL commission valuation is currently UNSUPPORTED/BLOCKED because no authoritative execution-time quote-value source is approved; missing/ambiguous valuation fails closed.
9. Mixed commission assets are allocated without duplication or loss.
10. Allocation precision/rounding ambiguity fails closed rather than silently shifting quantity between recovery and legacy.
11. Successful commit updates both recovery and legacy projections.
12. Failure in either projection leaves both unchanged; the cycle reservation remains held and no partial projection is published. STOP blocks additional BUY spending; SELL eligibility remains governed by the cycle's one-SELL rule and all independent SELL safety gates.
13. Identical terminal mixed-SELL replay is an exact no-op; conflicting replay is rejected.
14. Duplicate Fill through REST and stream in either order produces exact-once behavior.
15. Conflicting REST/stream facts are rejected atomically.
16. Incomplete fill history cannot commit a terminal allocation.
17. Durable barrier and reservation retention/release are verified at application layer.
18. Confirmed canonical fills are committed exactly once even if subsequent profitability is false.
19. Shared Portfolio totals reconcile to strategy-owned allocations plus correctly classified unallocated inventory; no synthetic custody is created.
20. Streamed RS SELL fills are staged under RS ownership and are not applied as standalone CG fills.
21. Terminal mixed-SELL reconciliation receives the complete canonical REST/stream Fill history.
22. Atomic accounting failure prevents order-registry publication and cycle closure.

Core source ownership: mixed SELL allocation/accounting/reconciliation, Portfolio, accounting workflow, record-reconciled use case, persistence boundary.

**Current scenario-suite mapping:** PR #1852 registers `RS-006-003-A/B`, `RS-006-012-A`, `RS-006-016-A` and `RS-006-018-A` as APPLICATION scenarios. They prove two-Fill atomic accounting and replay, no projection publication after durable append failure, fail-closed handling of incomplete terminal history, and accounting of confirmed fills despite a profitability miss. `RS-006-014-A/015-A` additionally prove domain-level exact duplicate staging and rejection of conflicting facts for the same Fill identity. These do not prove the full REST/stream fetch/merge pipeline. All mapped cases remain TEST-MAPPED; full source-order integration and remaining persistence/failure interleavings are still required.

### RS-007 — Unknown outcomes and no blind retry (P0)

**Business question:** when broker outcome is unknown, does RS preserve original identity/commitment and reconcile without resubmitting?

Required cases:

1. Timeout before broker acceptance.
2. Timeout after broker acceptance but before response.
3. Unknown response retains the original client order identity.
4. Repeated unknown event is idempotent.
5. Lookup finds the active order.
6. Lookup finds terminal order and complete history.
7. Lookup says the order is not found.
8. Lookup itself fails or returns incomplete history.
9. Original reservation remains held until authoritative resolution.
10. No second broker submission occurs under any unknown path.
11. Existing order reconciliation and confirmed fills continue under STOP.
12. Durable submission intent precedes broker submission.
13. Durable submission outcome is recorded before local acknowledgement is considered complete.
14. Reservation creation/release occurs at the correct workflow boundary.
15. Durable outcome failure after external submission preserves uncertainty and blocks duplicate submission.
16. Unknown submission followed by active, terminal, not-found or failed lookup has exact expected reservation and broker-call behavior.

Core source ownership: order submitter, lifecycle decision, order callbacks, accounting workflow, order registry and persistence.

### RS-008 — CG/RS shared account resources and concurrency (P0)

**Business question:** can CG and RS run independently while never spending/selling the same physical account inventory twice?

Required cases:

1. CG and RS run concurrently on different markets with independent Position/order ownership.
2. CG and RS run concurrently on the same market with multiple independent Positions.
3. Shared Portfolio represents actual account custody once; strategy Positions do not duplicate wallet balance.
4. Shared quote availability is never double-spent across concurrent intents.
5. Shared base inventory/reservations prevent double-sell and oversell.
6. RS cannot consume unused CG budget; CG cannot consume unused RS budget.
7. Strategy-specific order/fill ownership is immutable through submit, acknowledgement, stream, REST and terminal reconciliation.
8. A Fill is attributed to exactly one owning Position/strategy.
9. Concurrent decision attempts serialize account-level reservation/submission transitions and produce deterministic results.
10. Failure during one strategy's accounting does not partially mutate the other strategy's Position.
11. Same-symbol market-data subscription deduplication does not merge strategy ownership.
12. One strategy's pause/disable/STOP does not silently change another strategy's policy; account-wide safety reservations remain authoritative.
13. External/manual order isolation remains intact while multiple strategies are active.
14. The shared serialized transition queue orders CG/RS decisions, submissions and Fill transitions.
15. Bootstrap routes RS-only and concurrent CG/RS strategies by explicit strategy ownership and environment selectors.
16. Runtime configuration does not enable a deferred operational session or bypass per-market environment filtering.
17. An active ACCOUNT-scope safety blocker blocks every broker submission across strategies, markets, sides and purposes, including a shutdown `RECOVERY_SELL`; market-scoped blockers retain their documented scope.

Core source ownership: shared Portfolio, account snapshot/commitment allocator, Trading Engine serialization, RS/CG ownership and action authorization.

### RS-009 — STOP, failure atomicity and continued reconciliation (P0; SPECIFIED)

**Business question:** does STOP prevent additional spending without preventing recovery of already-owned inventory or processing exchange facts?

Owner-approved contract, recorded in [#1780](https://github.com/45s/coinzilla/issues/1780) on 2026-11-24:

1. STOP blocks every new BUY and any action that commits additional quote investment.
2. STOP does **not** block an otherwise-valid SELL of already-owned RS inventory. The normal one-SELL-per-cycle rule, profitability, custody, account-wide reservation, exchange-filter, market-readiness and order-identity gates still apply. This allowance does not override an active ACCOUNT-scope safety blocker, which is a global shared-engine admission stop.
3. STOP does not create a replacement/second SELL. A cycle whose sole SELL is active or unresolved remains governed by its existing identity and terminal lifecycle contract.
4. Existing orders continue through WAIT/RECONCILE as appropriate. Confirmed canonical fills and commissions continue to be accounted exactly once.
5. The first STOP reason remains durable and visible. Later market events cannot clear or replace it.
6. An authorized administrator may manually clear STOP only after the cause is fixed, all required order/fill/balance reconciliation is authoritative, unresolved counts and balance discrepancies are zero, Portfolio/legacy/reservation accounting is verified, and the durable operator-resolution fact is acknowledged.
7. No automatic clear, self-resume or implicit resume is allowed. Clearing is an explicit administrator action.
8. Persistence, reconciliation or accounting failure keeps STOP active and preserves unresolved commitments.
9. Unknown broker submission outcomes retain the original client identity and reservation; no blind retry or duplicate order is permitted.
10. Duplicate confirmed fills are idempotent; conflicting duplicate facts fail safely.
11. STOP must not suppress terminal order history, confirmed fills, accounting updates or reservation release when authoritative terminal facts and successful accounting justify release.
12. Process shutdown, market pause, stale market data, unresolved orders and independent safety blockers remain separate gates; this contract changes only the effect of the RS STOP latch.

**Allowed while STOP is active:** existing-order WAIT/RECONCILE; exact-once confirmed-fill accounting; and a new recovery SELL only when the cycle has not already used its sole SELL lifecycle, no stronger ACCOUNT-scope blocker is active, and every independent SELL gate passes.

**Forbidden while STOP is active:** new BUYs, additional investment, blind retries, duplicate/second/replacement SELLs, automatic clearing, and implicit resume.

**Tests:** add the RS-009 scenario suite and application composition tests. Existing STOP unit/use-case tests are regression evidence only and do not receive #1780 scenario credit.

**Remaining implementation/evidence:** prove the BUY block and SELL allowance at the real runtime boundary; prove authorized durable administrator resolution and unauthorized rejection; cover partial/terminal/unknown order histories, exact-once fills, persistence failure, reconciliation failure, accounting failure, duplicate/out-of-order events and restart boundaries. Full process restart/replay remains unsupported under RS-010.

### RS-010 — Explicitly deferred capabilities (P2; UNSUPPORTED/BLOCKED)

This family is a disposition register, not permission to invent functionality.

- Full process restart/replay restoration is unsupported/deferred.
- Third-asset fee quote valuation has no approved authoritative execution-time source.
- Missing or ambiguous third-asset valuation must fail closed.
- No scenario may claim successful RS restart recovery or fabricate a third-asset conversion rate.
- Advanced pause/disable/abandon/resume transitions remain deferred.
- Automatic STOP clear/reset/unpause/resume is not permitted under the current contract.
- Separate final-residual liquidation without a new BUY remains unresolved.
- Runtime authorization revocation/expiry remains deferred under the approved FITDIB boundary.
- Restart/replay remains unsupported at each interruption point: after durable intent, after broker acceptance, after partial fill, during terminal reconciliation, after projection commit but before registry publication, and after STOP.
- Any behavior without an explicit canonical decision remains BLOCKED rather than inferred.
- A future owner-approved issue must define the contract, source of truth, replay semantics and acceptance criteria before implementation scenarios are added.

### 11.1 Complete 22-field family contracts

Every family below explicitly answers the 22 contract questions required by the owner brief. “N/A” means that the field does not apply to that family’s boundary; it is not permission to omit a required assertion in another family. Existing test paths are listed for source discovery only and receive **zero scenario-coverage credit** under #1780.

#### RS-001 — Authorization, legacy basis and verified Spot custody

| Contract field | RS-001 definition |
| --- | --- |
| 1. Purpose | Prove that RS may use only explicitly authorized legacy quantity that is currently verified, available and unreserved in Spot. |
| 2. Preconditions | RS strategy/pair route is configured; operator-declared original invested quote and original base quantity are valid; authoritative account snapshot, Portfolio and active-order commitments are available and fresh. |
| 3. Configuration inputs | Pair enabled/environment; legacyPosition.invested; legacyPosition.quantity; sellQuantity; canonical market/base/quote identity. Do not add a second legacy-basis field. |
| 4. Runtime-derived inputs | Spot total/free/locked balances; EARN/off-Spot balances; all Portfolio base Positions; active OrderRegistry commitments; external/manual orders; snapshot timestamp and account identity. |
| 5. Domain rules | Historical average cost derives from original invested quote/original quantity. Verified additional Spot is authoritative Spot total minus aggregate Portfolio base quantity, capped by remaining authorized legacy quantity. The shared allocator accounts for reservations once. |
| 6. Decision inputs | Basis validity, account/market identity, snapshot freshness, Spot custody, aggregate Portfolio base, active commitments and configured legacy remainder. |
| 7. Expected decision | Permit only the eligible authorized slice when every gate passes; otherwise WAIT/BLOCK/STOP according to the missing or contradictory evidence. Never adopt an external order or balance as RS-owned. |
| 8. State before | Operator-declared legacy basis exists separately from verified custody; recovery Position may be empty; no synthetic Fill or Portfolio Position is created. |
| 9. State after | Authorization snapshot is derived; original basis is unchanged. Remaining legacy quantity changes only after a successfully reconciled legacy sale. |
| 10. Portfolio effects | None during authorization. Portfolio remains the actual-accounting aggregate; wallet balances do not create Positions or fills. |
| 11. Reservation effects | Available Spot is reduced by aggregate Portfolio base and active commitments exactly once. Do not subtract locked balances or reservations twice. |
| 12. Order effects | No order is submitted by this family. External/manual/startup-snapshot orders remain external and cannot become RS-owned. |
| 13. Commission effects | N/A before execution. Later canonical SELL commissions belong to RS-006 and must not change historical basis. |
| 14. Profitability calculation | N/A at authorization. A valid legacy allocation is only an input to the separate RS-004 profitability gates. |
| 15. Invariants | Legacy basis, recovery inventory and verified Spot custody remain distinct; no synthetic inventory; no cross-strategy ownership; no double-subtracted commitments. |
| 16. Failure cases | Missing/zero/negative/malformed basis; stale/missing snapshot; Spot total below aggregate Portfolio base; EARN-only custody; conflicting account/market identity; insufficient Spot; unexplained locked balance. |
| 17. Duplicate/replay cases | Repeated identical snapshots are idempotent. Conflicting snapshots/identities are rejected. Restart restoration is not supported by this family. |
| 18. Required assertions | Exact original basis and average cost; authorized remaining legacy; verified Spot; unreserved quantity; unchanged Portfolio; no synthetic Fill; no unauthorized SELL intent. |
| 19. Existing regression tests | legacy-position.test.js; legacy-spot-allocation.test.js; create-recovery-seller-action-authorizer.test.js. These are regression references, not #1780 scenario evidence. |
| 20. Missing scenario tests | New named scenarios for basis validation, Spot/EARN custody, external inventory isolation, stale snapshots, aggregate Portfolio subtraction and reservation interaction. |
| 21. Blocked decisions | Runtime authorization revocation/expiry remains deferred under FITDIB. Missing or contradictory current custody evidence fails closed; do not infer a recovery path. |
| 22. Acceptance criteria | Every #1780 section A case is mapped to stable IDs; exact basis/custody/reservation assertions pass on a recorded SHA; no existing regression test is counted as scenario credit. |

#### RS-002 — Recovery BUY eligibility and canonical BUY accounting

| Contract field | RS-002 definition |
| --- | --- |
| 1. Purpose | Prove that recovery inventory and cost basis arise only from confirmed canonical RS BUY fills and actual commission facts. |
| 2. Preconditions | RS route and pair are eligible; legacy authorization/custody, market metadata, account snapshot and shared allocator are valid; no conflicting active BUY/SELL lifecycle blocks the action. |
| 3. Configuration inputs | Pair enabled/environment; orderQuantity; investment cap; BUY cadence/reference-price settings; market precision and configured fee assumptions used for reservation. |
| 4. Runtime-derived inputs | Market price/readiness; TradingRules; current recovery Position; account quote availability; Portfolio; OrderRegistry; active commitments; canonical order ownership and Fill history. |
| 5. Domain rules | Only confirmed canonical BUY fills change recovery inventory. Base commission reduces net base; quote commission increases actual quote cost. Unknown outcomes preserve identity and commitment. |
| 6. Decision inputs | Eligibility, market readiness, investment remaining after commitments, outstanding order state, order ownership, precision and authoritative Fill/commission facts. |
| 7. Expected decision | SUBMIT only for a valid BUY intent; WAIT for a known active order; RECONCILE for unknown outcome; BLOCK/STOP for invalid or contradictory evidence. |
| 8. State before | Empty or accumulating recovery allocation with a stable cycle/Position identity and no unresolved prior BUY lifecycle. |
| 9. State after | Confirmed fills update recovery net quantity/cost once; partial fills leave unfilled commitments reserved; next tranche is allowed only after prior BUY terminal reconciliation. |
| 10. Portfolio effects | Apply each accepted Fill to the correct RS Position exactly once. Do not apply RS BUY fills to CG accounting or create inventory from intent/acknowledgement. |
| 11. Reservation effects | Quote commitment is held through open/partial/unknown outcomes and released only at the approved terminal accounting boundary. Do not double-count committed quote. |
| 12. Order effects | Preserve strategy/Position/cycle/purpose ownership; no duplicate BUY while an order is active or unresolved; exact intent fields and broker-call count are asserted. |
| 13. Commission effects | Base fee reduces acquired net base; quote fee increases actual quote cost; multiple records are summed exactly. Third-asset valuation is BLOCKED without an approved execution-time quote-value source. |
| 14. Profitability calculation | BUY eligibility is not a SELL profitability decision. Record actual cost/quantity/VWAP for later recovery and combined profitability; do not use requested quantity or gross VWAP as net cost basis. |
| 15. Invariants | Applied Fill IDs are unique; recovery quantity equals gross acquired base less base fees; quote cost includes quote fees; legacy basis is unchanged; no cross-strategy attribution. |
| 16. Failure cases | Invalid/negative/zero Fill; overfill; wrong order/Position/strategy/market; invalid precision; contradictory commission identity; missing account state; unknown acknowledgement; persistence failure. |
| 17. Duplicate/replay cases | Identical Fill replay is a no-op; same identity with changed facts is rejected atomically. Process restart/replay restoration remains unsupported. |
| 18. Required assertions | Exact net base, quote cost, actual execution VWAP inputs, applied Fill identities, pending quote commitment, order ownership, cycle state and exact broker-call count. |
| 19. Existing regression tests | create-recovery-seller-accounting-workflow.test.js (includes cycle-scoped BUY VWAP assertions); create-recovery-seller-runtime-evaluator.test.js; order-event-workflow.test.js. Zero scenario credit. |
| 20. Missing scenario tests | New RS-002 registry cases for full/partial/multiple BUY fills, base/quote fees, duplicate/conflicting identity, investment boundaries, unknown submission and CG exclusion. |
| 21. Blocked decisions | Third-asset quote valuation source and process restart/replay remain deferred. Missing/ambiguous third-asset valuation must fail closed, never equal zero by assumption. |
| 22. Acceptance criteria | Every #1780 section B case has stable IDs and independent exact-decimal expected values; real Portfolio/Fill ownership is asserted; new scenarios are merged and verified before status changes. |

#### RS-003 — Additive mixed SELL planning and allocation

| Contract field | RS-003 definition |
| --- | --- |
| 1. Purpose | Prove that SELL quantity is actual net recovery inventory plus only the currently eligible legacy slice, with no over-allocation. |
| 2. Preconditions | Canonical recovery inventory exists; legacy basis and current Spot availability are verified; cycle is accumulating; no active/unknown SELL; account commitments and TradingRules are authoritative. |
| 3. Configuration inputs | sellQuantity; minProfit; makerPercent; maker/taker fee assumptions; pair enabled/environment; market precision/filter metadata. |
| 4. Runtime-derived inputs | Net recovery quantity; remaining authorized legacy quantity; verified unreserved Spot; shared base commitments; current fee reserves; tick/step/min/max price/quantity/notional. |
| 5. Domain rules | SELL target is additive. A smaller authorized legacy remainder may be used within the current cycle. Recovery-only operation is allowed after legacy exhaustion. Candidate filter violations latch STOP; only post-completion constrained dust may be classified as dust. |
| 6. Decision inputs | Recovery/legacy quantities, custody, account reservations, cycle state, fee assumptions, price target, TradingRules and market readiness. |
| 7. Expected decision | Produce an exact planned SELL only when every quantity, ownership, profitability and filter gate passes; otherwise WAIT/BLOCK/STOP and never submit. |
| 8. State before | ACCUMULATING cycle with canonical recovery inventory, eligible legacy remainder and no sole SELL identity. |
| 9. State after | Planning alone does not mutate cycle or inventory. At the authorized submission boundary the sole SELL identity/reservation is recorded; a blocked plan leaves no intent. |
| 10. Portfolio effects | None during planning. The plan must reconcile to existing net Portfolio inventory; no synthetic quantity is created. |
| 11. Reservation effects | Shared account-wide base commitments are included. One cycle-scoped SELL reservation is created only at the approved durable submission boundary. |
| 12. Order effects | Assert exact side, type, quantity, price, quote commitment, fee reserve and ownership. No broker call for a blocked/below-target plan; no second SELL per cycle. |
| 13. Commission effects | Planning reserves supported base/quote fees. Actual base/quote/third-asset commissions are allocated only from canonical fills; third-asset quote valuation is BLOCKED. |
| 14. Profitability calculation | Use the max of recovery, legacy and combined net-proceeds requirements, then gross up supported fee reserves and round price/quantity using exact TradingRules. Detailed gates are RS-004. |
| 15. Invariants | Recovery plus legacy allocation equals planned gross SELL quantity; base debit includes base commission; no quantity shifts silently between allocations; shared reservations prevent oversell. |
| 16. Failure cases | Insufficient Spot; stale snapshot; missing filters; tick/step/min/max/min-notional violation; invalid fee; precision ambiguity; active reservation; incomplete reconciliation. |
| 17. Duplicate/replay cases | Repeated evaluation cannot create another SELL; duplicate planner invocation is side-effect-free; stale prior-cycle facts cannot change a new cycle. |
| 18. Required assertions | Exact plan fields, allocation split, fee reserve, net-proceeds target, filter result, no Portfolio mutation and zero broker calls for blocked cases. |
| 19. Existing regression tests | calculate-sell-plan.test.js; legacy-spot-allocation.test.js; mixed-sell-fill-allocation.test.js; recovery-seller-sell-planner.scenario.test.js. New scenario evidence is registered in `test/scenarios/recovery-seller/mixed-sell-planning.scenario.test.js` and remains PARTIAL. |
| 20. Missing scenario tests | Concurrent reservation changes between snapshot and allocation, full workflow/custody composition for legacy exhaustion, partial/multiple fills, fee-asset boundaries, TradingRules tick/step/min/max boundaries, durable reservation and complete dust/filter subcases. |
| 21. Blocked decisions | The #1809 production fix is merged in PR #1815 at `cbf07da54fd2e14fbeb3f96d4d9f8efe48d597c2`; all six workflows passed on its exact PR head `20963617c9d9d73c31b47865e0aa34c4a966cc8e`. The workflow-to-default-evaluator prerequisite is therefore unblocked. Third-asset valuation and standalone final-residual liquidation remain blocked/unsupported. |
| 22. Acceptance criteria | All #1780 sections C/H/I planner cases have stable IDs; exact intent and no-submit assertions pass; the real workflow/default-evaluator prerequisite is proved by merged PR #1815 and exact merged-head checks. Remaining planner, reservation, fee, filter, dust and atomicity cases stay PARTIAL until separately mapped and verified. |

#### RS-004 — Independent profitability and fee-aware SELL economics

| Contract field | RS-004 definition |
| --- | --- |
| 1. Purpose | Prove that recovery, legacy and combined-cycle profitability each pass independently and cannot subsidize one another. |
| 2. Preconditions | Canonical cost bases, allocated SELL quantities, actual or explicitly reserved fee assumptions and quote-currency proceeds are valid. |
| 3. Configuration inputs | Pair minProfit; makerPercent; maker/taker fee assumptions; order type; market tick/step/quote precision. |
| 4. Runtime-derived inputs | Recovery cost basis; legacy cost consumed; recovery/legacy SELL quantities; gross proceeds; actual commissions; fee asset identity; market filters. |
| 5. Domain rules | Recovery and combined profit must meet minProfit; legacy must meet its approved non-loss/break-even gate. Combined success cannot repair either allocation failure. |
| 6. Decision inputs | Exact cost bases, net proceeds after fees, allocated quantities, fee reserve/actual fee facts and threshold precision. |
| 7. Expected decision | SUBMIT only when all independent gates pass and the planned order satisfies filters; otherwise BLOCK/STOP with the failed gate identified. |
| 8. State before | A valid accumulating cycle with recovery and applicable legacy allocations; no SELL intent or reservation yet. |
| 9. State after | Evaluation returns an eligible/ineligible decision and exact plan; no accounting/cycle state changes before canonical execution facts. |
| 10. Portfolio effects | None during pre-submit profitability evaluation. Post-fill accounting belongs to RS-006 and must commit confirmed facts even when actual profit fails. |
| 11. Reservation effects | No reservation on failed gates. A passing plan may proceed to the sole-cycle durable reservation boundary; release follows RS-005/006. |
| 12. Order effects | Assert exact order type, price, quantity, fee reserve and no-submit on every failing gate. |
| 13. Commission effects | Use actual base/quote fees for realized profitability. Planning reserves maker fee for LIMIT_MAKER and approved higher maker/taker fee for ordinary LIMIT. Third-asset valuation remains blocked. |
| 14. Profitability calculation | Recovery: recovery net proceeds minus recovery cost basis >= minProfit. Legacy: legacy net proceeds minus legacy cost consumed >= 0 where break-even is approved. Combined: total net proceeds minus both cost bases >= minProfit. SELL net proceeds exclude quote fees and any approved third-asset quote value. |
| 15. Invariants | Three gates are independent; exact equality passes only where specified; no cross-subsidy; gross proceeds are never substituted for net proceeds. |
| 16. Failure cases | Below/equal/above thresholds; missing fee; wrong fee asset; invalid division/precision; filter failure; one allocation profitable while another loses; post-fill adverse result. |
| 17. Duplicate/replay cases | Repeated pure evaluation is deterministic and side-effect-free; duplicate actual Fill accounting is handled by RS-006, not by recalculating a synthetic result. |
| 18. Required assertions | Exact per-allocation cost/proceeds/profit, combined profit, target max, fee gross-up, rounded order fields and failed-gate reason. |
| 19. Existing regression tests | calculate-profitability.test.js; calculate-sell-plan.test.js; recovery-seller-profitability.scenario.test.js; recovery-seller-sell-planner.scenario.test.js. New scenario evidence remains PARTIAL. |
| 20. Missing scenario tests | Actual partial/multiple fill fees, all exact threshold neighbors, complete mixed-commission cases and post-fill adverse application outcomes. |
| 21. Blocked decisions | Third-asset fee quote valuation source is not approved. Do not compute a successful third-asset profitability case or assume a zero fee. |
| 22. Acceptance criteria | Every #1780 section D case has independent oracle values and complete plan assertions; both cross-subsidy directions and recovery-only operation are proved. |

#### RS-005 — One SELL lifecycle per cycle

| Contract field | RS-005 definition |
| --- | --- |
| 1. Purpose | Prove that a recovery cycle can create only one SELL order lifecycle and cannot release its reservation prematurely. |
| 2. Preconditions | Stable cycleId/positionId; canonical accumulating cycle state; no prior SELL identity; durable submission/OrderRegistry boundary available. |
| 3. Configuration inputs | Pair enabled/environment; sellQuantity and investment cap as upstream policy inputs. No configuration flag permits a second SELL or retry. |
| 4. Runtime-derived inputs | Cycle state; active/pending SELL identity; broker acknowledgement/status; durable intent/outcome; reservation; canonical REST/stream fill history. |
| 5. Domain rules | Record one SELL identity before broker I/O; active/unknown order is WAIT/RECONCILE; terminal incomplete outcomes leave cycle UNRESOLVED; no replacement SELL or next BUY. |
| 6. Decision inputs | Existing cycle/order identity, terminal status, reconciliation completeness, profitability and accounting commit result. |
| 7. Expected decision | SUBMIT only for the first eligible SELL; WAIT for known active order; RECONCILE for unknown/incomplete status; BLOCK/STOP for invalid or conflicting transition. |
| 8. State before | ACCUMULATING cycle with no SELL identity and no SELL reservation. |
| 9. State after | SELL_SUBMITTED while active, including PARTIALLY_FILLED; keep the reservation held. CLOSED only after terminal FILLED, complete reconciliation, atomic accounting and all gates; terminal CANCELED/REJECTED/EXPIRED with prior fills remains UNRESOLVED/STOP under the approved contract. |
| 10. Portfolio effects | Partial SELL fills are staged; no premature recovery/legacy projection commit. Complete canonical fills are applied once after terminal reconciliation. |
| 11. Reservation effects | Create once at durable submission; retain for active/unknown/incomplete/failed commit; release once only after successful terminal accounting. |
| 12. Order effects | One immutable SELL identity per cycle; repeated evaluation must not create another broker call; preserve client/broker IDs and ownership. |
| 13. Commission effects | Commissions follow canonical partial/terminal fills; no commission is invented from intent/acknowledgement; final allocation belongs to RS-006. |
| 14. Profitability calculation | Cycle closes only when recovery, applicable legacy and combined gates pass on actual net proceeds after complete fee reconciliation. |
| 15. Invariants | One SELL per cycle; no replacement/retry/continuation SELL; no next BUY from unresolved cycle; reservation conservation. |
| 16. Failure cases | Unknown acknowledgement; PARTIALLY_FILLED while order remains active; terminal CANCELED/REJECTED/EXPIRED with prior partial fills; incomplete REST/stream history; persistence failure; duplicate terminal event; conflicting order identity. |
| 17. Duplicate/replay cases | Duplicate event/completion is idempotent; conflicting identity rejected; stale prior-cycle fills cannot close or mutate a later cycle. |
| 18. Required assertions | Exact broker-call count; stable order/cycle identity; state before/after; reservation held/released once; no second SELL/BUY; exact terminal disposition. |
| 19. Existing regression tests | recovery-seller-cycle-lifecycle.scenario.test.js; create-recovery-seller-accounting-workflow.test.js; create-recovery-seller-order-submitter.test.js. New lifecycle scenario evidence remains PARTIAL. |
| 20. Missing scenario tests | Application-composed broker-call count, durable reservation races, partial-fill race, full terminal history and complete STOP integration. |
| 21. STOP decision | Owner-approved investment-only contract is RESOLVED. The remaining RS-009 gaps are implementation and scenario proof: the runtime SELL gate must permit only an otherwise-valid first SELL, and the trusted operator facade must expose evidence-backed administrator resolution. No automatic clear, replacement SELL or next-cycle path is permitted. |
| 22. Acceptance criteria | Every #1780 section E case is mapped and proved through real lifecycle composition; no cycle closes/releases before all required gates. |

#### RS-006 — Exact-once mixed SELL accounting and atomicity

| Contract field | RS-006 definition |
| --- | --- |
| 1. Purpose | Prove that recovery and legacy accounting consume the same canonical mixed-SELL Fill set and commit atomically. |
| 2. Preconditions | Registered RS SELL ownership; complete authoritative terminal order/fill history; valid recovery/legacy snapshots and durable commit boundary. |
| 3. Configuration inputs | sellQuantity; legacy original basis; pair minProfit; supported fee settings and market precision. |
| 4. Runtime-derived inputs | Canonical REST/stream Fills; registered order identity; recovery Position; legacy position; commission assets/values; current reservations and durable facts. |
| 5. Domain rules | Split each canonical Fill by the approved recovery/legacy allocation; allocate commissions exactly; commit both projections together; confirmed fills are accounted even if profitability fails. |
| 6. Decision inputs | Fill identity/completeness, ownership, allocation precision, commission facts, both projection results, profitability and persistence acknowledgement. |
| 7. Expected decision | Commit both projections only when all evidence and persistence barriers pass; otherwise preserve both prior projections, retain reservation and apply the specified fail-closed disposition. |
| 8. State before | SELL terminal candidate exists, but cycle/projections remain unresolved until complete canonical history is reconciled. |
| 9. State after | Successful commit updates recovery and legacy once and then permits the approved completion/reservation transition; failure leaves both snapshots unchanged. |
| 10. Portfolio effects | Recovery Portfolio/Position and legacy projection consume the same accepted Fill facts atomically; no partial mutation or synthetic Fill. |
| 11. Reservation effects | Retain the sole SELL reservation through incomplete history, projection failure or durable commit failure; release only after successful atomic commit. |
| 12. Order effects | Publish terminal OrderRegistry/cycle completion only after the accounting barrier; duplicate completion cannot publish twice. |
| 13. Commission effects | Base commission increases base debit; quote commission reduces net quote proceeds; multiple records split exactly. Third-asset valuation is BLOCKED without an approved source. |
| 14. Profitability calculation | Derive actual recovery, legacy and combined net proceeds/costs from accepted fills and actual fee assets; a failed gate does not erase confirmed execution facts. |
| 15. Invariants | Recovery + legacy allocations conserve canonical execution facts; exact-once Fill IDs; atomic projections; no duplicate commission; reservation release after commit only. |
| 16. Failure cases | Partial fill history; conflicting REST/stream facts; duplicate identity with changed facts; invalid commission; precision ambiguity; one projection fails; persistence fails. |
| 17. Duplicate/replay cases | Identical terminal replay is a no-op; conflicting replay rejects atomically; duplicate REST/stream order in either sequence is exact-once. Process restart restoration remains deferred. |
| 18. Required assertions | Both complete before/after snapshots; allocation and commission sums; durable fact; registry/cycle state; reservation retention/release; no partial commit. |
| 19. Existing regression tests | mixed-sell-fill-allocation.test.js; mixed-sell-fill-accounting.test.js; mixed-sell-fill-reconciliation.test.js; record-recovery-seller-mixed-sell-reconciled.test.js; recovery-seller-mixed-sell-accounting.scenario.test.js. New scenario evidence remains PARTIAL. |
| 20. Missing scenario tests | Multiple partial fills with reordered REST/stream facts, mixed fee assets, durable commit barrier and failure at every projection/publication boundary. |
| 21. Blocked decisions | Third-asset quote valuation remains BLOCKED; STOP disposition after some failure paths remains subject to RS-009 contract resolution. |
| 22. Acceptance criteria | Every #1780 sections C/E/F/J atomicity row has stable IDs; complete canonical history and all failure boundaries are proved with independent exact-decimal assertions. |

#### RS-007 — Unknown outcomes and no blind retry

| Contract field | RS-007 definition |
| --- | --- |
| 1. Purpose | Prove that unknown broker outcomes preserve original order identity/commitment and reconcile without blind resubmission. |
| 2. Preconditions | Durable submission intent exists or external submission may have occurred; original client identity is known; broker response/acknowledgement is missing or ambiguous. |
| 3. Configuration inputs | Pair enabled/environment and ordinary order settings only; no retry count/backoff setting authorizes resubmission. |
| 4. Runtime-derived inputs | clientOrderId; brokerOrderId when known; durable intent/outcome; active reservation; broker lookup result; stream/REST events; current STOP. |
| 5. Domain rules | Unknown is not rejection or proof of non-acceptance. Preserve original identity and reservation; continue non-trading reconciliation; never blindly retry. |
| 6. Decision inputs | Submission result, identity completeness, authoritative lookup, order history, canonical fills, durable persistence status. |
| 7. Expected decision | RECONCILE for the original order; WAIT only when authoritative active status is known; BLOCK/STOP for unsupported or contradictory evidence. Never create a second SUBMIT from unknown. |
| 8. State before | Submission pending/unknown with original client identity and durable intent. |
| 9. State after | RECONCILIATION_REQUIRED until authoritative resolution; identity and original commitment remain intact. |
| 10. Portfolio effects | No synthetic execution. Apply only confirmed canonical fills exactly once if discovered during reconciliation. |
| 11. Reservation effects | Retain the original reservation until authoritative terminal facts and accounting permit release. |
| 12. Order effects | No second broker call; preserve clientOrderId and brokerOrderId if known; lookup failure does not authorize retry. |
| 13. Commission effects | No fee is inferred from an unknown response. Apply actual commissions only with canonical confirmed fills; third-asset valuation remains blocked. |
| 14. Profitability calculation | No new profitability decision from unknown status. Evaluate actual proceeds only after complete authoritative Fill/commission reconciliation. |
| 15. Invariants | One original order identity; no blind retry; no duplicate reservation; no synthetic fill; reconciliation remains allowed under STOP. |
| 16. Failure cases | Timeout before/after broker acceptance; missing response; lookup not found; lookup failed; partial/incomplete history; durable outcome write failure. |
| 17. Duplicate/replay cases | Repeated identical unknown event is idempotent; conflicting identity/status is rejected; duplicate lookup results do not create new orders. |
| 18. Required assertions | Exact broker-call count stays one; original IDs/intent/reservation retained; correct RECONCILE/WAIT/BLOCK; confirmed fills applied once. |
| 19. Existing regression tests | create-recovery-seller-order-submitter.test.js; order-event-workflow.test.js; recovery-seller-cycle-lifecycle.scenario.test.js. Callback behavior is covered through the submitter/event workflow; there is no standalone recovery-seller-order-callbacks.test.js. New scenario evidence remains PARTIAL. |
| 20. Missing scenario tests | Real submitter plus durable store and broker lookup across every unknown timing point, including lookup not-found and persistence failure. |
| 21. Blocked decisions | No automatic retry/replacement policy is approved. Restart/replay is separately deferred under RS-010. |
| 22. Acceptance criteria | Every #1780 section E/F/J unknown-outcome case has exact identity, reservation and broker-call assertions; no scenario permits retry. |

#### RS-008 — CG/RS shared account resources and concurrency

| Contract field | RS-008 definition |
| --- | --- |
| 1. Purpose | Prove that CG and RS may operate independently without double-spending quote or double-selling shared physical base inventory. |
| 2. Preconditions | One authoritative provider-account runtime; shared Portfolio/OrderRegistry/serialized transition path; both strategy configurations and account snapshot valid. |
| 3. Configuration inputs | Independent CG and RS pair maps, strategy budgets/investment limits, pair enabled/environment selectors and supported order settings. |
| 4. Runtime-derived inputs | Shared Portfolio; Spot/free/locked balances; EARN custody; all active orders/commitments; strategy-owned Positions; effective market volatility configuration/state; market subscriptions; account identity. |
| 5. Domain rules | Physical account custody is represented once. Strategy Positions/ownership/budgets remain separate. Shared allocator serializes account-wide quote/base commitments. Volatility protection is market-owned and strategy-neutral; RS consumes the common gate and never owns a separate volatility engine. An ACCOUNT-scope safety blocker preempts every strategy/side/purpose; market-scoped exceptions cannot bypass it. |
| 6. Decision inputs | Each strategy's own eligibility/budget, account-wide free quote/base, and the shared market-level volatility protection decision. |
| 7. Expected decision | SUBMIT only when strategy budget, shared allocator and market safety gates permit it; otherwise WAIT/BLOCK. An active market-volatility block applies consistently to RS and CG, subject to the approved recovery-SELL exception. |
| 8. State before | Concurrent strategy evaluations may target same or different markets against one shared account state. |
| 9. State after | Independent Position/order ownership remains; serialized allocation prevents double-spend/oversell and deterministic conflicts defer/block one action. |
| 10. Portfolio effects | One actual Portfolio aggregate; multiple independent strategy-owned Positions; no duplicate wallet balance or cross-attribution. |
| 11. Reservation effects | Quote/base commitments are account-wide across markets/strategies; each strategy retains its own budget; no double subtraction or double reservation. |
| 12. Order effects | Immutable strategy/Position/cycle/purpose ownership survives submit, acknowledgement, stream, REST and terminal reconciliation. |
| 13. Commission effects | Actual fee facts are applied to the owning strategy Position and shared account baseline; no fee or asset is attributed to both strategies. |
| 14. Profitability calculation | Each strategy evaluates its own cost basis and net proceeds. A profitable CG/RS outcome cannot subsidize the other strategy or borrow its budget. |
| 15. Invariants | Shared custody conserved once; no double-spend/double-sell; budgets independent; ownership immutable; same-symbol market-data deduplication does not merge strategy identity. |
| 16. Failure cases | Concurrent reservation race; missing account snapshot; conflicting order ownership; one projection fails; Spot/EARN mismatch; stale market/environment route; conflicting CG/RS volatility settings or unavailable market protection state. |
| 17. Duplicate/replay cases | Duplicate Fill is attributed once to its owner; conflicting strategy identity is rejected; replay restoration remains deferred. |
| 18. Required assertions | Same/different-market concurrency; quote/base before/after; active commitments; strategy-owned Positions; broker calls; no cross-budget/cross-fill attribution; RS-only market protection; shared RS/CG gate; disabled-market behavior; recovery-SELL exception; account-blocker precedence across every order side/purpose. |
| 19. Existing regression tests | create-recovery-seller-action-authorizer.test.js; create-recovery-seller-accounting-workflow.test.js; account-runtime-registry.test.js; order-event-workflow.test.js. Zero scenario credit. |
| 20. Missing scenario tests | New deterministic same-market and different-market CG/RS concurrency scenarios covering quote/base contention and failure atomicity, plus RS-008-017 for the shared market-owned volatility gate. |
| 21. Blocked decisions | No additional strategy borrowing or shared-budget policy is implied. Runtime authorization revocation/expiry remains deferred under FITDIB. |
| 22. Acceptance criteria | Every #1780 section G/J case has stable IDs and exact concurrent outcomes; prove no double-spend, double-sell, ownership leakage, or RS bypass of the shared market-volatility gate. |

**Required scenario case `RS-008-017` — RS respects the market-owned volatility gate**

- **Given:** an enabled market in the effective market-pair union, with `enableVolatilityProtection` explicitly enabled; the shared market service reports a protection-active snapshot.
- **When:** the real RS BUY/SELL submission path evaluates that market.
- **Then:** RS consumes the same market protection eligibility/state as CG. A blocked RS BUY is deferred. The market-owned cancellation workflow may cancel Harvester-owned BUY orders for the protected market across CG and RS, but must not cancel SELL orders or external/manual orders. Recovery SELL (`side: SELL`, `purpose: RECOVERY_SELL`) bypasses the volatility blocker only; every other safety gate still applies.
- **Subcases:** `RS-008-017-A` RS-only market receives the market-level gate without a CG route; `RS-008-017-B` same-market CG/RS configurations with conflicting explicit protection values fail during configuration resolution; `RS-008-017-C` disabled protection bypasses only volatility-specific work while all other safety gates remain active; `RS-008-017-D` `RECOVERY_SELL` bypasses only the volatility blocker while other blockers remain active; `RS-008-017-E` cancellation includes Harvester-owned CG/RS BUY orders but never SELL or external/manual orders.
- **Scenario mapping — `RS-008-017-A` (TEST-MAPPED):** the named application regression resolves an RS-only ETHUSDT route without a synthetic CG route, then invokes the real shared `createSubmissionGate` and asserts an active market-owned protection state blocks the RS recovery BUY.
- **Scenario mapping — `RS-008-017-B` (TEST-MAPPED):** registered in the shared RS registry. The named APPLICATION scenario runs `resolveHarvesterOptions` with enabled CG/RS routes and conflicting explicit protection booleans, expecting the exact market-specific rejection. The scenario test passed on head `f90e6eab54d396cf3bfa6e9366de070a81ffcb81`; six-workflow exact-head validation is in progress.
- **Scenario mapping — `RS-008-017-C` (TEST-MAPPED):** the named application regression calls the real `createSubmissionGate` with protection disabled and an otherwise eligible BUY, asserting volatility data is not read and the BUY is not volatility-blocked. A second case proves an independent market pause still blocks.
- **Scenario mapping — `RS-008-017-D` (TEST-MAPPED):** the named application regression invokes the real `createSubmissionGate` with active market-owned volatility. It proves a separate market pause still blocks recovery SELL, and the order is allowed only when all other gates pass. This is offline and does not start Harvester or call a broker.
- **Scenario mapping — `RS-008-017-E` (TEST-MAPPED):** the named offline application test composes the real market-volatility workflow with the real Conservative engine cancellation boundary and a canonical OrderRegistry containing CG/RS BUYs and a SELL. It asserts only the owned BUY identities are canceled, the SELL remains OPEN, and an external/manual broker ID is untouched.
- **Scenario mapping — `RS-008-018-A` (TEST-MAPPED):** a real Conservative engine application regression seeds a canonical RS-owned DOGEUSDT BUY commitment, then evaluates CG on SOLUSDT with only 150 USDT free. It asserts CG defers with `INSUFFICIENT_QUOTE_BALANCE`, submits no BUY, and preserves RS ownership.
- **Scenario mapping — `RS-008-018-B` (TEST-MAPPED):** a named accounting-workflow regression concurrently applies canonical RS and CG BUY fills on the same market through the real workflows sharing one account state. It asserts the exact same Portfolio instance, two strategy-owned Positions, exact independent base quantities and exactly-once Fill identities.
- **Scenario mappings — `RS-008-018-C/D` (TEST-MAPPED):** the pure account allocator receives summed CG+RS quote reservations and defers a further BUY that would exceed free quote (C); it also rejects a further SELL after summed CG+RS base commitments exhaust shared inventory (D). These are deterministic allocation-boundary tests, not a claim that concurrent runtime dispatch is serialized.
- **Scenario mapping — `RS-008-018-E` (TEST-MAPPED):** two concurrent real Conservative engine market-price evaluations on different markets race against one existing RS-owned BUY reservation. With 250 USDT free and 100 USDT already reserved by RS, the shared serialized transition queue allows exactly one 100 USDT CG BUY; the other CG intent defers for insufficient quote. The test asserts one new CG order, one deferred evaluation, and preservation of the RS order identity. This is runtime-level concurrent BUY dispatch evidence for the seeded-RS-reservation case; it does not prove two newly created CG/RS intents race atomically or cross-asset atomicity.
- **Scenario mapping — `RS-008-018-F` (TEST-MAPPED):** the real Conservative engine evaluates a CG SELL while the shared OrderRegistry contains an RS-owned active SELL reserving the entire free base balance. The harness supplies zero exchange-free base and one Portfolio base unit; the allocator must reject the CG SELL with the account-wide available-base-after-commitments error, submit no BUY or SELL, and preserve the RS order identity/status. This proves runtime enforcement against a seeded RS base reservation, not a concurrent newly-created CG/RS SELL race.
- These mappings prove RS-008-017-A/B/C/D/E and RS-008-018-A/B/C/D/E/F only; concurrent SELL/base intent interleavings, cross-asset atomic reservation and broader serialization/failure interleavings remain missing.
- **Boundary:** do not recalculate ATR/volatility, construct candles, test market-state transitions or duplicate the market-owned volatility test suite here. Those belong to the market-level tests and [#1728](https://github.com/45s/coinzilla/issues/1728).

#### RS-009 — STOP, failure atomicity and continued reconciliation

| Contract field | RS-009 definition |
| --- | --- |
| 1. Purpose | Prove STOP blocks additional BUY investment only, while eligible recovery SELL, existing-order reconciliation and confirmed-fill accounting continue safely. |
| 2. Preconditions | STOP is durably latched or a failure is injected at a defined lifecycle boundary; original order/fill identities and durable state are available where applicable. |
| 3. Configuration inputs | Existing RS global/pair enabled and environment settings only. No new reset/resume configuration is introduced. |
| 4. Runtime-derived inputs | Sticky STOP state/reason; durable store; active order identities; canonical REST/stream history; account snapshot; Portfolio/legacy projections; reservations. |
| 5. Domain rules | STOP blocks new BUY spending. An otherwise-valid SELL remains eligible only if the cycle has not used its sole SELL lifecycle and all independent SELL gates pass. WAIT/RECONCILE and confirmed-fill accounting continue. |
| 6. Decision inputs | STOP latch, proposed order side/purpose, cycle SELL identity/status, reconciliation completeness, durable facts, fill ownership, accounting and reservation consistency. |
| 7. Expected decision | BLOCK/STOP for new BUY; permit an otherwise-valid first recovery SELL; WAIT/RECONCILE for existing orders; never create a second/replacement SELL or blind retry. |
| 8. State before | Normal lifecycle or unknown/failed operation; STOP may be absent or already latched. |
| 9. State after | STOP remains sticky until explicit authorized administrator resolution; eligible recovery SELL and existing-order reconciliation remain possible. |
| 10. Portfolio effects | No synthetic changes. Confirmed canonical fills are applied exactly once even when STOP is active; failed projections remain atomic. |
| 11. Reservation effects | Preserve unknown/unresolved commitments; release only after authoritative terminal facts and successful accounting. |
| 12. Order effects | No new BUY. An eligible first SELL may proceed under all normal gates. Preserve the original order identity; no retry, second SELL or replacement SELL. |
| 13. Commission effects | Apply actual commission facts with confirmed Fills. Missing/ambiguous third-asset quote value remains fail-closed and cannot be treated as zero. |
| 14. Profitability calculation | A post-fill adverse recovery/legacy/combined result is committed as fact and latches STOP; the already-used sole SELL lifecycle is not repeated and no cycle reset is inferred. |
| 15. Invariants | Sticky STOP; no additional BUY spending; eligible recovery SELL remains possible; exact-once fills; preserved reservations; reconciliation continues; no automatic clear/resume. |
| 16. Failure cases | Missing/malformed/conflicting evidence; persistence failure; unknown acknowledgement; invalid filters; invalid precision; projection failure; unmodeled terminal outcome; administrator-resolution failure. |
| 17. Duplicate/replay cases | Repeated STOP evidence preserves first reason; duplicate reconciliation/fill is idempotent; conflicting evidence cannot clear STOP; administrator resolution is explicit and evidence-backed. Restart/replay remains unsupported. |
| 18. Required assertions | No BUY broker submission; valid eligible SELL can submit; no second/replacement SELL; STOP state/reason retained; original identity/reservation preserved; reconciliation allowed; atomic Portfolio/legacy state. |
| 19. Existing regression tests | stop-decision.test.js; resolve-recovery-seller-stop.test.js; create-harvester-operator.test.js. These prove existing implementation surfaces, not complete #1780 scenario coverage. |
| 20. Missing scenario tests | New scenario suite proving BUY blocking, eligible SELL allowance, reconciliation/accounting under STOP, and authorized durable administrator resolution. |
| 21. Blocked decisions | No STOP contract blocker remains. Restart/replay and third-asset valuation remain separately deferred/blocked under RS-010. |
| 22. Acceptance criteria | Owner decision is recorded in the canonical specification and #1780; all approved STOP cases have named positive/negative assertions and exact-head evidence.

#### RS-010 — Explicitly deferred capabilities

| Contract field | RS-010 definition |
| --- | --- |
| 1. Purpose | Keep unsupported/deferred behavior visible so agents do not invent restart, fee valuation, liquidation or advanced lifecycle support. |
| 2. Preconditions | A proposed scenario concerns a deferred capability or lacks an approved source/contract. |
| 3. Configuration inputs | No new restart, replay, third-asset valuation, final-residual liquidation or advanced pause/resume configuration is approved by this family. |
| 4. Runtime-derived inputs | Durable facts, restart boundary, order/fill/reservation history and third-asset fee identity/value/timestamp would be required by a future approved design. |
| 5. Domain rules | Unsupported behavior stays unsupported. Missing third-asset valuation fails closed. No synthetic restore, fabricated quote conversion, blind order replay or standalone final-residual SELL. |
| 6. Decision inputs | Explicit owner-approved contract, authoritative source, freshness policy, implementation prerequisites and recovery semantics; absent any prerequisite, disposition is BLOCKED/UNSUPPORTED. |
| 7. Expected decision | BLOCK/STOP or explicit UNSUPPORTED disposition; never claim a successful unsupported operation. |
| 8. State before | Existing process state may contain in-memory RS facts, but durable restart restoration is not implemented/accepted. |
| 9. State after | No fabricated restored state; no invented next cycle/order; unsupported state remains visibly blocked. |
| 10. Portfolio effects | Do not seed Portfolio from wallet balances or synthetic fills. Restore only after a separate approved replay contract and canonical evidence path exist. |
| 11. Reservation effects | Do not release or recreate reservations from incomplete/unrestored facts. No restart assumption may free a live commitment. |
| 12. Order effects | No blind resubmission or standalone final-residual SELL; preserve existing identity and reconciliation requirements. |
| 13. Commission effects | Third-asset fee valuation requires an approved authoritative execution-time quote value/rate/timestamp source; until then the fee is not zero and profitability cannot be accepted. |
| 14. Profitability calculation | No valid profitability result exists when a required third-asset fee value is missing/ambiguous; no final-residual liquidation target is inferred. |
| 15. Invariants | No fabricated history, cost basis, fee conversion, order, reservation release or cycle transition. |
| 16. Failure cases | Missing/corrupt replay facts; incomplete order/fill history; missing fee source; stale/ambiguous quote conversion; unsupported lifecycle request. |
| 17. Duplicate/replay cases | Replay semantics are not approved. Do not claim idempotent restart restoration; future work must define interruption-point behavior first. |
| 18. Required assertions | Explicit BLOCKED/UNSUPPORTED status; no broker call; no Portfolio mutation; no reservation release; no fabricated commission/profitability result. |
| 19. Existing regression tests | Shared DTO, operational-state and commission-accounting regression tests may exist, but none constitutes RS restart/replay or authoritative third-asset scenario evidence. Zero #1780 scenario credit. |
| 20. Missing scenario tests | All restart interruption points; authoritative third-asset valuation; standalone final-residual liquidation; advanced pause/disable/abandon/resume; authorization revocation/expiry. |
| 21. Blocked decisions | Restart/replay contract; third-asset source/freshness; standalone final-residual liquidation; advanced lifecycle; authorization revocation/expiry remain deferred or unresolved under their owning decisions. |
| 22. Acceptance criteria | A separate owner-approved issue/spec defines each capability, source of truth and safety boundary before a new scenario family/case is authored or any status changes. |

#### RS-010 disposition case IDs

RS-010 intentionally has no executable success path while the capabilities remain deferred. Reserve these explicit disposition IDs so the K-section checkboxes are still traceable without implying support:

1. `RS-010-001` — process restart/restoration request remains unsupported.
2. `RS-010-002` — each listed restart interruption point remains unsupported.
3. `RS-010-003` — third-asset commission conversion remains blocked pending an authoritative execution-time source.
4. `RS-010-004` — advanced pause/disable/abandon/resume remains deferred.
5. `RS-010-005` — standalone final-residual liquidation remains unresolved and must not be invented.
6. `RS-010-006` — authorization revocation/expiry remains deferred pending its approved contract.
7. `RS-010-007` — any behavior without a canonical decision remains blocked.

These records must assert the unsupported disposition and absence of unsafe side effects; they must not call a broker, mutate Portfolio, release reservations or fabricate a successful result.

### 11.2 Checkbox-level crosswalk to the owning issue's A–K matrix

Every business-behavior checkbox in sections A–K of [#1780](https://github.com/45s/coinzilla/issues/1780) maps to one or more stable case IDs below. The checkbox suffix is its one-based position within that section (for example, `C.04` is the fourth checkbox in section C). The IDs are reserved requirements, not evidence that a test already exists. Their current status remains the status recorded in #1780 and §11.1.

The mapping is intentionally many-to-many where one behavior needs both a domain and an application proof. A family is not complete merely because one of its cases passes.

| #1780 checkbox | Reserved scenario case ID(s) |
| --- | --- |
| A.01–A.11 | `RS-001-001` through `RS-001-011` (same order as issue checkboxes) |
| B.01 | `RS-002-001` |
| B.02 | `RS-002-002` |
| B.03 | `RS-002-003` |
| B.04 | `RS-002-005` |
| B.05 | `RS-002-006` |
| B.06 | `RS-002-007` |
| B.07 | `RS-002-008` |
| B.08 | `RS-002-009` |
| B.09 | `RS-002-010` |
| B.10 | `RS-002-011` |
| B.11 | `RS-002-012` |
| B.12 | `RS-002-013` |
| B.13 | `RS-002-014` |
| B.14 | `RS-002-015` |
| B.15 | `RS-002-016` |
| B.16 | `RS-002-017` |
| B.17 | `RS-002-018` |
| B.18 | `RS-002-019` |
| B.19 | `RS-002-021` |
| C.01 | `RS-006-001` |
| C.02 | `RS-006-005` |
| C.03 | `RS-001-005`, `RS-001-013` |
| C.04 | `RS-003-001` |
| C.05 | `RS-002-020` |
| C.06 | `RS-006-003`, `RS-006-004` |
| C.07 | `RS-006-006` |
| C.08 | `RS-006-007` |
| C.09 | `RS-006-008` |
| C.10 | `RS-006-009` |
| C.11 | `RS-006-010` |
| C.12 | `RS-006-011` |
| C.13 | `RS-006-012` |
| C.14 | `RS-006-013` |
| C.15 | `RS-006-018` |
| C.16 | `RS-006-019` |
| D.01–D.11 | `RS-004-001` through `RS-004-011` (same order as issue checkboxes) |
| D.12 | `RS-004-013` |
| D.13 | `RS-004-014` |
| D.14 | `RS-004-017` |
| D.15 | `RS-004-015` |
| D.16 | `RS-004-015` |
| D.17 | `RS-004-016` |
| D.18 | `RS-004-018` |
| D.19 | `RS-004-019` |
| D.20 | `RS-004-020` |
| E.01 | `RS-005-001` |
| E.02 | `RS-005-003` |
| E.03 | `RS-005-004` |
| E.04 | `RS-005-005`, `RS-007-009` |
| E.05 | `RS-005-006` |
| E.06 | `RS-005-007` |
| E.07 | `RS-005-008` |
| E.08 | `RS-005-009` |
| E.09 | `RS-005-010` |
| E.10 | `RS-005-010` |
| E.11 | `RS-007-010`, `RS-007-016` |
| E.12 | `RS-005-011` |
| E.13 | `RS-005-012`, `RS-006-013` |
| E.14 | `RS-005-011` |
| E.15 | `RS-004-021` |
| E.16 | `RS-005-013` |
| E.17 | `RS-005-014` |
| F.01 | `RS-009-001` |
| F.02 | `RS-009-001` |
| F.03 | `RS-009-008` |
| F.04 | `RS-009-005` |
| F.05 | `RS-009-012` |
| F.06 | `RS-009-010` |
| F.07 | `RS-009-007` |
| F.08 | `RS-009-006`, `RS-009-011` |
| F.09 | `RS-009-011` |
| F.10 | `RS-009-012` |
| F.11 | `RS-009-012` |
| F.12 | `RS-009-013` |
| F.13 | `RS-009-014` |
| F.14 | `RS-009-009` |
| G.01–G.08 | `RS-008-001` through `RS-008-008` (same order as issue checkboxes) |
| G.09 | `RS-008-011` |
| G.10 | `RS-008-009` |
| G.11 | `RS-008-012` |
| G.12 | `RS-008-013` |
| G.13 | `RS-008-017` |
| H.01 | `RS-005-013` |
| H.02 | `RS-006-011`, `RS-006-012` |
| H.03 | `RS-005-012` |
| H.04 | `RS-005-012`, `RS-006-013` |
| H.05 | `RS-005-012` |
| H.06 | `RS-005-014`, `RS-004-012` |
| H.07 | `RS-003-002` |
| H.08 | `RS-003-013` |
| H.09 | `RS-010-005` |
| H.10 | `RS-005-015` |
| H.11 | `RS-005-015` |
| I.01 | `RS-002-001` through `RS-002-020`; `RS-003-009` through `RS-003-017`; `RS-004-001` through `RS-004-021` |
| I.02 | `RS-002-001` through `RS-002-020`; `RS-003-009` through `RS-003-017`; `RS-004-001` through `RS-004-021` |
| I.03 | `RS-003-009`, `RS-004-017` |
| I.04 | `RS-003-009`, `RS-004-001` through `RS-004-003`, `RS-004-017` |
| I.05 | `RS-003-009` through `RS-003-011` |
| I.06 | `RS-003-009-A` |
| I.07 | `RS-003-011`, `RS-003-016`, `RS-004-018` |
| I.08 | `RS-003-016` |
| I.09 | `RS-003-016` |
| I.10 | `RS-003-021`, `RS-006-004` |
| J.01 | `RS-002-004` |
| J.02 | `RS-006-020` |
| J.03 | `RS-006-021` |
| J.04 | `RS-006-014`, `RS-006-015` |
| J.05 | `RS-007-012` |
| J.06 | `RS-007-013` |
| J.07 | `RS-008-014` |
| J.08 | `RS-005-004`, `RS-005-009` |
| J.09 | `RS-006-022` |
| J.10 | `RS-009-014` |
| J.11 | `RS-008-015` |
| J.12 | `RS-008-016` |
| K.01 | `RS-010-001` |
| K.02 | `RS-010-002` |
| K.03 | `RS-010-003` |
| K.04 | `RS-010-004` |
| K.05 | `RS-009-009` |
| K.06 | `RS-010-005` |
| K.07 | `RS-010-006` |
| K.08 | `RS-010-007` |

The issue's separate acceptance/delivery checklist is not another business-scenario family. Track those items as PR-level acceptance evidence (exact test/CI SHA, documentation synchronization, no exchange operations), not as synthetic domain cases. When a checkbox is split, append a letter suffix to its reserved case ID and add the new mapping here; do not silently change the parent ID.

A matrix checkbox is not complete merely because its family is implemented. Keep every missing/blocked/unsupported case visible in the registry and #1780, and only promote it after all required subcases and evidence are complete.

## 12. Adversarial sequence and failure matrix

Every relevant family must consider these dimensions. Do not blindly multiply every dimension into every scenario; select combinations that can expose distinct business failures and record omitted combinations with a reason.

| Dimension | Required variants where applicable |
| --- | --- |
| Quantity / money | Zero, negative, malformed, exact boundary, just below, just above, very small, precision overflow |
| Inventory | No recovery, partial recovery, multiple BUY tranches, no legacy, exhausted legacy, smaller Spot, off-Spot, reserved inventory |
| Fees | None, base, quote, supported third asset, unsupported third asset, multiple records, mixed assets |
| Fill identity | New, identical duplicate, conflicting duplicate, wrong market, wrong order, wrong Position, wrong strategy |
| Delivery order | REST first, stream first, duplicate REST, duplicate stream, late event, reordered terminal facts |
| Order outcome | Accepted, rejected, timeout before acceptance, unknown after acceptance, active lookup, terminal lookup, not found, lookup failure |
| Execution | No fill, partial fill, multiple partial fills, full fill, partial then cancel, terminal with incomplete history |
| Persistence | Before intent, after intent, after broker acceptance, fill append, recovery projection, legacy projection, reservation release |
| Concurrency | Same market, different market, same base asset, shared quote, simultaneous CG/RS, duplicate evaluator invocation |
| Market rules | Tick, step, min/max price, min/max quantity, min/max notional, missing metadata |
| Safety | STOP clear/stopped, market pause, reconciliation pending, stale snapshot, unknown external order |
| Market identity/readiness | Correct/wrong symbol, base/quote, market metadata, UTC timestamp/freshness and environment selection |

### 12.1 Required failure injection points

For APPLICATION scenarios, inject deterministic failure at named boundaries:

1. Before broker request.
2. After broker acceptance but before response.
3. Durable intent append/flush failure.
4. Durable acknowledgement failure.
5. Stream fill delivery failure.
6. REST terminal history incomplete.
7. Conflicting REST/stream facts.
8. Recovery projection failure.
9. Legacy projection failure.
10. Atomic commit failure.
11. Reservation release failure.
12. Terminal outcome persistence failure.
13. After accounting commit but before order-registry publication/cycle closure.

For every injected failure, assert the entire relevant before/after state: Portfolio/Positions, applied Fill IDs, legacy state, OrderRegistry, cycle state, order identity, reservation, STOP, persistence log and broker call log.

### 12.2 Generated and combinatorial testing

Use generated/property-based testing only where it increases confidence in a stable invariant. It supplements named business scenarios; it never replaces them.

- **Exhaustive finite-state testing:** enumerate every actual valid/invalid lifecycle transition and order terminal outcome from the production state/decision contract.
- **Boundary testing:** use exact threshold, one smallest meaningful unit below and one above for money, quantity, precision and exchange filters.
- **Pairwise combinations:** combine independent configuration/market-readiness dimensions when interaction risk exists; do not create the full Cartesian product of every field.
- **Generated decimal invariants:** generate deterministic exact-decimal inputs to prove quantity conservation, non-negative allocations, fee application exactly once, reservation limits and no cross-subsidy.
- **Generated event sequences:** vary duplicate, conflicting, delayed and reordered canonical events around known lifecycle boundaries.
- **Determinism:** use a fixed/reported seed. A failing generated case must be reproducible and promoted to a named stable scenario/subcase with the minimized counterexample recorded.
- **No duplicated domain logic:** generators may create input values and event orderings; they must call the real production domain/use-case path and use an independent oracle.
- **No random flakiness:** do not depend on wall-clock time, live market data, network, exchange credentials or nondeterministic scheduling. No new property-testing dependency without an explicit repository-level decision.

Do not use a generated test count as evidence that a named business matrix row is complete.

## 13. Contract blockers: exact current treatment

These blockers must appear in the registry, #1780, the repository catalog where relevant, and the Harvester roadmap summary. Do not resolve them in scenario code.

### 13.1 STOP contract — RESOLVED by owner on 2026-11-24

- STOP blocks **additional spending/new BUY investment only**. It does not block an otherwise-valid recovery SELL of already-owned inventory.
- All independent SELL rules remain mandatory: one SELL lifecycle per cycle, profitability, verified custody, shared account-wide reservations, exchange filters, market readiness and order identity. STOP does not authorize a second or replacement SELL.
- Existing orders remain eligible for WAIT/RECONCILE as appropriate. Confirmed canonical fills and commissions continue to be accounted exactly once.
- An authorized administrator may manually clear STOP only after the underlying cause is fixed, authoritative order/fill/balance reconciliation is complete with zero unresolved discrepancies, Portfolio/legacy/reservation accounting is verified, and the durable operator-resolution fact is acknowledged.
- No automatic clear, self-resume or implicit resume is permitted.
- Earlier owner-approved work in #1475 introduced the evidence-backed domain resolver and durable application use case. The owner decision now confirms that this gated manual resolution is permitted; the operator facade must expose it through the existing trusted-operator authorization boundary.
- The source/spec discrepancy is resolved. RS-009 is no longer BLOCKED by STOP policy; its implementation and scenario evidence remain required.

### 13.2 Strategy enabled default — RESOLVED by #1713 / PR #1711

- Owner-approved issue #1713 and merged PR #1711 explicitly set RS_RECOVERY_SELLER_CONFIG.enabled: true by default.
- The current config test asserts this default; the canonical RS specification §15 now records the same decision.
- Each pair's enabled and tradingEnvironment remain authoritative for market route eligibility.
- Enabling the strategy in configuration does not start Harvester, open an exchange connection, or authorize a TESTNET/LIVE session.
- This is no longer a scenario-contract blocker. Do not revert to the historical disabled-default checkpoint.

### 13.3 Third-asset commission valuation — RS-010 BLOCKED

- Fee arithmetic examples exist.
- The authoritative runtime quote-value source is unresolved.
- `thirdAssetFeeQuoteValue` is not part of the validated operator config contract.
- Missing/ambiguous valuation must fail closed; it is not zero.
- Do not add a fabricated conversion rate, ticker lookup, config property or test default.

### 13.4 Dust and exchange-filter behavior — specified contract, not a blocker

The RS specification distinguishes a candidate SELL order that violates an exchange filter from a residual remaining after a successfully completed cycle. These are different events and must have different scenario outcomes.

**Candidate SELL filter violation:**

- Any candidate SELL violating a supported price/quantity increment, minimum/maximum price, minimum/maximum quantity or minimum/maximum notional filter latches global sticky STOP.
- Do not adjust price/quantity, increase legacy allocation, split the SELL, retry automatically or reinterpret the candidate order violation as dust.
- Missing required filter metadata also fails closed/STOPs according to the approved market contract.

**Residual after successful cycle:**

- Only after the SELL is terminal and fully reconciled, all canonical fills/commissions/proceeds/reservations are resolved, and all applicable recovery, legacy and combined profitability gates pass, may a precisely identified residual that cannot be sold solely because of current exchange quantity/notional filters be classified as retained bonus dust.
- Record the exact residual quantity and the specific limiting quantity/notional filter.
- Retained bonus dust remains in the account but is permanently excluded from all future RS cycle calculations: it is not recovery inventory, not legacy inventory, not part of a later SELL target, not part of later profitability, and not counted again as available RS inventory.
- Ordinary sellable residual is not dust and cannot be hidden or discarded.
- Price-filter failures, unavailable commission valuation, incomplete fill/order reconciliation, active reservations and other unresolved accounting/risk conditions are not dust and block successful completion.
- Dust classification cannot bypass the combined profitability gate.

**Smaller remainder versus final residual:**

- A remaining authorized legacy quantity smaller than configured sellQuantity may be sold as the legacy component of the current cycle SELL if it is Spot-available/unreserved and all independent profitability and exchange filters pass. Use the smaller actual quantity; never round up, force, silently discard or classify an ordinary sellable remainder as dust.
- A separate final residual from an already completed recovery cycle, with no new BUY, remains unresolved/deferred. The smaller-remainder rule does not authorize that standalone liquidation.

These distinctions are specified in the RS domain contract and must be scenario-tested. They are not owner-decision blockers. The STOP policy blocker is resolved in §13.1; RS-009 remains SPECIFIED until its new scenario evidence is implemented and verified.

### 13.5 Workflow-to-evaluator cycle-state defect — fix in PR #1815, merge/verification pending

Issue #1809 identified that the real accounting workflow emitted an accumulating cycle-state projection without the canonical domain invariant fields. The default SELL evaluator therefore rejected the workflow snapshot before it reached the SELL planner.

The production fix is isolated in [PR #1815](https://github.com/45s/coinzilla/pull/1815), separate from this scenario initiative. It uses the canonical cycle-state factory at the application boundary, preserves the sole SELL identity for submitted cycles, and does not reinterpret unresolved outcomes as accumulating.

The new composed cases in `test/scenarios/recovery-seller-sell-planner.scenario.test.js` use the real accounting workflow and real default SELL evaluator. They prove:

- An eligible mixed SELL reaches the planner and submits exactly `1.01 ZRO` (1.00 recovery + 0.01 verified legacy), preserving cycle and Position identity.
- Missing verified Spot custody reaches the actual custody guard and produces zero broker submissions.
- Existing account orders, STOP, market pause and incomplete reconciliation take precedence over SELL submission.
- The test uses only deterministic BUY-policy and broker-submit port controls; it does not bypass the workflow, domain validator or default SELL policy.

TDD evidence:

- RED: test-first head `65761e992c86e2fd59bdc0811ab8737dbf3c6a31` failed with `UNEXPECTED_OR_UNMODELED_CONDITION` from the malformed workflow cycle-state projection.
- GREEN: the three composed workflow cases in merged PR #1815 passed Harvester Targeted Tests and all six workflows on exact PR head `20963617c9d9d73c31b47865e0aa34c4a966cc8e`.
- PR #1815 is merged. PR #1823 remains open for owner review; do not mark RS-003 VERIFIED until every approved RS-003 requirement is covered, merged and verified on the exact merged head.

PR #1815 is merged at `cbf07da54fd2e14fbeb3f96d4d9f8efe48d597c2`; its exact PR head `20963617c9d9d73c31b47865e0aa34c4a966cc8e` passed all six workflows. The prerequisite is unblocked, but RS-003 remains PARTIAL because the full matrix is not complete. PR #1823 now adds registered DOMAIN cases RS-003-001…008, matching approved playbook §11.1 cases 1–8: additive configured legacy slice, smaller authorized remainder, recovery-only planning after legacy exhaustion, below/equal/above verified Spot quantity boundaries, shared Portfolio subtraction across markets/CG+RS positions, account-wide existing SELL reservations with snapshot baseline, same-market RS/CG plus cross-market CG reservations, and exact recovery/legacy allocation of one canonical SELL Fill. RS-003-001…003 call `calculateRecoverySellerSellPlan`; RS-003-004/005 call `calculateVerifiedLegacySpotAllocation`; RS-003-006 composes multiple CanonicalOrders, `calculateAccountSnapshotBaselines`, `allocateStrategyOrderCommitments` and `allocateOrderCommitments`; RS-003-007 verifies same-/cross-market ownership and reservation behavior; RS-003-008 calls `createMixedSellFillAllocation` and asserts exact 400+1 gross base, quote proceeds and quote commission conservation. The planner cases derive legacy average cost from `legacyPosition.invested / legacyPosition.quantity`; no separate average-cost configuration input exists. The DOGE/USDT amounts are illustrative fixture values, not pair defaults or fee policy. These cases do not claim reservation races, full TradingRules boundaries, other commission assets, multi-Fill atomicity, durable reservation or dust coverage.

## 14. Implementation roadmap: exact AI-agent execution sequence

This is the approved test-only implementation sequence. Deliver one focused PR per stage, targeting `develop`. Every new scenario test file must be added to `apps/harvester/package.json` under `config.targetedTestFiles` (paths relative to the Harvester package root). A discovered production defect is not fixed inside #1780: preserve the failing evidence and use a separate owner-authorized production issue/PR.

### PR 1 — Registry, schema, traceability and thin runner

**Status: IMPLEMENTED; exact-head verification PASSED — [PR #1819](https://github.com/45s/coinzilla/pull/1819), exact head `06786f5a3c01f87b5e5d30e945ec7e8662f4b75b`.** All five exact-head workflows pass; the targeted scenario file passes 13/13 and the full Harvester suite passes 2,743/2,743. Harvester coverage is 90.60% lines / 83.71% branches / 96.07% functions. The initial registry/catalogs, immutable scenario record helper, traceability validator, ordered DOMAIN runner, execution report and targeted-test registration are implemented. `RS-004-011` remains **TEST-MAPPED**, not VERIFIED, until owner review/merge and merged-head evidence are recorded. No application runner, production behavior, config or exchange operation is included.

- **Objective:** prove the framework with one real RS domain scenario before expanding the matrix.
- **Scope:** implement stable family/case records, schema validation, rule/decision/state/invariant catalogs, ordered Given/When/Then steps, a thin DOMAIN runner, evidence output, and one registered `RS-004-011` all-gates-pass scenario.
- **Files:** add only the necessary planned files: `test/scenarios/recovery-seller/registry/{index,define-scenario,validate-registry,config-fields,domain-rules,decisions,states,transitions,invariants}.js`; `runners/{execute-scenario-steps,run-domain-scenario}.js`; `scenarios/profitability.js`; `registry-and-runner.scenario.test.js`. Update `apps/harvester/package.json` targeted-test registration, this playbook, #1780 and the Harvester roadmap.
- **Tests:** duplicate/unknown IDs, broken references, malformed records, missing fields, invalid status/ownership; run the real `calculateRecoverySellerProfitability()` for RS-004-011 and assert all applicable gates using an independent exact-decimal oracle.
- **Acceptance:** the real domain path runs; detailed assertion messages exist; the execution report names the case, exact test mapping, status, evidence and result; the runner does not auto-promote status; no production/config/runtime behavior changes.
- **Dependencies:** merged #1779 methodology, #1780 matrix/case IDs, existing Harvester Node test conventions and exact-decimal utilities.
- **Out of scope:** application runner, fake broker/store, all-family pre-registration, mass migration of PR #1793 tests, new dependencies, production changes and exchange operations.
- **Exit:** one scenario is registered and executed; registry failures are tested; exact-head checks pass; issue/roadmap record the next P0 case and exact SHA.

### PR 2 — RS-001 and RS-002: authorization/custody and BUY accounting

- **Objective:** prove legacy basis, verified Spot custody, recovery BUY eligibility and canonical BUY accounting are distinct and fail closed.
- **Scope:** operator-declared basis; immutable average cost; Spot total versus free balance; Portfolio-owned base; EARN/off-Spot and external/manual isolation; shared reservations; BUY intent, full/partial/multiple fills, base/quote/zero/multiple supported fees, identity conflicts, ownership, overfill, unknown outcomes, investment cap and pair-budget isolation.
- **Files:** add `scenarios/authorization-custody.js`, `scenarios/buy-accounting.js`, `authorization-custody.scenario.test.js`, `buy-accounting.scenario.test.js`, and the thin `runners/run-application-scenario.js`; extend `registry/index.js` to include every RS-001/RS-002 record and update `apps/harvester/package.json` only for the new test files. Exercise `legacy-position.js`, `legacy-spot-allocation.js`, `legacy-accounting-state.js`, `evaluate-buy-decision.js`, `create-recovery-seller-action-authorizer.js`, `strategy-account-balance-context.js`, `allocate-order-commitments.js`, `order-ownership.js`, `order-registry.js`, `create-recovery-seller-accounting-workflow.js`, `order-event-workflow.js`, `create-user-data-event-transition.js` and `reconcile-terminal-order-fills.js`.
- **Tests:** DOMAIN for basis/custody; APPLICATION with the real accounting workflow, shared Portfolio/OrderRegistry and deterministic fake external ports only where identity/acknowledgement/reservation is the behavior. The registry contains all 14 RS-001 records and all 20 reserved RS-002 business-matrix IDs (001–003 and 005–021), plus cross-cutting application case RS-002-004 for #1780 J.01. Do not count pre-existing workflow tests as scenario evidence.
- **Current evidence (PR #1823 working tree):** RS-001 is PARTIAL: all 14 cases are registered and mapped; the stale-snapshot freshness subcases in RS-001-010 and RS-001-014 remain BLOCKED because the canonical account snapshot has no authoritative freshness marker. RS-002 has 15 of its 20 reserved business-matrix IDs TEST-MAPPED and five PARTIAL (RS-002-002, -006, -012, -015 and -018); no reserved RS-002 parent case remains wholly BLOCKED. Cross-cutting RS-002-004 is also TEST-MAPPED. RS-002-017 now composes acknowledgement-before-fill, fill-before-acknowledgement and immediate terminal acknowledgement through the production order-event workflow and real RS accounting workflow. Remaining partial blockers are application authorization/account snapshot, unfilled partial-order commitment, successful third-asset valuation, overfill/TradingRules enforcement, and reconciliation of an owned UNKNOWN BUY while STOP is latched. These are not VERIFIED; this task did not execute the tests or CI.
- **Acceptance:** exact independent net-base/quote-cost oracles; base and quote fees are accounted; zero and multiple fee records are covered; identical replay is a no-op; conflicting facts and wrong ownership fail without mutation; no synthetic inventory or legacy-basis rewrite. The mapped application cases also assert RS/CG Position isolation, investment-cap boundaries, active-order suppression, durable unknown-submission facts, shared quote-budget isolation, and all three BUY acknowledgement/fill event orderings through the production event workflow. Keep the explicitly blocked subcases PARTIAL until their real owning boundaries are composed and tested.
- **Dependencies:** PR 1; #1780; actual shared Portfolio, account snapshot and commitment contracts.
- **Out of scope:** production policy/runtime changes, mixed SELL planning, STOP changes, restart/replay, successful third-asset valuation, config changes, broker network calls and exchange operations.
- **Exit:** every unblocked RS-001/002 case has exact evidence; blocked cases retain reasons; targeted/full Harvester tests and required exact-head CI pass.

### PR 3 — RS-003 and RS-004: mixed SELL planning and profitability

- **Objective:** prove the exact additive SELL plan and all independent profitability gates.
- **Scope:** recovery net quantity + eligible legacy slice; smaller remainder/exhaustion; verified unreserved Spot; shared reservations; allocation split; fee reserves/gross-up; maker/taker order type; tick/step/min/max filters; minimum notional; exact net proceeds; all three profitability gates; no-submit behavior; post-completion dust distinction.
- **Files:** add `scenarios/mixed-sell-planning.js`, `scenarios/profitability.js`, `mixed-sell-planning.scenario.test.js`, `profitability.scenario.test.js`; update targeted-test registration. Exercise `calculate-sell-plan.js`, `calculate-profitability.js`, `evaluate-sell-decision.js`, `create-recovery-seller-transition-evaluator.js`, the action authorizer and shared allocator.
- **Tests:** real DOMAIN planner/evaluator/profitability with independent decimal oracles; assert exact price, quantity, order type, fee reserve, net proceeds, split, filter result and broker non-submission. Include exact/adjacent thresholds, precision, tiny serialized quantities and missing metadata.
- **Acceptance:** all unblocked RS-003/004 cases have stable IDs/tests; neither allocation subsidizes another; all supported fees are netted; filter violation follows the approved STOP contract; dust is only post-successful-completion quantity/notional residual. Full application wiring must use the real workflow snapshot.
- **Dependencies:** PR 1/2; canonical RS §§3/5/8/9; #1809 for the workflow-to-evaluator proof. If #1809 is not fixed, keep that application case BLOCKED—never inject a canonical state to claim end-to-end coverage.
- **Out of scope:** production fixes under #1780, order submission lifecycle, multi-fill commit, third-asset valuation, restart/replay, standalone residual liquidation and exchange operations.
- **Exit:** planner/economics boundaries have independent expected values; #1809 is fixed separately or remains an explicit blocker; exact-head checks pass.

### PR 4 — RS-005 and RS-007: one SELL lifecycle and unknown outcomes

- **Objective:** prove one SELL per cycle and no blind retry under unknown outcomes.
- **Scope:** durable reservation/identity boundary, broker-call count, repeated evaluation, acknowledgement, timeout before/after acceptance, active/terminal/not-found/failed lookup, partial-fill staging, terminal reconciliation and reservation release. Keep open `PARTIALLY_FILLED` distinct from terminal cancel/expiry with prior fills.
- **Files:** add `scenarios/sell-lifecycle.js`, `scenarios/unknown-outcomes.js`, `sell-lifecycle.scenario.test.js`, `unknown-outcomes.scenario.test.js`; update targeted-test registration. Exercise `cycle-state.js`, `lifecycle-decision.js`, `lifecycle-state.js`, `create-recovery-seller-order-submitter.js`, `recovery-seller-order-callbacks.js` and the accounting workflow.
- **Tests:** DOMAIN state/transition tests; APPLICATION real submitter/workflow with deterministic broker/store fakes and a recorded broker-call log. Cover every RS-005/007 case, including identity conflicts, duplicate delivery, lookup outcomes, partial/cancel races, incomplete reconciliation and persistence failures.
- **Acceptance:** at most one SELL submission per cycle; original identity persists; reservation is created/retained/released only at approved boundaries; no replacement SELL/next BUY/reset; required reconciliation continues while STOP is active.
- **Dependencies:** PR 1–3; existing durable intent/outcome and OrderRegistry contracts; #1809 only if the tested path traverses the real default evaluator.
- **Out of scope:** STOP resolution, process restart/replay, new retry/replacement behavior, production policy changes and exchange operations.
- **Exit:** application evidence proves broker calls, identity and reservation behavior for unblocked cases; exact-head tests/CI pass; remaining blockers are linked.

### PR 5 — RS-006: multi-fill reconciliation and atomic accounting

- **Objective:** prove exact-once recovery/legacy allocation over the complete canonical SELL Fill set and atomic projection commit.
- **Scope:** multiple partial fills; REST/stream permutations; duplicates/conflicts; incomplete history; base/quote commissions; exact allocation; Portfolio + legacy atomicity; durable completion; reservation and registry publication boundaries; post-fill adverse profitability.
- **Files:** add `scenarios/mixed-sell-accounting.js`, `mixed-sell-accounting.scenario.test.js`; update targeted-test registration. Exercise `mixed-sell-fill-allocation.js`, `mixed-sell-fill-reconciliation.js`, `mixed-sell-fill-accounting.js`, `legacy-position.js`, `create-recovery-seller-accounting-workflow.js` and `record-recovery-seller-mixed-sell-reconciled.js`.
- **Tests:** real DOMAIN allocation/accounting plus APPLICATION workflow with canonical OrderRegistry, controlled event delivery and persistence failure injection. Assert Portfolio, legacy state, Fill identities, terminal order, cycle, reservation, durable fact and registry publication before/after every failure.
- **Acceptance:** identical Fill replay is a no-op; conflicting facts reject atomically; incomplete history cannot commit; both projections remain unchanged on either-side failure; reservation remains held; confirmed fills are never discarded for failed profitability.
- **Dependencies:** PR 1–4 and existing durable completion/shared Portfolio contracts.
- **Out of scope:** restart/replay, automatic repair, third-asset valuation, standalone liquidation and production policy changes.
- **Exit:** every unblocked RS-006 case has multi-Fill/atomicity evidence; targeted/full tests and exact-head CI pass.

### PR 6 — RS-008: CG/RS shared account concurrency

- **Objective:** prove physical account resources are shared once while strategy ownership, Positions and budgets remain independent.
- **Scope:** same/different markets; shared quote/base commitments; budget isolation; immutable order/Fill ownership; serialized decisions; market-data subscription deduplication; pause/STOP isolation; external/manual order isolation; RS compliance with the shared market-owned volatility gate; account-scoped blocker precedence over all market-level exceptions.
- **Files:** add `scenarios/shared-account-concurrency.js`, `shared-account-concurrency.scenario.test.js`; update targeted-test registration. Exercise `allocate-order-commitments.js`, `strategy-account-balance-context.js`, `strategy-order-commitments.js`, `src/bootstrap/config/resolve-harvester-options.js`, `src/bootstrap/start-harvester.js`, `src/domain/market/create-market-volatility-protection-eligibility.js`, `src/use-cases/conservative-trading-engine.js`, `src/use-cases/create-candle-history-service.js`, `src/use-cases/create-submission-gate.js`, `src/use-cases/volatility-protection-workflow.js`, the RS action authorizer/accounting workflow and actual shared market-subscription coordinator.
- **Tests:** shared allocator DOMAIN tests and APPLICATION tests with real engine composition, two independent Positions and deterministic concurrent event ordering. Assert RS-only market gate availability, shared RS/CG protection eligibility, conflicting config rejection, disabled-market behavior, volatility-only recovery-SELL exception and owned-BUY-only cancellation (no SELL/manual cancellation) without reimplementing volatility calculations. Do not create a fake allocator or second Portfolio.
- **Acceptance:** no double-spend/oversell/duplicate custody/cross-strategy budget borrowing; each Fill has one owner; serialized decisions are deterministic; one strategy's policy state cannot silently change another's; RS cannot bypass the shared market-volatility gate or own a duplicate volatility engine; an ACCOUNT-scope blocker prevents every broker submission, including shutdown recovery SELL.
- **Dependencies:** PR 1–5 and existing shared Trading Engine, Portfolio and OrderRegistry contracts.
- **Out of scope:** new shared infrastructure, provider migration, new strategy policies, volatility calculations/candle-history/state-machine implementation (owned by market-level tests), any RS-specific volatility engine and live exchange concurrency.
- **Exit:** all unblocked RS-008 cases have same/different-market evidence; exact-head tests/CI pass; catalog/issue/roadmap reflect actual evidence.

### PR 7 — RS-009: STOP and failure atomicity

- **Objective:** prove the owner-approved investment-only STOP contract end to end.
- **Scope:** block new BUY spending; permit otherwise-valid recovery SELL only when the cycle's sole SELL lifecycle remains unused and no stronger ACCOUNT-scope blocker is active; continue existing-order reconciliation and exact-once confirmed-fill accounting; expose explicit evidence-backed administrator resolution through the trusted operator facade.
- **Files:** add `scenarios/stop-and-failures.js`, `stop-and-failures.scenario.test.js`; update targeted-test registration. Exercise `stop-decision.js`, `lifecycle-decision.js`, `lifecycle-state.js`, `create-recovery-seller-stop-workflow.js`, `create-recovery-seller-accounting-workflow.js`, `resolve-recovery-seller-stop.js`, and `create-harvester-operator.js`.
- **Tests:** DOMAIN policy gates and APPLICATION durable STOP/reconciliation with deterministic ports; inject malformed/conflicting evidence, persistence/projection failures, duplicate/out-of-order events and post-fill adverse outcomes. Assert no BUY submission, valid eligible SELL submission, no second/replacement SELL, first STOP evidence, reservation conservation and continued reconciliation. Prove authorized manual resolution and unauthorized rejection.
- **Acceptance:** no additional BUY spending while STOP is active; all independent SELL gates remain intact; an ACCOUNT-scope blocker overrides the recovery-SELL allowance; reconciliation and exact-once accounting continue; only an authorized administrator can clear STOP after complete evidence and durable acknowledgement; no automatic clear/resume occurs.
- **Dependencies:** owner decision recorded in [#1780](https://github.com/45s/coinzilla/issues/1780); PR 1 and relevant PR 4/5 evidence; existing durable STOP workflow.
- **Out of scope:** restart/replay, automatic restoration, automatic STOP clearing, new retry/replacement policy, standalone final-residual liquidation, and any behavior outside the owner decision.
- **Exit:** RS-009 leaves SPECIFIED only when the complete scenario suite and exact-head verification are recorded; it becomes VERIFIED only after merge to develop and required CI evidence.

### RS-010 — deferred capability dispositions; not an implementation PR

- **Objective:** preserve unsupported capabilities without implying product support.
- **Scope:** register `RS-010-001` through `RS-010-007` as explicit BLOCKED/UNSUPPORTED disposition records. Add only tests for the disposition and absence of unsafe side effects.
- **Files:** `scenarios/deferred-capabilities.js` under the PR 1 registry; #1780 and this playbook only when an owner-approved contract/source changes.
- **Tests:** assert no broker call, Portfolio mutation, reservation release, synthetic restored state, fabricated third-asset conversion or standalone residual SELL.
- **Acceptance:** each deferred ID has a reason and unblock condition; no report claims unsupported behavior is implemented.
- **Dependencies:** PR 1 registry and a separate owner-approved product issue/specification for each capability.
- **Out of scope:** runtime implementation, restart/replay activation, fee valuation invention, automatic STOP resolution and standalone liquidation.
- **Exit:** all deferred IDs remain visible and explicitly blocked until their own approved contract is implemented and proved.

### 14.1 PR sizing and commit discipline

- One coherent family or a small tightly coupled group per PR.
- Keep test-only scenario work separate from production bug fixes when that improves review and preserves issue ownership.
- If a scenario exposes a real defect, capture the reproduction and exact failure first; create/update the production issue; fix the smallest behavior boundary with TDD.
- Never weaken an assertion or alter an expected oracle to make CI pass.
- Work only on a feature branch based on latest develop and target develop. Never push directly to main/develop.
- Never force-push, rewrite history or bypass branch protection; use normal incremental commits.
- Leave every PR open for owner review/merge. Never merge or enable auto-merge.
- Update #1780 after every material matrix/evidence change; update the repository catalog when human-readable status/mapping changes.
- Keep the Harvester roadmap concise and synchronized with the current phase/blockers.

## 15. Coverage, evidence and generated reporting

### 15.1 Use the shared status vocabulary

Use the exact vocabulary in [Domain Scenario Testing Methodology](../../../../docs/testing/DOMAIN_SCENARIO_TESTING.md):

| Status | Meaning | Promotion rule |
| --- | --- | --- |
| `SPECIFIED` | Behavior and expected result are documented; no accepted test mapping yet | Scenario definition reviewed |
| `TEST-MAPPED` | Candidate file/case is linked; assertion review or exact evidence is incomplete | Named test exists; not coverage proof |
| `VERIFIED` | Assertions reviewed against authority and independently derived oracle; exact named tests passed on recorded SHA | All required subcases and evidence complete |
| `PARTIAL` | Some required behavior is proved; missing subcases are explicitly listed | Never promote based on test count |
| `MISSING` | No adequate new scenario proves the behavior | Initial state for new matrix rows |
| `BLOCKED` | Contract, source of truth or prerequisite is unresolved | Explicit blocker and owner-unblock condition |
| `UNSUPPORTED` | Behavior is outside current supported contract | Cite the contract and do not invent support |

Do not introduce parallel status names such as COVERED or IN PROGRESS. Work progress belongs in issue checklists/PR state; scenario evidence uses the shared vocabulary.

### 15.2 Evidence record

A VERIFIED case must record:

- Scenario ID and family.
- Exact test file and named test title.
- Exact command that ran the case.
- Exact 40-character commit SHA.
- Result for the exact test.
- Assertion/oracle review confirmation.
- Relevant exact-head required CI result for the PR.
- PR link and merged commit SHA.
- Any skipped tests and why.

Do not use a prior SHA, branch name, test count or PR merge status as a substitute for exact-head evidence.

### 15.3 Coverage is a matrix, not a percentage

Report coverage by family, individual scenario ID, required subcase, rule/decision/state/transition/invariant, configuration field, test layer, exact test case, evidence status and blocker.

The report must show missing/blocked/unsupported rows, not hide them in an aggregate percentage. A row with one happy path and five missing adversarial cases remains PARTIAL.

### 15.4 Generated report design

The report generator consumes:

1. Checked-in scenario registry.
2. Actual test-runner result data.
3. Explicit human-reviewed oracle/authority status.
4. Exact SHA and CI metadata recorded for that run.

It must not infer VERIFIED merely from registry presence or a test file existing. If the runner cannot supply reliable named-case results, report TEST-MAPPED or PARTIAL and explain the evidence limitation.

## 16. Documentation and issue synchronization contract

These documents/issues have different roles. Keep them synchronized without duplicating full content.

| Artifact | What must be updated | What must not be copied into it |
| --- | --- | --- |
| This playbook | Framework/schema/authoring contract, family instructions, file-tree changes, phase sequencing, persistent blockers | Every test run or complete issue history |
| RS specification | Only owner-approved business contract changes | Test implementation progress |
| RS implementation roadmap | Production implementation phases and dependencies | Scenario matrix details unless a source-backed blocker affects implementation |
| Harvester ROADMAP.md | Short scenario phase, active issue, current blocker and next PR | Full scenario tables or every test case |
| #1780 | Full live matrix, every subcase status, named test mapping, blocker, PR, exact SHA/CI and next action | Generic scenario methodology |
| #1779 | Shared methodology only; completed dependency should remain closed | RS matrix and test progress |
| #1783 | Repository catalog status and cross-domain navigation work | Detailed RS case-by-case matrix |
| #1809 | Production workflow-to-evaluator defect and its production fix evidence | General RS scenario framework |
| SCENARIO_CATALOG.md | Concise RS family descriptions/status and links to playbook/#1780 | Full implementation playbook |
| DOMAIN_TEST_INVENTORY.md | Supplemental source/existing-test inventory and explicit no-credit rule | New scenario registry or duplicated matrix |
| critical-behaviors.json | Existing critical module/test contract when its ownership genuinely changes | RS scenario registry |

### 16.1 Update triggers

Update affected documents/issues in the same logical PR when:

- A scenario family, subcase or status changes.
- A new test file/case is added, renamed or removed.
- A source defect is discovered.
- A contract blocker is found or resolved.
- A scenario is promoted to VERIFIED.
- A config field, decision, state, transition or invariant changes.
- A phase/priority/next action changes.
- A PR is merged and its exact evidence becomes final.

### 16.2 Issue update template

Every material #1780 update must state:

~~~markdown
## Checkpoint — YYYY-MM-DD

- Develop SHA:
- Scenario IDs changed:
- Current status:
- New/changed test file and exact case:
- Production source affected (if any):
- Independent oracle reviewed:
- Exact test command/result:
- PR head SHA:
- Required CI result:
- Merge commit (if merged):
- Remaining subcases:
- Blockers/owner decisions:
- Documentation synchronized:
- Next action:
~~~

Never write "all scenarios covered" without a row-by-row audit. Never leave a stale PR head or pre-merge status in the current-state section.

## 17. AI-agent task procedure: from request to review-ready PR

An agent asked to "implement RS domain scenarios" must execute this sequence without relying on chat history.

### Step 1 — Repository and current-state audit

1. Read root and Harvester AGENTS files. Do not run a Task Preflight command or create a preflight attestation; Harvester AGENTS explicitly says it is not a required development step.
2. Read applicable task checklist, engineering standards, AI workflow, TRADING_FIRST, Harvester roadmap, this playbook, RS spec, RS implementation roadmap, shared methodology and scenario catalog.
3. Fetch current develop SHA and check whether the working branch is based on it.
4. Read #1780 and its latest comments; identify the next unchecked P0 subcase.
5. Read related open issues, especially #1809 and any newly linked blocker.
6. Inspect current production source, relevant consumers, current scenario files, package test registration and test support.
7. Verify that no source path, state, enum, config field or previous PR status in this document has become stale.
8. Select one coherent scenario slice; do not start implementation until the exact expected business outcome is written.

### Step 2 — Define the scenario before coding

For each case:

1. Assign stable ID.
2. Link exact specification section/approved decision.
3. Set priority and test layer.
4. Record all relevant config fields and rule/decision/state/transition/invariant IDs.
5. Write Given with complete ownership, basis, custody, Portfolio, order, reservation and STOP facts.
6. Write ordered When events with canonical identities and exact decimal strings.
7. Derive Then independently, including all money/quantity/state/accounting outputs.
8. Write MustNot assertions for dangerous side effects.
9. List boundary, duplicate, conflict, reorder, partial, timeout and failure variants.
10. Name production source paths and exact test case.
11. If any expected behavior is disputed or unsupported, mark BLOCKED/UNSUPPORTED and stop that case.

### Step 3 — Choose the smallest correct layer

- Pure rule/calculation/state/accounting claim: DOMAIN.
- Broker call, persistence, order identity, reservation, event ordering or workflow claim: APPLICATION.
- Restart/replay: UNSUPPORTED until separately authorized.
- Never mock the production component whose behavior is the subject of the scenario.

### Step 4 — Implement test-first

1. Add the smallest canonical fixture needed.
2. Write the readable scenario using real production components.
3. Establish RED if behavior is absent/incorrect; if it passes immediately, inspect whether the intended production path was truly exercised.
4. Keep expected financial values independent.
5. Assert complete relevant state and forbidden side effects; every assertion needs a detailed diagnostic message.
6. Register every new scenario test file in `apps/harvester/package.json` under `config.targetedTestFiles`. Paths are relative to the Harvester package root (for example, `test/scenarios/recovery-seller-profitability.scenario.test.js`). The targeted-test runner rejects missing, duplicate, absolute or out-of-package paths.
7. Run the narrowest targeted test. Canonical commands:

~~~bash
# One scenario file (from repository root):
pnpm --filter @coinzilla/harvester exec node --test --test-reporter=spec test/scenarios/recovery-seller-profitability.scenario.test.js

# All configured Harvester targeted regression files, including registered scenario files:
pnpm --filter @coinzilla/harvester run test:targeted

# Full Harvester package test suite:
pnpm --filter @coinzilla/harvester test
~~~

8. Fix a genuine defect only within an explicitly scoped production issue/PR; do not weaken the test.
9. Run relevant broader tests and repository checks as appropriate. The root package manager is pinned to `pnpm@12.11.2`; use the repository-pinned toolchain, not npm/yarn.
10. Keep scenario tests deterministic and offline. Do not run `testnet:*`, live broker commands, order placement/cancellation or credential-backed scripts as part of scenario verification.

### Step 5 — Record evidence and synchronize

1. Update registry and traceability.
2. Update #1780 with exact scenario ID, case title, status, missing subcases and evidence.
3. Update catalog RS entry if its human-readable status or mapping changed.
4. Update Harvester roadmap phase/next action.
5. Update domain inventory only if its supplemental source/test mapping changed.
6. Update or link a production issue when a real implementation defect was exposed.
7. After every material scenario decision, discovered defect, test result or evidence change, update the owning issue and affected docs immediately; do not batch important evidence until the end.
8. Commit and push; synchronize branch with latest develop.
9. Verify exact PR head and GitHub Actions results.
10. Keep PR open for owner review and merge.
11. After merge, record merged SHA and re-check issue/docs freshness.

### Step 6 — Stop conditions

Stop and mark the affected case BLOCKED if:

- The canonical spec is contradictory or silent.
- Expected financial result cannot be independently derived.
- Current source path/identity/state is unclear.
- Required authoritative custody/fee/market evidence is unavailable.
- A test would need to invent a trading action or lifecycle transition.
- A scenario requires exchange credentials or a TESTNET/LIVE operation.
- A scenario would claim unsupported restart/replay behavior.

Do not stop the entire initiative because one family is blocked; continue independent unblocked P0 families.

## 18. Review checklist for the owner

A review-ready scenario PR should make every applicable answer obvious:

- [ ] Is the scenario derived from the canonical RS contract, not an existing test?
- [ ] Is the family and case ID stable and unique?
- [ ] Are all input facts visible and exact?
- [ ] Does the test call the real production domain/use-case path?
- [ ] Is the chosen test layer correct?
- [ ] Are expected financial values independently calculated?
- [ ] Are recovery, legacy and combined gates all asserted where relevant?
- [ ] Are actual commission assets and net quantities handled?
- [ ] Are canonical identity, ownership and custody preserved?
- [ ] Are exact before/after projections asserted?
- [ ] Are negative assertions present for dangerous side effects?
- [ ] Are duplicates, conflicts and failure boundaries covered where applicable?
- [ ] Are test helpers mechanical rather than a second implementation?
- [ ] Are all unsupported/blocked subcases explicit?
- [ ] Is every new scenario test file registered in `apps/harvester/package.json` `config.targetedTestFiles`?
- [ ] Does every assertion include a detailed failure message?
- [ ] Does registry validation reject broken references?
- [ ] Does the report distinguish test mapping from verified evidence?
- [ ] Are #1780, catalog, roadmap and relevant inventories synchronized?
- [ ] Is the PR based on current develop, targets develop and left unmerged?

## 19. Frequently asked implementation questions

**Should an agent inspect and grade all existing RS tests first?**

No. Existing RS tests remain ordinary regression protection and receive zero scenario-matrix credit. Build the new matrix from the RS specification and #1780. Inspect existing source/tests only to understand real production composition and avoid duplicating helpers; do not use them as proof.

**Should all scenarios be in one file?**

No. One coherent family module/file, readable test cases, stable IDs. Do not create a mega-test or a Cartesian-product test.

**Should the registry contain every future scenario before the first test is written?**

No. Define stable family/rule/decision/state vocabulary and the first executable records. Expand family modules when their first cases are implemented. The issue matrix still lists the full required behavior from the beginning.

**Can a scenario call a production helper to calculate its expected result?**

No. That would make the test oracle circular. Use an independent exact-decimal derivation.

**Can a DOMAIN scenario prove no broker call occurred?**

No. It can prove no intent/decision was produced. A broker-call assertion belongs to an APPLICATION scenario with the real submitter and a fake broker.

**Can a pure state test prove reservation durability?**

No. It proves only the state function. Durable reservation and release require the real application workflow and a controlled persistence boundary.

**Can a test normalize an invalid production workflow state with a factory?**

Only to isolate a narrower domain planner claim, and the test/documentation must say exactly that. It cannot claim full workflow-to-evaluator coverage. #1809 owns the known wiring defect.

**Should the runner automatically mark a passing case VERIFIED?**

No. It can report execution. Human-reviewed authority, independent oracle, all required subcases, exact SHA and CI evidence are also required.

**Should a blocked scenario be deleted or skipped forever?**

No. Keep it in the registry/matrix with BLOCKED status, exact reason and unblock condition. Unsupported capabilities remain UNSUPPORTED.

**Should RS inherit Conservative replacement SELL behavior?**

No. RS has its own one-SELL-per-cycle contract. Shared infrastructure does not imply shared strategy semantics.

**Should the agent add a separate final residual SELL without a new BUY?**

No. The smaller-remainder rule applies to the legacy slice within the current cycle SELL. Standalone final-residual liquidation without a new BUY remains unresolved and must not be invented.

**Should volatility protection be implemented or asserted as an RS-only state machine?**

No. Volatility protection is market-owned and strategy-neutral. RS is one strategy route that must respect the market gate; it does not own candle history or volatility state transitions.

**Should the agent change STOP, dust or third-asset policy while writing tests, or revisit the enabled default?**

Do not change STOP, dust or third-asset policy without the required owner decision. The enabled default is already resolved by owner-approved #1713 / merged PR #1711 and is recorded in the canonical RS specification; do not revert it in a scenario PR.

**Does a merged PR mean the family is complete?**

No. PR #1793 is the initial partial scenario slice. Its four files and exact assertions do not complete RS-001…RS-010.

**Can an agent stop because no local checkout or test runner is available?**

No. Harvester AGENTS requires GitHub repository operations and GitHub Actions as the verification runner when local tools are unavailable. Implement the real changes, open/update the PR, inspect the exact PR-head checks, and fix failures. Never ask the owner to run the tests and never claim success without exact-head evidence.

**What should the next agent do first?**

Read the current #1780 checkpoint and this playbook, verify latest develop, then implement PR 1 (registry/schema/traceability/thin runner with one representative real scenario) unless #1780 has since recorded a different owner-approved next action.

## 20. Current baseline at initial publication

This section is a dated baseline, not a permanent status source. #1780 is the live source for later progress.

- Repository: `45s/coinzilla`.
- Branch: `develop`.
- Audited develop SHA: `a72cfb0fb66461290a8855a6df774dcdd87b2c6e`.
- PR #1795 (shared methodology) is merged. Merge commit: `05deb23a12c56ad64b231f0c59392e6d916447b1`.
- PR #1793 (initial RS scenario slice) is merged. PR head: `4d59272ea22317b3540d2356082b270328542c7e`; merge commit: `9902d6a01d675a988a40f0fb2130c3eb477675ef`.
- PR #1793 exact-head check runs: all required checks reported success on its PR head; the read-only Binance TESTNET workflow was skipped. The scenario families remain PARTIAL/MISSING/BLOCKED as shown in #1780; successful CI does not make the matrix complete.
- Issue #1809 remains open for the workflow-to-evaluator cycle-state defect.
- Issue #1779 is now closed as completed after shared-methodology PR #1795 merged.
- Issue #1780 remains the primary open RS scenario matrix.
- Issue #1783 remains the repository-wide catalog tracker; it should point to this playbook but continue to own cross-domain catalog work.

**Baseline warning:** re-fetch current branch, PRs, issues, source files and CI before using any of these statuses in a future task. Do not assume this dated baseline remains current.

## 2026-11-28 — RS-004 profitability input-boundary scenarios

- Added six independently named deterministic domain cases in `test/scenarios/recovery-seller-profitability-input-boundaries.scenario.test.js`: exact legacy break-even, sub-cent legacy loss, exhausted legacy allocation, legacy proceeds with no legacy debit rejected, non-positive recovery basis rejected, and non-positive minimum profit rejected.
- Registered the file in Harvester targeted tests. These are test mappings, not verified scenario evidence; exact-head execution and oracle review remain outstanding.
- No production trading logic or behavior was changed.
