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

The strategy config currently sets `enabled: true` at the audited checkpoint. The RS specification's section 15 contains a conflicting disabled-by-default statement. Do not create a default assertion or change config until the owner resolves that discrepancy. Per-pair environment eligibility remains a separate control.

**Volatility is market-owned, not RS-owned.** The effective protection market set is derived from the union of enabled strategy market configurations, not from a CG or RS execution route. A configured market with market-level enablement and `enableVolatilityProtection: true` receives volatility history/state/protection even when it has no CG route. When the same market is configured in CG and RS, both explicit protection values must agree; startup rejects conflicting values. Do not make volatility calculation, candle history or protection depend on RS strategy activation. RS scenarios may prove that the real market-level protection gate is respected, but volatility calculations and market-state transitions belong to their strategy-neutral market tests. See [Harvester Volatility Protection](../volatility-protection.md) and [#1016](https://github.com/45s/coinzilla/issues/1016).

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

For exchange rules, use the real TradingRules contract and test tick size, step size, minimum/maximum price, minimum/maximum quantity and minimum/maximum notional as applicable. Assert exact rounded quantity/price and net proceeds, not only whether a plan exists.

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

1. Valid initial BUY from an empty recovery allocation.
2. BUY suppression for invalid authorization, legacy basis, market readiness, account snapshot, budget or safety evidence.
3. Exact BUY intent identity, market, side, type, price, quantity and quote commitment.
4. Full and partial confirmed fills.
5. Multiple fills at equal and different prices; exact accumulated cost, net base and execution VWAP.
6. Base-asset fee reduces net acquired base.
7. Quote-asset fee increases quote cost.
8. Zero and multiple supported commission records.
9. Third-asset fee only with approved valuation; otherwise fail closed.
10. Duplicate identical Fill is idempotent.
11. Same Fill identity with changed quantity, price, market, order or commission is rejected atomically.
12. Wrong strategy/Position/order/market/side attribution is rejected.
13. Overfill, impossible quantity, invalid precision and unsupported commission bounds fail safely.
14. Fill-before-ack, ack-before-fill and terminal acknowledgement ordering.
15. Unknown BUY submission prevents blind duplicate BUY and retains identity/commitment for reconciliation.
16. Active/partial/unknown BUY gates the next BUY as specified.
17. Investment cap below/equal/above boundary, including outstanding quote commitments.
18. RS budget cannot borrow unused CG/other-strategy budget.

Core source ownership: accounting workflow, Portfolio/Position, canonical Fill identity, BUY evaluator, action authorizer, order submitter.

Required assertions: actual net base, quote cost, VWAP, applied Fill identities, pending commitment, ownership, exact broker-call count and no duplicate action.

### RS-003 — Additive mixed SELL planning and allocation (P0)

**Business question:** is the SELL target derived from actual net recovery inventory plus only eligible legacy quantity, with exact ownership and no over-allocation?

Required cases:

1. Recovery net base + configured legacy slice.
2. Legacy remainder smaller than configured slice.
3. Legacy exhausted; recovery-only cycle.
4. Verified Spot below, equal to and above the required legacy slice.
5. Account-wide existing SELL reservations and shared base commitments.
6. Cross-market reservations and same-market CG/RS reservations.
7. Exact recovery/legacy allocation split and conservation.
8. Real TradingRules filters, including quantity/notional and tick/step boundaries.
9. Missing custody, invalid precision, invalid filter metadata and allocation ambiguity fail closed.
10. No broker submission for any blocked/below-target plan.
11. Base/quote/mixed commission allocation after actual canonical fills.
12. Planner's complete workflow input must be accepted by the real SELL evaluator.

Core source ownership: `calculate-sell-plan.js`, `evaluate-sell-decision.js`, `legacy-spot-allocation.js`, accounting workflow, shared allocator/TradingRules.

**Known blocker:** #1809 records the real accounting-workflow transition snapshot emitting an accumulating cycle state that the default SELL evaluator rejects. An isolated planner scenario using the canonical cycle-state factory does not prove this workflow-to-evaluator path. Keep that subcase explicitly blocked until #1809 is fixed and tested through real composition.

### RS-004 — Independent profitability and fee-aware SELL economics (P0)

**Business question:** do recovery, legacy and combined profitability independently satisfy their own requirements?

Required cases:

1. Recovery exactly at minimum profit.
2. Recovery just below/above threshold.
3. Legacy break-even, below break-even and above break-even where applicable.
4. Combined gate independently enforced.
5. Recovery profit cannot subsidize legacy loss.
6. Legacy profit cannot subsidize recovery loss.
7. All gates passing yields the exact eligible decision.
8. Recovery-only operation still enforces recovery and combined gates.
9. Actual net proceeds and actual fee assets, not gross order notional.
10. Mixed SELL target is the max of independent net proceeds requirements with correct fee gross-up.
11. Maker/taker fee reserves and approved order-type selection.
12. Exact price/quantity rounding preserves net proceeds.
13. No intent/submission if any gate or required metadata fails.
14. Post-fill actual adverse profitability commits confirmed facts and follows approved STOP behavior; no invented follow-up action.

Core source ownership: `calculate-profitability.js`, `calculate-sell-plan.js`, `evaluate-sell-decision.js`, application transition evaluator and accounting workflow.

### RS-005 — One SELL lifecycle per cycle (P0)

**Business question:** can one cycle ever create more than one SELL lifecycle or release its reservation too early?

Required cases:

1. First SELL identity is recorded before the approved broker-I/O boundary.
2. Repeated evaluation while active creates no second broker call.
3. Reservation creation follows the approved durable submission boundary.
4. Unknown outcome retains original identity and reservation.
5. Partial SELL fills are staged until complete terminal reconciliation.
6. Complete terminal fill history is reconciled before commit.
7. Reservation releases only after successful required accounting commit.
8. CANCELED/REJECTED/EXPIRED including partial execution leaves the cycle unresolved under the current contract.
9. Unknown, incomplete, conflicting or duplicate terminal facts cannot close twice or release twice.
10. New cycle only after approved closure.
11. Legacy exhaustion permits recovery-only behavior only as explicitly specified.

Core source ownership: cycle state, lifecycle decision, accounting workflow, order submitter, order callbacks, reservation and terminal reconciliation.

### RS-006 — Exact-once mixed SELL accounting and atomicity (P0)

**Business question:** do recovery and legacy projections consume the same canonical execution evidence and commit together?

Required cases:

1. One canonical SELL Fill split between recovery and legacy.
2. Multiple partial SELL fills.
3. Allocation sum equals canonical Fill quantity under approved fee treatment.
4. Recovery and legacy projections derive from identical accepted Fill facts.
5. Successful commit updates both.
6. Failure in either projection leaves both unchanged.
7. Identical terminal replay is an exact no-op.
8. Same identity with changed facts is rejected.
9. Duplicate Fill through REST and stream in both orders.
10. Conflicting REST/stream facts are rejected atomically.
11. Incomplete fill history cannot commit a terminal allocation.
12. Durable barrier and reservation retention/release are verified at application layer.
13. Confirmed fills are accounted even if post-fill profitability fails.

Core source ownership: mixed SELL allocation/accounting/reconciliation, Portfolio, accounting workflow, record-reconciled use case, persistence boundary.

### RS-007 — Unknown outcomes and no blind retry (P0)

**Business question:** when broker outcome is unknown, does RS preserve original identity/commitment and reconcile without resubmitting?

Required cases:

1. Timeout before broker acceptance.
2. Timeout after broker acceptance but before response.
3. Unknown response retains client order identity.
4. Repeated unknown event is idempotent.
5. Lookup finds active order.
6. Lookup finds terminal order and complete history.
7. Lookup says not found.
8. Lookup itself fails or returns incomplete history.
9. Original reservation remains held until authoritative resolution.
10. No second broker submission under any unknown path.
11. Existing order reconciliation and confirmed fills continue under STOP.

Core source ownership: order submitter, lifecycle decision, order callbacks, accounting workflow, order registry and persistence.

### RS-008 — CG/RS shared account resources and concurrency (P0)

**Business question:** can CG and RS run independently while never spending/selling the same physical account inventory twice?

Required cases:

1. Same market, concurrent CG and RS BUY accounting.
2. Different markets, concurrent BUY accounting.
3. Same market, competing SELL base reservations.
4. Different markets sharing quote/base asset constraints.
5. Snapshot locks already reflected are not deducted twice.
6. New commitments after snapshot are deducted exactly once.
7. Strategy-owned Position attribution remains distinct in one shared Portfolio.
8. RS budget cannot borrow CG budget and vice versa.
9. Concurrent evaluations serialize or reject conflicting allocation without double-submit.
10. Failure during one strategy's accounting does not partially mutate the other strategy's Position.

Core source ownership: shared Portfolio, account snapshot/commitment allocator, Trading Engine serialization, RS/CG ownership and action authorization.

### RS-009 — STOP, failure atomicity and continued reconciliation (P0; BLOCKED)

**Business question:** does unexpected evidence block new trading while preserving order/fill facts and required reconciliation?

Potential cases after owner resolution:

1. STOP is sticky across later market updates and unrelated operator commands.
2. No new BUY/SELL/replacement/retry while STOP is active.
3. Existing active order may be WAITed/reconciled under the contract.
4. Confirmed canonical fills continue to be accounted exactly once.
5. Missing/malformed/conflicting/unmodeled evidence fails closed.
6. Persistence/commit failure preserves projections and reservations as specified.
7. Exchange filter violation behavior follows the exact approved filter-vs-dust boundary.
8. Operator visibility and permitted actions match the approved STOP contract.
9. No implicit reset or self-resume.

**Do not implement this family as if its contract were settled.** The specification says terminal STOP/no reset, while current source contains `resolveRecoverySellerStopState` and `resolveRecoverySellerStop`; the operator facade exposes read-only status. Record and wait for owner resolution. The existence of a source helper is not approval to expose it.

### RS-010 — Explicitly deferred capabilities (P2; UNSUPPORTED/BLOCKED)

This family is a disposition register, not permission to invent functionality.

- Full process restart/replay restoration is unsupported/deferred.
- Third-asset fee quote valuation has no approved authoritative execution-time source.
- Missing or ambiguous third-asset valuation must fail closed.
- No scenario may claim successful RS restart recovery or fabricate a third-asset conversion rate.
- A future owner-approved issue must define the contract, source of truth, replay semantics and acceptance criteria before implementation scenarios are added.

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

For every injected failure, assert the entire relevant before/after state: Portfolio/Positions, applied Fill IDs, legacy state, OrderRegistry, cycle state, order identity, reservation, STOP, persistence log and broker call log.

## 13. Contract blockers: exact current treatment

These blockers must appear in the registry, #1780, the repository catalog where relevant, and the Harvester roadmap summary. Do not resolve them in scenario code.

### 13.1 STOP resolution discrepancy — RS-009 BLOCKED

- Specification and #1780 describe terminal STOP with no clear/reset/resume path.
- Source currently exports `resolveRecoverySellerStopState` from `stop-decision.js`.
- `resolve-recovery-seller-stop.js` implements an evidence-backed durable resolution flow.
- The operator facade is documented/tested as read-only for STOP status.
- This is a real contract/source discrepancy, not proof of a public operator reset.
- Owner must decide whether the internal resolution path is obsolete/forbidden or whether the contract must explicitly permit a controlled resolution path.
- Until decided, do not write positive or negative assertions that assume one interpretation. RS-009 stays BLOCKED.

### 13.2 Strategy enabled default discrepancy

- At the audited develop checkpoint, `apps/harvester/config/strategies/rs-recovery-seller.js` sets `enabled: true`.
- The RS specification's section 15 contains a disabled-by-default statement.
- Other specification/roadmap language says enabled by default.
- Do not silently change config or assert a default in scenarios until the owner resolves the canonical statement.
- Keep global strategy activation distinct from per-pair `enabled` and `tradingEnvironment`.

### 13.3 Third-asset commission valuation — RS-010 BLOCKED

- Fee arithmetic examples exist.
- The authoritative runtime quote-value source is unresolved.
- `thirdAssetFeeQuoteValue` is not part of the validated operator config contract.
- Missing/ambiguous valuation must fail closed; it is not zero.
- Do not add a fabricated conversion rate, ticker lookup, config property or test default.

### 13.4 Dust versus exchange-filter STOP — affected RS-003/009 cases BLOCKED

- The contract includes global STOP for exchange-filter violations.
- It also discusses retained residual dust when fully reconciled quantity/notional filters make a remainder unsellable.
- Do not assume every filter violation is dust.
- Do not assume every residual must trigger STOP.
- The separate final-residual/no-new-BUY liquidation policy is unresolved. The approved smaller-remainder rule permits a smaller authorized legacy remainder as part of the current cycle SELL when Spot-available/unreserved and all gates/filters pass; it does not authorize a standalone SELL of a residual after the cycle without a new BUY.
- The exact applicability boundary requires an owner-approved decision before encoding ambiguous cases.

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
- Keep branch based on latest develop and target develop.
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

### Step 1 — Preflight and current-state audit

1. Read root and Harvester AGENTS files.
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
5. Assert complete relevant state and forbidden side effects.
6. Run the narrowest targeted test.
7. Fix a genuine defect only within an explicitly scoped production issue/PR; do not weaken the test.
8. Run relevant broader tests and repository checks as appropriate.

### Step 5 — Record evidence and synchronize

1. Update registry and traceability.
2. Update #1780 with exact scenario ID, case title, status, missing subcases and evidence.
3. Update catalog RS entry if its human-readable status or mapping changed.
4. Update Harvester roadmap phase/next action.
5. Update domain inventory only if its supplemental source/test mapping changed.
6. Update or link a production issue when a real implementation defect was exposed.
7. Commit and push; synchronize branch with latest develop.
8. Verify exact PR head and GitHub Actions results.
9. Keep PR open for owner review and merge.
10. After merge, record merged SHA and re-check issue/docs freshness.

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
