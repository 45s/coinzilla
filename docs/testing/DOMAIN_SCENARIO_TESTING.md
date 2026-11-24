---
title: Domain Scenario Testing Methodology
status: active
type: testing
owner: repository engineering
created: 2026-11-23
---

# Domain Scenario Testing Methodology

## Purpose and authority

Domain Scenario Testing is a strategy-neutral technique for proving that real domain components cooperate to produce an approved business outcome across a realistic input or event sequence.

It complements focused unit tests. It does not replace application integration, contract, acceptance, or historical-replay tests, and it does not define product behavior.

Use the [Repository Test Scenario Catalog](SCENARIO_CATALOG.md) as the single human-readable entry point to important repository behaviors, concrete examples, implementation paths, named test cases, and evidence status.

The authority boundary is:

- The owning domain specification and accepted decisions define expected business behavior.
- Scenario matrices and tracking issues define the strategy/domain-specific coverage plan and current gaps.
- Production source defines what the application currently implements.
- Executable tests provide behavioral evidence for only the assertions they actually make.
- This guide defines the shared test-design method; it must not introduce strategy-specific rules.

When a specification, decision, implementation, or existing test appears inconsistent, record the discrepancy and resolve it with the owning domain. Do not silently choose the easiest interpretation or copy an existing test's assumptions.

## What a domain scenario test proves

A domain scenario test composes multiple real domain components around one readable business behavior. It starts from explicit canonical state, applies one or more meaningful events or decisions, and asserts the resulting observable domain state and safety disposition.

A scenario is not:

- A list of test filenames with inferred coverage.
- A unit test for one helper or calculation.
- An assertion that a function was called without proving its business result.
- A mock implementation of the domain algorithm being tested.
- A historical replay unless it uses a recorded/reconstructed event sequence for that purpose.
- A substitute for testing application orchestration, durable barriers, broker I/O, or external contracts at their owning layer.

Keep a focused unit test close to the calculation, validator, predicate, or state transition. Add a scenario when correctness depends on how multiple real domain components cooperate.

## Test layers and ownership boundaries

| Test layer | Primary question | Typical scope |
| --- | --- | --- |
| Unit | Is one calculation, predicate, validator, or transition correct in isolation? | Decimal calculation, fee allocation, state guard, fill fingerprint |
| Domain scenario | Do real domain components cooperate to produce the approved business outcome? | Canonical fill → Portfolio/Position/ledger → policy evaluation → exact decision |
| Application integration | Does application orchestration preserve ordering, ownership, barriers, and lifecycle behavior? | Use-case/engine event flow, submit/cancel race, reconciliation, durable write barrier |
| Contract | Does an adapter or implementation honor a shared public port/schema contract? | Broker adapter conformance, event DTO/schema compatibility |
| Acceptance | Is a defined requirement satisfied at its selected system boundary? | Offline acceptance across domain/application layers; external acceptance requires separate authorization |
| Historical replay | Can a recorded or carefully reconstructed event sequence reproduce an observed behavior? | Historical fills, fees, lifecycle events, shutdown/reconciliation evidence |

Name the layer honestly. A pure domain test with no application orchestration is not an application integration test. A deterministic fixture built from a historical example is not automatically a historical replay.

## Discover behaviors and build a scenario matrix

Start from the approved domain contract, not from existing test filenames.

1. Identify the business capability and the invariant that must remain true.
2. Define the normal successful behavior in plain language.
3. Identify the initial state, relevant configuration, identities, and authoritative inputs.
4. Write the exact event or command sequence, including ordering where it affects the contract.
5. Derive expected outputs independently from the specification and worked examples.
6. List forbidden side effects and state changes.
7. Add the meaningful boundaries, invalid inputs, conflicts, duplicates, reordered events, races, failures, and recovery cases.
8. Mark unresolved or explicitly unsupported behavior instead of inventing expected semantics.
9. Assign a stable scenario ID and map it to the owning specification, implementation, test file, named test case, issue, and evidence status.

A useful scenario record contains:

- Stable scenario ID, domain, and feature.
- Human-readable business behavior.
- Preconditions and initial state.
- Concrete input, command, event, or ordered sequence.
- Expected observable outputs and state transitions.
- Forbidden behavior and negative assertions.
- Boundary conditions and meaningful subcases.
- Relevant production implementation paths.
- Exact automated test path and named test case(s).
- Coverage/evidence status and exact verification commit.
- Owning specification, decision, and tracking issue.

Do not create a Cartesian product of every configuration dimension. Group equivalent cases where the same invariant and failure mode are genuinely shared, but keep distinct financial, identity, ordering, and safety invariants independently asserted.

## Given / When / Then and readable naming

Organize each scenario around three questions:

- **Given:** What authoritative state and preconditions exist before the behavior?
- **When:** Which command, event, decision, or sequence is applied through the real domain components?
- **Then:** What exact business result, state change, emitted intent, or safety disposition must be observable?

Name tests after the business result, not the helper or source file under test.

Prefer:

```js
test("a duplicate canonical fill does not change the accepted position", () => {
  // Given: the original fill is already part of the accepted domain state.
  // When: the same canonical fill is applied again.
  // Then: quantity, cost, fee history, and accepted identity remain unchanged.
})
```

The example is illustrative. Use the repository's actual test framework, canonical factories, public domain APIs, and established naming conventions.

A scenario may contain several assertions, but each assertion should explain the business invariant it protects. Split unrelated behaviors into separate named cases rather than building one opaque lifecycle mega-test.

## State-machine and lifecycle proof

State-machine scenarios prove more than a status string. They prove that only contract-approved transitions occur and that accounting, identity, reservations, emitted effects, and safety disposition remain consistent across the sequence.

For each transition, define:

| Transition evidence | Required proof |
| --- | --- |
| From / event / to | Exact source state, event identity/type, and resulting state |
| Preconditions | Required canonical facts, configuration, ownership, and terminal evidence |
| State mutation | Every relevant changed field in the owning projections |
| Accounting delta | Exact quantity, cost/proceeds, commission amount/asset, and realized result |
| Emitted effects | Exact intent/disposition, or proof that no intent/effect occurs |
| Idempotency | Reapplying the same event does not double-apply accounting or release/consume resources twice |
| Conflict behavior | Same identity with changed payload, wrong market/order/side, stale evidence, or conflicting terminal facts is rejected |
| Failure atomicity | Failed transition leaves authoritative projections unchanged and creates no partial side effect |
| Recovery | Exact evidence required to resume; no blind retry or implicit reset/clear |

Cover legal transitions and relevant forbidden transitions. Include duplicates, conflicting identities, out-of-order evidence, partial completion, unknown outcomes, repeated evaluation, and failed commits wherever the owning contract makes them meaningful.

Do not infer a transition from a conceptual diagram or another strategy's lifecycle. If behavior is unresolved, contradictory, deferred, or unsupported, mark it BLOCKED or UNSUPPORTED and state the missing decision/evidence.

## Independent accounting and financial test oracles

Financial expectations must be derived independently from the production algorithm.

- Use exact decimal strings and the repository's approved decimal utilities. Do not use binary floating-point arithmetic for financial values.
- Distinguish requested order quantity, accepted order quantity, gross executed quantity, net acquired/disposed quantity, quote notional, and actual confirmed fills.
- State asset identity explicitly: base, quote, third-asset commission, account, market, strategy, Position, order, and fill identity as applicable.
- Distinguish configured fee rates or reserves from actual commission amount and commission asset reported for a fill.
- Use actual net proceeds/cost facts for realized accounting; do not substitute intended price, configured quantity, or estimated fees for confirmed execution facts.
- Derive expected values from the contract or a worked business example, not by copying the production calculation into the test.
- Assert exact quantities, prices, costs, proceeds, commission allocations, balances, reservations, and realized outcomes where they affect the invariant.
- Assert conservation and projection consistency after meaningful events, not only at the end of a long sequence.
- Include negative assertions for forbidden inventory adoption, duplicate submission, incorrect release, partial commit, or state advancement where relevant.

A test that passes because it repeats the same incorrect formula as production is not an independent oracle. Prefer hand-derived examples with small, explicit numbers and state the arithmetic in the scenario comments or test documentation when that helps review.

## Real components, fixtures, and external boundaries

Compose real domain entities and components for the behavior being proved.

- Do not mock the domain calculation, accounting projection, state machine, or policy under test.
- Use canonical production factories and value objects where available.
- Mock or fake external ports only at the application integration boundary whose orchestration is under test.
- Keep fixtures deterministic, offline, credential-free, and independent of live or TESTNET exchange operations.
- A fixture builder may remove repetitive setup, but callers must be able to see and override financially relevant inputs, identities, market metadata, filters, fees, initial state, and active commitments.
- Avoid opaque defaults for values that affect the result. Make quantity, price, side, asset, commission, order type, filter, and lifecycle evidence explicit.
- Do not build a parallel domain model or duplicate production algorithms inside test helpers.
- Keep test helpers small and cohesive. Prefer a named market/Fill/order fixture over a generic scenario framework that hides the behavior.
- Preserve immutable input snapshots and assert they remain unchanged when immutability is part of the contract.

At the application boundary, use controlled broker/database/event dependencies to prove ordering, idempotency, failure handling, and durability. Never contact a live exchange or perform a real trade from a domain scenario test.

## Scenario quality and adversarial coverage

For each behavior family, consider the applicable categories below. These are prompts for domain-specific design, not a universal requirement that every scenario implement every category.

- Normal success and repeated valid events.
- Exact threshold equality, just-below, and just-above boundaries.
- Empty, zero, minimum, maximum, and constrained quantities.
- Invalid or incomplete input and missing authoritative evidence.
- Duplicate events and same-identity/different-payload conflicts.
- Out-of-order, stale, delayed, or reordered events.
- Partial fills, terminal states, and fill-history gaps.
- Concurrent commitments, races, and repeated evaluation.
- Failure atomicity across multiple projections or persistence boundaries.
- Unknown submission/cancellation outcomes and no-blind-retry behavior.
- Fail-closed STOP/blocked dispositions and continued reconciliation where specified.
- Explicitly deferred or unsupported behavior.

Use equivalence classes to avoid redundant tests, but do not merge distinct failure modes merely to reduce test count. A negative assertion is required whenever an otherwise passing scenario could still produce a dangerous or misleading side effect.

## Evidence, status, and verification

The [Repository Test Scenario Catalog](SCENARIO_CATALOG.md) is the cross-workspace navigation and evidence index. The owning domain issue remains the detailed scenario matrix and live completion tracker.

Use the catalog's status vocabulary consistently:

| Status | Meaning |
| --- | --- |
| `SPECIFIED` | Intended behavior is documented, but no accepted test mapping is recorded. |
| `TEST-MAPPED` | Candidate test path/case is linked; assertion review is incomplete. This is not verified coverage. |
| `VERIFIED` | Assertions were reviewed against the contract and the exact named tests passed on the recorded commit. |
| `PARTIAL` | Some subcases are proved; the missing assertions/subcases are listed explicitly. |
| `MISSING` | No adequate scenario test proves the behavior. |
| `BLOCKED` | A contract decision, authoritative evidence source, or prerequisite is missing. |
| `UNSUPPORTED` | The behavior is explicitly outside current supported functionality. |

Only mark a scenario VERIFIED when all of the following are recorded:

- The exact test file and named test case(s).
- The assertions were reviewed against the owning specification and independently derived expected results.
- The exact test command and outcome.
- The exact 40-character commit SHA on which those tests passed.
- Any skipped tests and the reason.
- The relevant exact-head CI result when the PR is the verification boundary.

A scenario with only some subcases proved remains PARTIAL. Do not promote a candidate mapping to VERIFIED because the file exists, a test count increased, a coverage percentage improved, or an unrelated test suite passed. Never claim a test ran unless a command or CI job actually reports its result.

For behavior changes, follow the repository's test-first RED → GREEN → REFACTOR workflow. For a scenario addition where production behavior is already implemented, a passing first run is acceptable after reviewing the assertions for independence and meaningful coverage; do not invent a production change or deliberately weaken an expected result just to manufacture a RED failure.

## Adoption by a new strategy or domain

A new strategy adopts this methodology by:

1. Linking this guide from its owning roadmap, domain documentation index, and scenario tracking issue.
2. Identifying its own canonical behavior specification and accepted decisions.
3. Creating a strategy-owned scenario matrix with stable IDs, risk priorities, explicit inputs/outputs, forbidden behavior, and unresolved/unsupported dispositions.
4. Writing tests with the real components and lifecycle semantics of that strategy.
5. Mapping exact test paths/case names and verification evidence in the shared catalog.
6. Updating its own issue and roadmap without copying the generic method into a strategy-specific guide.

The shared guide does not prescribe common trading rules, common states, identical fixtures, or identical lifecycle transitions. A new strategy must not need to edit this document merely because it was added or because its business rules changed.

## Illustrative examples from different domains

These examples show how the method can be applied. They are not universal trading rules; the owning domain specification remains authoritative.

**Conservative example:** a canonical BUY fill is applied through the real Portfolio and RecoveryLedger, then the real Conservative policy is evaluated. The scenario asserts exact position/accounting changes, expected standing BUY and recovery SELL intents, and forbidden duplicate or unsafe intents. Conservative-specific behavior is owned by its own specification and issue.

**Recovery Seller example:** a recovery allocation costs 10 USDT and receives 10.15 USDT net proceeds; a legacy allocation has 0.20 USDT historical cost and receives 0.19 USDT net proceeds. Recovery profit is 0.15 USDT, legacy loses 0.01 USDT, and combined profit is 0.14 USDT. The independent legacy gate fails despite positive recovery and combined results. This illustrates independent financial oracles; it does not define a rule for other strategies.

## Definition of done

A domain-scenario initiative is complete only when:

- Its matrix is reconciled against the current owning specification, accepted decisions, implementation, and relevant tests at other layers.
- Every applicable high-risk behavior and meaningful subcase is mapped to reviewed executable evidence or an explicit BLOCKED/UNSUPPORTED disposition.
- Tests use real domain components, independent expected results, deterministic fixtures, and relevant negative assertions.
- Application-level ordering, persistence, broker, and external-port behavior is tested at the correct owning layer.
- Weak, misleading, or unverified mappings are not presented as behavioral proof.
- The catalog, owning issue, domain documentation index, and roadmap agree on status and remaining gaps.
- Exact-head commands, CI outcomes, skipped tests, and commit SHA are recorded.
- No exchange operation, live mutation, or unsupported behavior is implied by the test initiative.

Coverage percentages and test counts may help identify gaps, but they do not prove behavioral completeness.
