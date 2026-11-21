---
title: Harvester strategy onboarding standard
status: draft
type: engineering-guide
owner: harvester
created: 2026-11-22
---

# Harvester strategy onboarding standard

This checklist is the implementation-oriented entry point for adding or materially changing a Harvester trading strategy. It standardizes integration and safety expectations without forcing strategies to share policy, state, accounting semantics, or lifecycle.

It is a checklist, not a universal strategy interface. Follow the current source and canonical domain specifications; prove a common contract before extracting one.

## 1. Scope and architecture

- [ ] Define the strategy's intended markets, trading mode, operator controls, and explicit non-goals.
- [ ] Identify the owning domain specification and roadmap; link them instead of duplicating rules.
- [ ] Describe the policy (what to do), application workflow (how to coordinate), and infrastructure (external operations) separately.
- [ ] Identify strategy-specific lifecycle/state/accounting responsibilities. Do not force them into CG or RS assumptions.
- [ ] Trace actual composition through bootstrap and the shared account-level engine/coordinator.
- [ ] Reuse existing capabilities only where contract and semantics match. No speculative base class, generic engine, plugin loader, registry, or DI framework.
- [ ] Document the concrete reason for any new abstraction, module, or dependency.

## 2. Identity, assignment, and configuration

- [ ] Add or reuse a stable strategy ID; verify compatibility with persisted facts, logs, orders, events, and attribution.
- [ ] Define strategy assignment and market/pair identity; verify routing preserves the full ownership key (including provider/account where applicable).
- [ ] Put operator-owned settings in the canonical application configuration composition.
- [ ] Define configuration shape, defaults, constraints, environment compatibility, and validation at the owning boundary.
- [ ] Inject validated configuration into domain/application components; no domain file reads environment or configuration files.
- [ ] Define disabled-by-default behavior where the strategy has not completed its operational acceptance gate.
- [ ] Ensure invalid or missing configuration fails closed; no accidental fallback to another strategy.

## 3. Domain policy and state

- [ ] Specify decision inputs, outputs, and invariants in the strategy's canonical domain specification.
- [ ] Keep financial decisions deterministic and broker-independent where practical.
- [ ] Define state ownership, state transitions, cycle boundaries, and terminal conditions.
- [ ] Define quantity, price, precision, fees/commissions, profitability, inventory, and dust semantics with exact-decimal examples.
- [ ] Define actual-fill accounting and attribution; distinguish requested quantities from executed facts.
- [ ] Define behavior for partial fills, duplicates, out-of-order events, and conflicting/unknown facts.
- [ ] Do not alter another strategy's domain policy to make the new strategy fit.

## 4. Application workflow and shared account safeguards

- [ ] Compose policy and strategy-specific lifecycle/workflow through existing application boundaries.
- [ ] Route decisions through the shared execution and authorization pipeline; strategy code must not call exchange/broker adapters directly.
- [ ] Preserve strategy ownership for positions, budget, order intents, and attribution while respecting shared account custody.
- [ ] Verify account-wide quote/base reservations prevent double-spending and double-selling across strategies.
- [ ] Verify order ownership, correlation, canonical order/fill identity, and exactly-once accounting.
- [ ] Define pause, stop, disable, cancellation, replacement, reconciliation, and shutdown behavior.
- [ ] Unknown or ambiguous external outcomes retain ownership/reservations and fail closed until reconciled; no blind retry or speculative replacement.
- [ ] Confirm one strategy's controls/failures do not unintentionally mutate or stop another strategy.
- [ ] Do not introduce external network/exchange mutations during ordinary development or tests.

## 5. Tests — required before implementation (TDD)

- [ ] Write deterministic offline tests first and observe expected RED for the missing behavior.
- [ ] Unit-test policy normal cases, boundaries, invalid inputs, and decision invariants.
- [ ] Unit-test state/lifecycle transitions, terminal states, duplicates, and invalid/out-of-order events.
- [ ] Test configuration validation, defaults, disabled state, invalid strategy selection, and no fallback.
- [ ] Test composition/routing and ownership across strategy ID, market, and provider/account identity.
- [ ] Test shared authorization/reservation constraints, including competing strategies and insufficient resources.
- [ ] Test exact-fill accounting, fees, partial fills, duplicate fills, terminal reconciliation, and unknown outcomes as applicable.
- [ ] Test pause/stop/disable, recovery/reconciliation, shutdown, and failure cleanup.
- [ ] Add a focused integration test for production composition using offline fake external boundaries.
- [ ] Preserve neighboring strategy regression tests and critical behavior inventory/coverage ownership.
- [ ] Every assertion includes a descriptive failure message; tests do not rely on live credentials or exchange state.
- [ ] Verify RED → GREEN → REFACTOR evidence; do not claim it without execution.

## 6. Bootstrap and integration

- [ ] Register configuration and composition at the owning application/bootstrap boundary.
- [ ] Keep bootstrap responsible for wiring, not domain rules.
- [ ] Verify startup validation and readiness gates before any strategy can submit.
- [ ] Verify subscription deduplication does not discard strategy routing/ownership.
- [ ] Verify shutdown ordering and resource cleanup.
- [ ] Update tests and required reliability inventory/checks if a critical behavior or module is added.

## 7. Documentation and delivery

- [ ] Update the canonical strategy specification with rules, invariants, examples, and failure behavior.
- [ ] Update the domain roadmap with phases, acceptance criteria, blockers, and issue/PR links.
- [ ] Update configuration documentation and examples.
- [ ] Update architecture/index documents only when ownership, composition, or navigation changes.
- [ ] Include a source-backed architecture diagram when it clarifies non-trivial workflow or failure paths.
- [ ] Record behavior and compatibility impact, test commands/results, and exact CI evidence in the PR.
- [ ] Keep changes focused; target `develop`; leave PR open for owner review.

## 8. Completion gate

A strategy is not considered integrated merely because its policy tests pass. Review must confirm:

- [ ] Its configuration and identity are validated and routed correctly.
- [ ] Its workflow participates in shared account coordination and safeguards.
- [ ] Strategy-specific accounting and lifecycle remain explicit and correct.
- [ ] Cross-strategy ownership, reservations, attribution, and isolation are proven.
- [ ] Failure/unknown outcomes are safe and recoverable.
- [ ] Required deterministic tests and CI checks pass.
- [ ] Documentation and operational acceptance criteria are complete.
- [ ] Any enablement gate is explicitly satisfied; otherwise the strategy remains disabled.
