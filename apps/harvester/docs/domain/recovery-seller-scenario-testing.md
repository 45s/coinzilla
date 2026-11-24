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

**This document does not change RS trading behavior.** The draft [Recovery Seller Domain Specification](recovery-seller-domain-specification.md), its accepted decisions, and the owning issue remain the authority for business behavior. This playbook explains how to prove that behavior. It must never invent retry, replacement, STOP reset, liquidation, dust, restart, or recovery policy.

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
- Inventing STOP reset/resume, SELL retry/replacement, post-fill recovery, partial terminal SELL continuation, dust treatment or new-cycle behavior.
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
| apps/harvester/src/domain/strategies/recovery-seller/stop-decision.js | Defines sticky STOP decisions/state/gating and an internal evidence-backed resolution function. Its resolution semantics conflict with the later #1780 no-reset contract; do not infer that the function is an approved runtime/operator capability. |
| apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js | Coordinates RS BUY accounting and terminal mixed-SELL accounting across shared Portfolio, legacy accounting, order registry and cycle snapshots. |
| apps/harvester/src/use-cases/create-recovery-seller-action-authorizer.js | Authorizes RS actions against shared account-wide quote/base commitments, RS budget, recovery inventory and verified unreserved legacy Spot. |
| apps/harvester/src/use-cases/create-recovery-seller-order-submitter.js | Coordinates durable submission intent, broker submission, acknowledgement and unknown/unresolved submission outcomes for RS-owned orders. |
| apps/harvester/src/use-cases/create-recovery-seller-runtime-evaluator.js | Composes RS runtime readiness, market state, STOP and strategy evaluation at the runtime boundary. |
| apps/harvester/src/use-cases/create-recovery-seller-stop-workflow.js | Restores and persists the durable RS STOP blocker/state used by runtime safety gates. |
| apps/harvester/src/use-cases/create-recovery-seller-transition-evaluator.js | Composes pure RS BUY/SELL policies with the real accounting-workflow snapshot and decides whether to continue a BUY tranche or submit the sole SELL. |
| apps/harvester/src/use-cases/record-recovery-seller-mixed-sell-reconciled.js | Persists the durable terminal mixed-SELL completion fact only after both accounting projections and profitability outcome are verified; controls reservation-release boundary. |
| apps/harvester/src/use-cases/recovery-seller-order-callbacks.js | Supplies RS-owned pending, acknowledgement, submission-failure/deferred and execution callbacks to the shared submitter/event workflow. |
| apps/harvester/src/use-cases/recovery-seller-submission-ownership.js | Re-exports the shared domain validator for immutable RS submission ownership; do not duplicate ownership validation in scenario helpers. |
| apps/harvester/src/use-cases/resolve-recovery-seller-stop.js | Implements an evidence-backed durable operator-action resolution use case. It is not exposed by the current CC-operator facade and remains part of the #1780 STOP contract discrepancy. |

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
│   └── reports/
│       ├── parse-test-results.js                # Actual test-run evidence
│       └── generate-coverage-report.js          # Registry + execution + review status
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
| Verified Spot custody | Authoritative currently available Spot quantity | Treating wallet total, EARN or off-Spot quantity as sellable |
| Account reservation | Inventory/quote committed by active account orders and strategies | Counting a reservation twice or ignoring another strategy's reservation |
| Canonical Portfolio | Actual confirmed account accounting with strategy-owned Positions | Creating a parallel test Portfolio implementation |

Historical basis/provenance and current custody are independent facts. A transfer between Spot and EARN changes custody/availability; it does not rewrite historical acquisition basis.

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
- CANCELED, REJECTED and EXPIRED outcomes do not authorize a replacement SELL or a new BUY cycle.
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

The RS contract requires unexpected, missing, contradictory or unsupported conditions to fail closed. Already-submitted orders and confirmed fills still require reconciliation/accounting; STOP is not permission to abandon them.

The exact STOP resolution contract is currently disputed by specification and source. Keep RS-009 BLOCKED until the owner resolves it. See section 13.

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

The strategy config currently sets `enabled: true` at the audited checkpoint. The RS specification's section 15 contains a conflicting disabled-by-default statement. Do not create a default assertion or change config until the owner resolves that discrepancy. Per-pair environment eligibility remains a separate control.

**Volatility is market-owned, not RS-owned.** The effective protection market set is derived from the union of enabled strategy market configurations, not from a CG or RS execution route. A configured market with market-level enablement and `enableVolatilityProtection: true` receives volatility history/state/protection even when it has no CG route. When the same market is configured in CG and RS, both explicit protection values must agree; startup rejects conflicting values. Do not route volatility calculation, candle history or protection through an RS-specific BUY/SELL execution path or strategy lifecycle. Market inclusion follows the shared market-configuration aggregation rules. RS scenarios may prove that the real market-level protection gate is respected, but volatility calculations and market-state transitions belong to their strategy-neutral market tests. See [Harvester Volatility Protection](../volatility-protection.md) and [#1016](https://github.com/45s/coinzilla/issues/1016).

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
- STOP safety: new trading actions stop while permitted reconciliation/accounting continues.
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
| STOP blocks new orders but reconciliation continues | APPLICATION |
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
9. Real TradingRules filters, including quantity/notional and tick/step boundaries.
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

**Known blocker:** #1809 records the real accounting-workflow transition snapshot emitting an accumulating cycle state that the default SELL evaluator rejects. An isolated planner scenario using the canonical cycle-state factory does not prove this workflow-to-evaluator path. Keep that subcase explicitly blocked until #1809 is fixed and tested through real composition.

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
10. Terminal partial/CANCELED/REJECTED/EXPIRED outcomes leave the cycle unresolved and follow the approved terminal STOP contract; no replacement SELL or next BUY is created. This STOP outcome remains subject to the documented source/spec discrepancy.
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
12. Failure in either projection leaves both unchanged; the cycle reservation remains held and no partial projection is published. Any STOP disposition remains subject to the unresolved STOP contract.
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

Core source ownership: shared Portfolio, account snapshot/commitment allocator, Trading Engine serialization, RS/CG ownership and action authorization.

### RS-009 — STOP, failure atomicity and continued reconciliation (P0; BLOCKED)

**Business question:** does unexpected evidence block new trading while preserving order/fill facts and required reconciliation?

Potential cases after owner resolution:

1. STOP is sticky across later market updates and unrelated operator commands.
2. No new BUY/SELL/replacement/retry occurs while STOP is active.
3. Existing active order may be WAITed/reconciled under the contract.
4. Confirmed canonical fills continue to be accounted exactly once.
5. Missing, malformed, conflicting or unmodeled evidence fails closed.
6. Persistence/commit failure preserves projections and reservations as specified.
7. Any candidate SELL exchange-filter violation latches global sticky STOP with no adjustment/split/retry/dust reinterpretation; only a residual after a successfully completed, fully reconciled cycle may qualify as quantity/notional-constrained retained bonus dust.
8. Operator visibility and permitted actions match the approved STOP contract; the operator facade remains read-only unless the owner changes the contract.
9. No implicit reset or self-resume occurs.
10. Missing account snapshot, stale market data, invalid market metadata, missing filters or invalid precision blocks new actions.
11. Durable intent failure prevents broker submission when required; durable outcome failure preserves uncertainty and prevents blind retry.
12. Invalid BUY/SELL intent is never submitted; invalid Fill identity cannot mutate Portfolio, allocations, reservations or completion state.
13. Failure after external submission but before local acknowledgement retains canonical identity for reconciliation and blocks duplicate submission.
14. STOP does not prevent required reconciliation of already-submitted orders/fills.

**Do not implement this family as if its contract were settled.** The specification says terminal STOP/no reset, while current source contains `resolveRecoverySellerStopState` and `resolveRecoverySellerStop`; the operator facade exposes read-only status. Record and wait for owner resolution. The existence of a source helper is not approval to expose it.

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

### 11.1 Crosswalk to the owning issue's A–K matrix

Every checkbox in [#1780](https://github.com/45s/coinzilla/issues/1780) must map to at least one stable scenario/subcase ID. This crosswalk prevents a future agent from accidentally treating the RS-001…RS-010 family names as permission to omit an original matrix section.

| #1780 matrix section | Playbook family ownership |
| --- | --- |
| A. Authorization, legacy declaration and custody | RS-001 |
| B. Initial recovery BUY and BUY accounting | RS-002 |
| C. Recovery and legacy allocation accounting | RS-001, RS-002, RS-003 and RS-006 |
| D. Independent profitability and SELL economics | RS-004 |
| E. One-SELL-per-cycle lifecycle and reservations | RS-005, with application evidence in RS-007 |
| F. STOP, failure atomicity and fail-closed behavior | RS-006, RS-007 and RS-009 |
| G. Concurrent strategies and account-wide resource safety | RS-008 |
| H. Cycle completion, residuals and next-cycle behavior | RS-003, RS-005, RS-006 and RS-010 |
| I. Market, exchange precision and exact arithmetic | RS-002, RS-003 and RS-004 |
| J. Application integration scenarios | RS-002, RS-005, RS-006, RS-007 and RS-008 |
| K. Explicitly deferred / blocked scenarios | RS-009 and RS-010 |

A matrix checkbox is not complete merely because the family is implemented. Split it into individual stable subcase IDs where it contains more than one independently falsifiable behavior. Keep every missing/blocked/unsupported subcase visible in the registry and #1780.

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

### 13.1 STOP resolution discrepancy — RS-009 BLOCKED

- The later #1780 contract describes STOP as sticky/terminal with no clear/reset/resume path; the current specification carries the same statement.
- Earlier owner-approved work is recorded in #1475 (2026-11-19): it introduced an evidence-backed resolveRecoverySellerStopState domain gate and durable resolveRecoverySellerStop application use case.
- The current CC-operator facade exposes read-only STOP status and does not expose that resolution use case as a command.
- The source therefore contains a real historical contract discrepancy: the existence and earlier approval of the internal resolver do not prove that the later #1780 no-reset contract permits its use.
- The owner must decide whether the internal resolution path is obsolete/forbidden or whether the current contract permits only that tightly gated durable administrative resolution.
- Until the later contract is reconciled with the earlier approval, do not write positive or negative assertions that assume one interpretation. RS-009 stays BLOCKED.

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

These distinctions are specified in the RS domain contract and must be scenario-tested. They are not owner-decision blockers. RS-009 remains BLOCKED only for the separate STOP resolver/source-contract discrepancy described in §13.1.

### 13.5 Workflow-to-evaluator cycle-state defect — RS-003 application proof BLOCKED by #1809

Issue #1809 documents that the accounting workflow snapshot's accumulating cycle state lacks required invariant fields, causing the real default SELL evaluator to reject the state before planning.

Required fix belongs to #1809, not the documentation/scenario-only issue. The fix must preserve the domain validator and make the real workflow-to-evaluator boundary produce a canonical valid state. Acceptance must include:

- Real accounting workflow.
- Real transition snapshot.
- Real default SELL evaluator.
- Eligible mixed SELL reaches planner and produces expected intent.
- Missing verified Spot still fails closed.
- Existing order, STOP, pause and reconciliation gates keep precedence.

Until merged and covered, an isolated planner test using the canonical state factory proves planner economics only, not the full application path.

## 14. Implementation roadmap: exact AI-agent execution sequence

This sequence is the approved working roadmap. Deliver small PRs against develop. Do not combine unrelated families. Every PR must update affected docs and issues in the same logical increment.

### PR 1 — Registry, schema, traceability and thin runner

**Goal:** prove the framework itself with one real scenario before adding a large matrix.

Deliver:

1. Registry record schema and stable ID validation.
2. Family/config/rule/decision/state/transition/invariant catalogs with only source-verified entries.
3. Registry validator with meaningful failure messages.
4. Thin domain runner and ordered step contract.
5. Test-result mapping/evidence shape.
6. One representative RS-004 profitability scenario registered and executed through the new runner.
7. Documentation of implemented schema and exact file tree.
8. Update #1780 and roadmap with exact implementation/evidence state.

Do not:

- Change production code/configuration.
- Create fake RS domain rules.
- Move all four existing scenario files.
- Build an elaborate application simulator before a family needs it.
- Claim registry completeness equals scenario coverage.

Acceptance:

- Duplicate/unknown IDs and references fail validation.
- Representative scenario executes real production domain behavior.
- Expected values are independently calculated.
- Negative assertions execute.
- Runner output identifies scenario ID and named test.
- No production behavior changes.

### PR 2 — RS-001 and RS-002: authorization/custody and BUY accounting

Deliver highest-risk legacy ownership and confirmed BUY accounting cases. Separate basis from custody, canonical fills from requested quantities, and actual fee assets. Include duplicate/conflict/unknown BUY cases. Use application composition only where order identity, broker calls or reservation behavior is part of the claim.

### PR 3 — RS-003 and RS-004: mixed SELL planning and profitability

Complete planner-derived additive target, verified/unreserved Spot, shared reservations, TradingRules, exact proceeds and all three profitability gates. Include exact/adjacent boundaries and no-submit assertions. Fix #1809 in its own appropriately scoped production issue/PR; do not hide the defect with a test-only canonical state.

### PR 4 — RS-005 and RS-007: one SELL lifecycle and unknown outcomes

Prove actual broker-call count, original identity retention, no blind retry, durable reservation, lookup reconciliation, partial fill staging, terminal outcomes and no premature release. Use real order submitter/workflow with deterministic broker/store fakes.

### PR 5 — RS-006: multi-fill reconciliation and atomic accounting

Prove multiple canonical fills, REST/stream permutations, duplicate/conflict behavior, incomplete history, exact recovery/legacy split, failure atomicity and the actual application durability barrier.

### PR 6 — RS-008: CG/RS shared account concurrency

Prove shared physical account allocation with independent strategy ownership/budgets across same-market and different-market cases. Exercise real shared allocator/Trading Engine boundaries; do not implement a fake allocator in the scenario framework.

### PR 7 — RS-009 after owner decision

Only after STOP resolution and dust/filter boundary are explicitly settled. Encode the approved decision and test both allowed reconciliation and forbidden trading effects.

### RS-010

Remain UNSUPPORTED/BLOCKED until separate owner-approved product work defines restart/replay and third-asset fee valuation. Do not treat this as a missing test to fill speculatively.

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

**Should the agent fix STOP, enabled-default, dust or third-asset conflicts while writing tests?**

No. Record them and wait for owner-approved decisions. Do not make policy decisions in a test PR.

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
