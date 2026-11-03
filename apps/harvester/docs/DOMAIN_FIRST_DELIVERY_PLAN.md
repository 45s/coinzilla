# Harvester Domain-First Delivery Plan

**Status:** Active direction — 2026-11-03  
**Applies to:** `apps/harvester`  
**Reference implementation:** `apps/bot-free-roll`  
**Paused integration work:** PR #479  
**Merged baseline:** PR #477

## 1. Decision

Harvester work is now **domain-first**.

We will not continue expanding the engine, application orchestration, broker adapter, or TESTNET workflow until the Conservative trading domain has been specified, implemented as broker-independent policy/accounting, independently tested, and documented.

This changes the order of delivery. It does not discard the existing Harvester infrastructure or the work preserved in PR #479.

The goal is to make the business rules correct and demonstrably complete before wiring them into a live event/order lifecycle.

## 2. Source of truth and boundaries

- Treat the working `apps/bot-free-roll` implementation and its documented Conservative/Free-Roll behavior as the behavioral reference.
- Inspect actual source and tests; do not infer behavior from README prose alone.
- Harvester owns its domain model and business policy. Shared Entities/Brokers packages provide contracts/adapters, not strategy decisions.
- Domain policy must not import or depend on Binance, broker SDKs, WebSockets, application services, timers, or runtime infrastructure.
- PR #477 is the merged baseline for order ownership, broker event correlation, serialized processing, and fill-driven application accounting. Preserve it; do not reimplement it.
- PR #479 is paused reference material. Reuse its useful guard/tests/docs only after checking them against the approved domain rules.

## 3. Delivery phases

### D0 — Discover and specify the Conservative domain

**Deliverable:** an agreed, testable domain specification based on Free-Roll behavior.

Inspect and map:
- Pair/strategy configuration and validation rules.
- Initial BUY eligibility and investment limits.
- BUY intent, order quantity, precision/step constraints that belong to domain policy versus exchange adaptation.
- Fill identity, partial fills, duplicate fills, and conflicting fills.
- Portfolio versus RecoveryLedger responsibilities.
- Recovery SELL quantity, retained `keepQuantity`, and inventory constraints.
- Quote principal, gross proceeds, actual commissions, net proceeds, minimum profit, and recovery completion.
- Conditions for allowing the next BUY.
- Invalid, incomplete, failed, and out-of-order transitions.
- Which facts are domain-owned versus supplied by the application/broker boundary.

Produce:
1. A domain glossary and responsibility map.
2. A lifecycle/state-transition specification.
3. Accounting invariants and worked examples, including partial/duplicate fills and commission cases.
4. An explicit list of unresolved business decisions. Do not silently choose financial rules.

No Harvester engine, broker adapter, Binance, WebSocket, TESTNET, or integration changes in this phase.

**Exit gate:** every strategy decision and accounting transition required by the Conservative cycle has an explicit rule and deterministic examples. Unknowns are resolved with the user before implementation.

### D1 — Implement the pure domain

Implement only the domain contracts/entities/policies needed by the approved specification.

Expected responsibilities may include:
- Portfolio position and fill application.
- Recovery ledger/cycle accounting.
- Fill identity and idempotency rules.
- Conservative strategy decision/evaluation.
- Recovery SELL planning and eligibility.
- Recovery completion validation and cycle reset eligibility.

Keep the design minimal. Do not create a class/module for every noun or event. Do not move broker/application responsibilities into the domain.

Engineering rules:
- Every function accepts one object argument and returns one object/result.
- Use `@coinzilla/utils` `toResult` for result-returning functions.
- Prefer pure functions and immutable/explicit inputs where practical.
- Use exact decimal-safe arithmetic and existing shared utilities; do not use floating-point arithmetic for financial calculations.
- Keep public module APIs explicit through `index.js`; avoid circular dependencies.
- No new dependencies without a demonstrated requirement.
- Invalid external data must be rejected at the appropriate boundary; domain functions should receive validated domain-shaped values.

**Exit gate:** domain behavior is executable without starting Harvester, connecting a broker, or constructing application services.

### D2 — Prove the domain with tests and coverage

Tests must be derived from the specification, not written merely to mirror implementation branches.

Required areas:
- Initial BUY allowed/blocked conditions.
- Investment and quantity boundaries.
- BUY fill, partial fill, multiple fills, duplicate fill, conflicting fill identity.
- Recovery SELL planning and retained quantity.
- Partial SELL and repeated SELL fills.
- Gross versus net proceeds and commissions in supported fee scenarios.
- Minimum-profit boundary and rounding behavior.
- Recovery completion success and every failure/ineligible case.
- Ledger reset exactly once and only after successful completion.
- Next BUY remains blocked while any recovery obligation remains.
- Invalid values, zero/negative quantities, precision boundaries, and overflow/rounding edges as applicable.
- Property/invariant tests for conservation/accounting identities where useful.

Coverage:
- Add meaningful coverage thresholds for the domain modules, not a vanity whole-app percentage.
- Ensure all domain tests run in normal CI.
- Do not count mocked engine callbacks as proof of domain accounting.
- Do not use TESTNET as a substitute for deterministic domain tests.

**Exit gate:** all specified transitions and financial invariants have direct tests; CI passes; uncovered lines/branches are reviewed and justified.

### D3 — Document and freeze the domain contract

Update the domain docs with:
- Glossary and ownership.
- State-transition/lifecycle diagram.
- Accounting formulas and worked examples.
- Failure semantics and idempotency rules.
- Public domain API and dependency rules.
- Test matrix and actual coverage/CI evidence.
- Explicit exclusions and unresolved future decisions.

Conduct a domain review against the Free-Roll reference and the specification. Resolve discrepancies before integration.

**Exit gate:** domain specification, implementation, tests, and docs agree. The domain contract is approved/frozen for the first integration pass.

### I1 — Integrate the proven domain into Harvester

Only after D0–D3 pass:
- Wire domain decisions into existing application workflows/engine.
- Keep orchestration, event sequencing, broker I/O, and exchange normalization outside domain policy.
- Reuse PR #477's merged ownership and serialization behavior.
- Reuse PR #479 only where it matches the frozen domain contract.
- Add focused application/engine contract tests around domain calls and actual event ordering.
- Avoid broad rewrites and new infrastructure.

### I2 — TESTNET acceptance

Only after the domain and integration gates pass:
- Run a bounded single-pair TESTNET cycle.
- Verify BUY acknowledgement/fill, recovery SELL acknowledgement/fill, actual commissions/net proceeds, successful completion, ledger reset, and next BUY eligibility.
- Record evidence from the operator's real process and exchange history.
- Never claim acceptance from mocks, unit tests, connectivity, or order submission alone.
- Do not use automatic cancel-all/market-sell cleanup or adopt external orders.

## 4. PR and branch policy

- Keep PR #479 open as Draft and paused. Do not merge it or continue implementation there during D0–D3.
- Do not close/delete its branch: it contains useful recovery-first logic, regression tests, and documentation to reassess after the domain contract is frozen.
- The domain specification and pure-domain implementation should be developed in a new, focused branch/PR based on the current `develop` branch.
- Keep the domain-first PR free of engine, bootstrap, broker, adapter, WebSocket, and TESTNET changes.
- Prefer one coherent PR per phase/gate rather than mixing unfinished domain work with integration.
- Before merging any PR, update its branch with the latest target branch and rerun required CI on the final head.
- PR #477 stays merged and is the infrastructure baseline.

## 5. Explicitly out of scope until domain approval

- Further Harvester engine refactoring.
- Binance/broker adapter changes unless a domain-independent contract defect blocks domain testing.
- TESTNET trading attempts as a substitute for domain verification.
- Durable persistence, restart recovery, broad reconciliation, cross-pair allocation, generic state machines, dashboards, Aggressive strategy, or new infrastructure.
- Speculative abstractions or behavior not demonstrated by Free-Roll or explicitly approved in the domain specification.

## 6. Definition of done for the domain-first task

The domain phase is complete only when:
- [ ] Free-Roll behavior has been inspected directly in source and tests.
- [ ] Conservative business rules and accounting formulas are documented.
- [ ] All unresolved financial/business decisions are explicitly resolved.
- [ ] Pure domain implementation has no broker/application/runtime dependency.
- [ ] Domain tests cover normal, boundary, duplicate, partial, conflicting, and failure paths.
- [ ] Financial invariants and decimal/rounding behavior are tested.
- [ ] Domain coverage gate passes in CI.
- [ ] Docs, tests, and implementation describe the same behavior.
- [ ] Review confirms the domain can be exercised independently of Harvester runtime.
- [ ] No TESTNET or engine integration work was smuggled into the domain PR.

Only then start I1.
