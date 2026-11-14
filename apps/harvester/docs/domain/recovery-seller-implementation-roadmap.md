---
title: Recovery Seller Implementation Roadmap
status: active
type: implementation-plan
owner: harvester
created: 2026-11-14
---

# Recovery Seller (RS) — Implementation Roadmap

**Status:** Planned; implementation has not started.
**Tracking:** [PR #1110](https://github.com/45s/coinzilla/pull/1110).
**Domain contract:** [Recovery Seller Domain Specification](./recovery-seller-domain-specification.md).
**CG baseline:** [Conservative Domain Specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md).

## Objective and delivery order

Implement RS as an independent strategy policy using verified strategy-neutral domain functions and Harvester's existing execution/accounting infrastructure. Preserve CG behavior throughout.

1. Audit CG source, callers and tests; produce a function-by-function pure-function reuse map.
2. Extract only proven strategy-neutral functions into an appropriate shared domain location.
3. TDD RS domain accounting, custody, attribution and profitability.
4. Implement the remaining pure RS strategy policy.
5. Integrate through existing Trading Engine, Portfolio, broker, order, fill and reconciliation workflows.
6. Prove the full lifecycle with deterministic offline tests and exact-head CI.

## RS-1 — CG source audit and reuse map

**Deliverable:** source-verified inventory and extraction proposal. No code moves in this phase.

Inspect actual Conservative implementation, imports/exports, all callers, tests, configuration and canonical specification. Include policy entry points, calculations, recovery completion, quantity/fee/price helpers, order eligibility, trailing behavior, Portfolio/accounting collaborators and engine orchestration.

For each candidate, record:

| Field | Required evidence |
|---|---|
| Symbol and source path | Exact function and current location |
| Purity | Inputs/outputs; mutation, I/O, clock, randomness or hidden state |
| Ownership | Strategy-neutral, CG-specific, or application/exchange orchestration |
| Consumers | All production callers and relevant tests |
| Contract | Decimal precision, units, rounding, errors, invariants and return shape |
| Decision | Reuse in place, extract, keep in CG, or reject |
| Tests | Existing coverage and missing characterization/regression cases |

A function is reusable only if its business semantics are identical for CG and RS—not merely because it is pure. Keep CG-specific rules such as retained-inventory and recovery-completion policy inside CG unless RS independently requires the exact same contract. Reuse existing @coinzilla/utils, @coinzilla/entities and established Harvester modules where appropriate. Follow Shared Utilities Policy before creating cross-package helpers. Separate confirmed defects from risks and optional cleanup.

**Acceptance:** complete function inventory, dependency/call graph for selected candidates, characterization-test inventory and explicit extraction boundaries. No speculative claim of reuse and no source changes in RS-1.

## RS-2 — Shared pure-function extraction

**Deliverable:** behavior-preserving extraction with CG regression coverage.

For each approved candidate: add/strengthen characterization tests; verify observable outcomes and boundaries; move the smallest cohesive strategy-neutral function; preserve named exports, contracts, precision, rounding and errors; update all consumers; add direct shared tests; retain CG-level regression tests; update documentation in the same commit.

Candidate location, subject to RS-1 evidence:

~~~text
apps/harvester/src/domain/
  shared/
    accounting/
    quantity/
    orders/
    market/
~~~

Do not create empty folders, one-function files, generic frameworks or a parallel shared package. Final structure follows actual cohesive responsibilities and repository ownership rules.

**Acceptance:** direct tests for every extraction; CG characterization/regression suite green; no CG policy or externally observable behavior change; exact-head CI green.

## RS-3 — TDD the RS domain

**Deliverable:** independent deterministic RS domain model and pure calculations, tests first.

Model only the concepts required by the approved RS contract:

- Original legacy quote investment and original base quantity; RS calculates average historical cost as invested / quantity.
- Legacy attribution: original and remaining quantity, remaining basis, confirmed disposals.
- Custody: Spot-available, EARN/off-Spot and unresolved quantities are distinct; transfers do not change historical cost basis.
- Recovery tranche: canonical BUY-fill quantity, cost basis and actual commissions.
- Active/pending/partial/unknown order reservations.
- Independent recovery-tranche and legacy profitability gates. Recovery profit cannot subsidize a legacy loss.
- Cycle progress and residual handling only after the remaining owner decisions are settled.

Agreed illustrative config shape (proposal only, not runtime configuration):

~~~js
sellQuantity: 0.01,
legacyPosition: {
  invested: 100, // original quote amount invested
  quantity: 50, // original base quantity acquired
},
~~~

For 100 USDT and 50 ZRO, RS calculates 2 USDT/ZRO. A 0.01 ZRO legacy slice per cycle means 0.5 ZRO can support 50 cycles if Spot-available; 49.5 ZRO may be held in EARN. EARN inventory is not Spot-sellable until returned and authoritatively reconciled.

Required test families:
- Valid/invalid average-cost inputs, exact decimal precision and division behavior.
- Partial legacy disposal and remaining-basis calculation.
- Spot/EARN custody separation, transfers and insufficient Spot quantity.
- Recovery BUY fills, partial fills, actual commissions and cost basis.
- Profitable recovery tranche paired with a loss-making legacy slice.
- Mixed SELL proceeds/fee allocation after the owner-approved rule exists.
- Reservations, partial SELLs, cancellation races, unknown outcomes and exact-once fill identity.
- Exchange quantity-step/minimum-quantity/minimum-notional and residual boundaries.
- Invalid, contradictory, stale or incomplete evidence fails closed.

Never fabricate BUY fills or seed Portfolio from unverified wallet snapshots.

**Acceptance:** plain-English tests, exact decimal strings, meaningful assertion messages, RED before implementation and GREEN after. Pure domain policy has no Binance SDK, I/O, broker, logger, Telegram, timer or runtime-engine dependency.

## RS-4 — Pure RS strategy policy

**Deliverable:** deterministic policy functions producing explicit decisions/order intents from validated domain facts.

Implement eligible recovery/legacy quantity calculations, approved cost/fee/filter-aware SELL planning, both independent profitability gates, explicit wait/submit/pause/reconciliation outcomes, and attribution across partial fills and repeated cycles.

Do not copy CG trailing BUY, next-BUY cadence, retained-inventory or recovery-completion behavior without an explicit decision that the same contract applies to RS.

**Acceptance:** deterministic tests for success, boundaries, invalid state and safety blocks. Policy does not submit orders.

## RS-5 — Concurrent Trading Engine integration

**Deliverable:** RS lifecycle integrated through existing Harvester application workflows, with CG and RS able to run concurrently.

Reuse the existing Trading Engine, broker port/adapter, canonical order/fill identities, one actual Portfolio Position per market, reservations, reconciliation and safety gates. Keep RS and CG strategy attribution separate from actual Portfolio accounting; all projections must advance consistently for each canonical fill.

**Concurrency is required, not optional:**

- CG and RS may both be enabled and active at the same time.
- They may operate on different markets or on the same market when both pair configurations enable them.
- Do not introduce a global or per-market exclusive strategy lock or require a handoff before RS can run.
- Each strategy owns its own policy state, cycle attribution and submitted order identities.
- The shared Portfolio remains the only actual Position per market. Each canonical fill updates it exactly once and is attributed to the originating strategy.
- The Trading Engine serializes intent allocation, broker submission and fill/accounting commits. Aggregate quote and base reservations across all active strategies before accepting another intent.
- Competing intents must have deterministic allocation/priority behavior. Insufficient shared inventory or quote commitment defers/rejects the relevant intent with its strategy identity preserved.
- One strategy's pause/disable does not implicitly pause/disable the other. Existing orders remain owned by their originating strategy and are reconciled normally.

Preserve manual/external order ownership. EARN/off-Spot quantity is never available for Spot SELL planning. Unknown outcomes retain original order ownership and reservations and require reconciliation; never blindly retry. Add runtime config/registration only after contracts and validation are specified.

**Acceptance:** application tests prove CG and RS run concurrently on different and same markets; fills are applied once to the shared Portfolio and attributed to the correct strategy; shared reservations prevent double-spend/oversell; order lifecycle, pause/disable isolation and broker safety remain correct. No parallel execution engine or strategy-specific broker.
 
## RS-6 — Offline lifecycle verification and delivery

**Deliverable:** deterministic end-to-end RS lifecycle proof and current documentation.

Cover: 50 ZRO / 100 USDT average-cost calculation; 0.5 Spot / 49.5 EARN custody; 0.01 legacy slice; independent profitability gates; partial/terminal fills and commissions; exact-once reservations/accounting; cycle completion after terminal reconciliation; remaining basis/custody across cycles; EARN redemption and authoritative Spot reconciliation; unknown outcomes, restart, external orders, concurrent CG/RS operation on the same and different markets, shared reservations, strategy-specific attribution and exchange constraints.

Update the canonical RS specification, architecture, runtime config docs only when config is approved, tests index, docs index, Harvester roadmap and PR descriptions.

**Acceptance:** focused tests, full Harvester/workspace checks and all required GitHub Actions pass on the exact PR head. No weakened tests or safety gates. No TESTNET/LIVE operation in this roadmap.

## PR sequence

| PR | Scope | Exit gate |
|---|---|---|
| RS-1 | CG source audit and reuse map | Evidence-backed inventory and extraction decisions |
| RS-2 | Shared pure-function extraction | CG behavior preserved and tested |
| RS-3 | RS domain model and TDD | Accounting, custody and profitability invariants proven |
| RS-4 | RS pure policy | Deterministic decisions proven |
| RS-5 | Trading Engine integration | Existing execution and safety infrastructure reused |
| RS-6 | Offline lifecycle and docs | Full lifecycle and exact-head CI green |

Each phase is a focused PR into develop. Every implementation commit includes tests and documentation. A phase is complete only after merge and required exact-head checks pass.

## Saved architecture diagrams

These Mermaid diagrams are version-controlled, editable source. They describe intended architecture, not current runtime implementation.

~~~mermaid
flowchart TB
  subgraph strategies["Independent strategy policies"]
    CG["Conservative (CG)"]
    RS["Recovery Seller (RS)"]
  end
  subgraph shared["Strategy-neutral domain functions"]
    CALC["Decimal / fee / quantity calculations"]
    ORDERS["Order and reservation rules"]
    ACCOUNT["Shared accounting primitives"]
  end
  subgraph app["Existing Harvester application"]
    ENGINE["Trading Engine / use cases"]
    PORTFOLIO["Single actual Portfolio Position"]
    BROKER["Broker port and adapter"]
    RECON["Order, fill and account reconciliation"]
  end
  CG --> shared
  RS --> shared
  ENGINE --> CG
  ENGINE --> RS
  ENGINE --> PORTFOLIO
  ENGINE --> BROKER
  BROKER --> RECON
  RECON --> PORTFOLIO
  RECON --> ACCOUNT
~~~

~~~mermaid
flowchart TD
  A["Legacy basis: original invested quote + quantity"] --> B["RS calculates average historical cost"]
  B --> C["Track logical remaining quantity and basis"]
  C --> D{"Custody?"}
  D -->|"Spot"| E["Check authoritative free balance and reservations"]
  D -->|"EARN / off-Spot"| F["Not Spot-sellable; wait for return and reconciliation"]
  E --> G["Calculate eligible legacy slice"]
  F --> G
  G --> H["Evaluate recovery-tranche profit"]
  H --> I{"Recovery gate passes?"}
  I -->|"No"| X["WAIT / BLOCK"]
  I -->|"Yes"| J["Evaluate legacy profit independently"]
  J --> K{"Legacy gate passes?"}
  K -->|"No"| X
  K -->|"Yes"| L["Shared Trading Engine safety and order gates"]
~~~

The diagrams do not override the [RS Domain Specification](./recovery-seller-domain-specification.md) or resolve its outstanding authorization, accounting, profit allocation, risk, lifecycle and concurrent-resource-allocation decisions.
