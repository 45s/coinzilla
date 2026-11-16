---
title: Harvester application workflow composition and pipeline migration
status: draft
type: plan
owner: harvester
created: 2026-11-15
---

# Harvester application workflow composition and pipeline migration

## Status and authority

This is a **proposed, incremental implementation plan**, not an accepted runtime contract and not authorization to change trading behavior. The existing [Harvester architecture](../architecture.md), [Conservative Domain Specification](../domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md), [Trading First](../TRADING_FIRST.md), repository engineering standards and current source/tests remain authoritative.

The goal is to improve cohesion and readability in application workflows while preserving DDD dependency direction and the existing trading lifecycle. Start with one narrow workflow and evaluate the result before generalizing anything.

## Implementation checkpoints

### Step 0 — source map completed on 2026-11-16

Reviewed against `develop` at `5a5cfb8a779d4809663c022b8870863be50d56a5`, after merged [PR #1159](https://github.com/45s/coinzilla/pull/1159).

The current market-price path is:

1. Bootstrap injects the caller-supplied market-data freshness policy and composes `makeConservativeTradingEngine`.
2. The public `processMarketPrice` operation refreshes volatility protection before entering the engine transition queue.
3. The existing serialized queue invokes `createMarketPriceTransitionHandler`; this internal handler does not enqueue another transition.
4. The handler validates the normalized immutable `MarketPrice`, checks subscription-symbol identity, allocates the diagnostic event ID, reads the previous accepted price and market metadata, and logs the received event with the current portfolio, recovery ledger, order and readiness context.
5. The handler checks freshness. A stale event is logged and returns the existing successful `STALE_MARKET_PRICE` skip without changing the accepted event ID or cached price.
6. A fresh event commits `marketPriceEventIds` and `prices`, then delegates either to `maybeReplaceTrailingBuy` or `evaluateLatestTransition` according to the existing readiness, pause, active-BUY and trailing settings.
7. The evaluator and trailing replacement workflow retain their existing responsibilities. Submission/cancellation durability, broker I/O, fill reconciliation and Portfolio/RecoveryLedger accounting remain downstream and outside this handler.

The market-price handler itself publishes no lifecycle event, performs no broker I/O, and adds no durability wait. The public engine queue, volatility refresh order, state ownership and downstream safety gates remain unchanged.

### Step 1 — explicit market-price stages

- [x] Add direct offline characterization tests for receipt/freshness ordering, stale-cache preservation, accepted-price commit before dispatch, existing trailing-BUY eligibility gates, malformed-price rejection, and symbol-mismatch failure.
- [x] Refactor only the handler's local orchestration into three explicit named stages: prepare/log, freshness acceptance/state commit, and accepted-price dispatch.
- [x] Re-run the direct handler tests and existing Conservative engine tests after the extraction on the implementation head.
- [x] Reconcile the architecture guide with the source-backed stage sequence.

Test-first evidence on commit `da359a83fabf6eeb80b577073cd60ba9abdff96a`:

- Harvester unit suite: 1,658 passed, 0 failed (including all eight new direct handler characterization cases).
- Harvester coverage: 80.73% lines, 81.65% branches, 82.02% functions.
- Configured Harvester targeted regressions: 5/5 files passed.
- Utils Unit Tests, Dependency Audit, and External Documentation Links passed.
- Full workspace unit tests, workspace coverage and JavaScript Syntax were still running at this checkpoint; their final results are not inferred here.
- The first changed-file ESLint run identified five `prefer-template` errors and one helper-length warning in the new test fixture. The next test-only correction splits fixture setup into focused helpers and uses template literals; no lint rules or assertions are suppressed.
- The direct handler suite was extended with a malformed positive-decimal validation case; it proves invalid domain input is rejected before event-ID allocation, receipt logging or dispatch.


Implementation verification on commit \`271d5fdcfca7e4be94a6da2a343d548bd030a80b\`:

- Harvester unit suite: 1,659 passed, 0 failed; the nine direct handler characterization cases are included.
- Harvester coverage: 80.76% lines, 81.65% branches, 82.04% functions.
- Workspace unit-test matrix: all 10 package jobs passed.
- Workspace coverage matrix: all 10 package jobs and the aggregate coverage gate passed.
- Harvester targeted regressions: all five configured files passed. The direct market-price handler test is added to the targeted list in this commit so the next exact-head run exercises it directly.
- JavaScript Syntax (including changed-file ESLint, Markdown style and agent-policy checks), actionlint, Utils Unit Tests, Dependency Audit and External Documentation Links passed.
- The optional read-only TESTNET integration job was skipped by its workflow condition. No exchange operation was performed.

The extraction adds no new runtime state, dependency, queue, broker call, event publication, persistence operation or domain rule. It does not change Conservative behavior or the status of the wider migration plan.

## Goals

- Split large application workflows by meaningful responsibility.
- Extract deterministic business rules, calculations, predicates and transformations into focused pure functions.
- Keep side effects behind injected application ports and focused use cases.
- Reuse genuinely shared application capabilities across strategies without coupling their decision policies.
- Make workflow ordering and early/terminal outcomes easy to read and test.
- Prepare the codebase for multiple independently composed strategies without implementing concurrent strategy execution as part of this first migration.

## Non-goals

- Do not introduce a generic middleware framework, plugin registry, dependency container, event bus, or new architectural layer merely to implement a pipeline pattern.
- Do not rewrite the Trading Engine, replace its state model, or move its state into a pipeline context.
- Do not change Conservative strategy rules, order decisions, order sequencing, exchange requests, fill accounting, recovery behavior, readiness gates, or configuration.
- Do not activate Aggressive or another strategy, add multi-strategy runtime configuration, or claim same-symbol concurrent execution is safe.
- Do not move Harvester business rules into `@coinzilla/utils` or another shared package simply because more than one strategy may use them.
- Do not extract trivial expressions into one-function files or create a rigid folder template.

## Architectural decision guidance

### DDD boundary

A pipeline is an **application-layer composition technique**, not a domain model and not a new DDD layer.

- **Domain:** owns business concepts, invariants, calculations, validation rules and strategy policies. Deterministic logic should be plain pure functions where practical. Domain modules must not import application use cases, broker adapters, exchange SDKs, infrastructure, clocks, environment variables or mutable runtime state.
- **Application/use cases:** coordinate a business workflow, load facts through injected ports, call domain policies, apply decisions and coordinate side effects. A local pipeline may make this sequence easier to understand, but its stages remain application orchestration.
- **Infrastructure:** implements broker, persistence and other external ports and translates external protocols.
- **Bootstrap:** composes dependencies, application services, strategy policies and process lifecycle.

Do not move a function to `domain/` just because it is pure. Its responsibility must be a domain rule. Pure application mapping or workflow preparation may remain in a cohesive application module.

### Pipeline versus middleware

Use the smallest construct that clarifies the real workflow:

1. Prefer ordinary named function calls for a short, stable sequence.
2. Use a small, explicit local sequence of named stages when ordering, short-circuiting, or stage-level testing is genuinely clearer.
3. Introduce a reusable pipeline composer only after at least two real workflows demonstrate the same orchestration contract and the abstraction removes meaningful duplication.
4. Do not use Express-style request/response middleware, implicit `next()` chains, mutable ambient context, hidden stage registration, or generic catch-all middleware as the default.

Stages must have explicit inputs and outputs. A stage must either produce the next well-defined context or an explicit terminal result. Errors and intentional skips must not be confused with successful continuation. Avoid a framework whose abstraction is harder to understand than the workflow it represents.

### Shared functionality and multiple strategies

Share **capabilities**, not strategy decisions.

- Keep Conservative and future strategy policies independently named and independently testable.
- Extract a capability to a shared application module only when its responsibility and contract are genuinely common (for example, loading normalized market context or applying a common submission safety gate).
- Keep exchange-neutral generic helpers in `@coinzilla/utils` only when they meet the repository shared-utility policy. Keep trading rules in Harvester.
- Keep strategy-specific thresholds, order planning, decision policy and strategy lifecycle isolated.
- Shared execution, order ownership, broker interaction, fill accounting and safety invariants remain centrally owned. Strategies must not create competing order registries, accounting projections, or broker submission paths.
- Multiple strategies running at once is a future capability. Before enabling it, explicitly design strategy identity/ownership, market overlap arbitration, shared balance/commitment allocation, order attribution, fairness/priority, failure isolation and serialized execution boundaries. Do not infer that independent policy functions alone make concurrent execution safe.

## Current implementation constraints to preserve

The existing Conservative Trading Engine is stateful application orchestration. It owns an in-process transition queue and coordinates mutable order/market state, strategy evaluation, order submission/cancellation, canonical order reconciliation, fill identity and accounting callbacks.

Any extraction must preserve at least these invariants:

- Public state-changing engine entry points continue to use the existing serialized transition boundary. An extracted internal stage must not enqueue itself again while the caller already holds the transition.
- Preserve the current transition ordering and the exact boundary at which each event is accepted, state is mutated, and broker I/O occurs.
- Preserve durable submission/cancellation intent barriers before the corresponding broker side effect, plus existing outcome recording.
- Preserve PENDING/acknowledgement/UNKNOWN semantics and cancellation eligibility.
- Preserve canonical order and Fill identity validation, duplicate handling, complete fill-history reconciliation and exact-once Portfolio/RecoveryLedger accounting.
- Preserve fail-closed pauses, failure classification, readiness and shutdown behavior.
- Do not move mutable engine state into a generic pipeline context or make a pure domain function responsible for coordinating state mutation.
- Do not add timers, retries, polling, network calls or persistence as part of the refactor.

The accepted Conservative rules are defined only in the [Conservative Domain Specification](../domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). The [Accounting Invariants matrix](../domain/ACCOUNTING_INVARIANTS.md) is evidence of tests, not an alternate rule source.

## Incremental migration

### Step 0 — source and test map (required before code)

On the implementation branch, re-read all applicable repository and Harvester instructions and documentation in full. Inspect the current engine, bootstrap composition, all callers/consumers, adjacent use cases, domain policies, broker ports, tests and configuration. Build a source-backed call graph for the selected workflow and identify every state mutation, await, event publication, broker call, durable barrier, failure result and serialization boundary.

Do not assume that an earlier conversation, this plan, or an old code excerpt describes the current implementation. Resolve any mismatch against current source, tests and canonical docs.

### Step 1 — one narrow market-price workflow

Use the existing market-price processing path as the first candidate because it is a bounded, frequently exercised workflow. Confirm its actual current responsibilities and extraction seams before choosing the exact functions.

The initial change should:

- Keep the public engine API and its current serialized transition wrapper intact.
- Extract only meaningful, cohesive logic whose contracts can be made explicit.
- Prefer pure domain functions for deterministic business rules; leave state reads/writes, ports, logging and broker operations in the application layer.
- Keep the stage order explicit and local to the market-price use case.
- Use a pipeline composer only if the extracted stages reveal a real repeated composition need. A list of functions alone is not a sufficient reason to add a framework.
- Preserve every existing observable result, event, log contract where relied upon, state transition, side effect and safety gate.

Do not combine fill processing, cancellation/replacement, recovery, shutdown or bootstrap lifecycle refactors into this first slice.

### Step 2 — verify the abstraction before reuse

After Step 1, assess whether the result is easier to understand and test than the original.

Only extract shared application capabilities when a second real consumer exists or is part of an approved, concrete follow-up. Compare contracts and side effects before sharing; do not generalize from names or superficial similarity.

### Step 3 — future strategy composition

When a second strategy is actually introduced, compose its policy independently and reuse only the proven shared capabilities. Before enabling simultaneous execution, complete the explicit concurrency/ownership design described above and add deterministic tests for overlapping markets, shared assets, event ordering, order attribution, and failure isolation.

## Required implementation workflow and acceptance criteria

The implementation agent must:

1. Complete the mandatory repository and Harvester documentation preflight independently, including linked requirements recursively. Provide a concise readiness summary before editing.
2. Identify the owning domain and current roadmap/task status. Do not change roadmap status to Done until the work is merged and required validation passes.
3. Write focused behavior-preserving regression tests first where the refactor risks observable behavior; run them and confirm the expected baseline. Follow RED → GREEN → REFACTOR for any behavior change. A pure mechanical extraction may use characterization tests that prove the existing contract.
4. Compare before/after behavior across existing market-price, stale-price, paused/readiness, trailing BUY, volatility protection, submission and serialization tests as applicable to the discovered call graph.
5. Keep tests deterministic, offline and credential-free. Do not run TESTNET or LIVE operations.
6. Run focused Harvester tests and coverage, then the required workspace/CI checks. Inspect results on the exact final PR head SHA.
7. Update every affected living document in the same implementation PR and include a Documentation impact section.
8. Open a focused PR to `develop`; synchronize with the latest `develop` and satisfy all required checks before merge. Do not merge a stale PR or bypass branch protection.

The migration is successful only if the selected workflow becomes easier to follow, meaningful pure logic has clear ownership, the application/domain/infrastructure dependency direction remains intact, and all existing externally observable behavior and safety invariants remain unchanged.

## Autonomous implementation prompt

The following prompt is intended to be given to a coding agent with repository access. It authorizes the agent to investigate and implement the first narrow slice, but not to expand scope or change trading behavior.

> You are the autonomous implementation agent for the Harvester application-workflow decomposition described in this document. Your task is to implement **Step 0 and Step 1 only**. Do not stop after writing a plan: complete the authorized implementation, tests, documentation, branch, and draft/ready PR workflow using the repository's available GitHub tools.
>
> **Mandatory preflight — hard gate:** Start from the repository root `AGENTS.md`. Read it, `AI_AGENT_WORKFLOW.md`, `ENGINEERING_STANDARDS.md`, `docs/DOCUMENTATION_GOVERNANCE.md`, `docs/MARKDOWN_STYLE.md`, the applicable task checklist, `docs/engineering/DOMAIN_OWNERSHIP.md`, `docs/engineering/MODULARITY_STANDARD.md`, `docs/engineering/SHARED_UTILITIES_POLICY.md`, `docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md`, `apps/harvester/AGENTS.md`, `apps/harvester/ROADMAP.md`, `apps/harvester/docs/README.md`, `apps/harvester/docs/architecture/README.md`, `apps/harvester/docs/architecture.md`, `apps/harvester/docs/TRADING_FIRST.md`, the Conservative Domain Specification, Accounting Invariants, relevant ADRs, broker port/API contracts, operational and TESTNET runbooks, configuration documentation, and relevant test guidance. Follow applicable references recursively. Read each applicable document in full; do not rely on this plan, chat history, summaries or old snippets. If a required document is missing, inaccessible, contradictory or unclear, stop and report the exact blocker.
>
> Inspect the current `develop` branch before starting. Build a current source-backed map of the market-price workflow: public entry points, callers, consumers, transition queue, state reads/writes, domain policy calls, broker and other port calls, event publication, durable barriers, result/error handling, tests and configuration. Inspect adjacent code enough to prove that the proposed extraction does not cross lifecycle or ownership boundaries. Do not assume the current source matches a previous conversation or the illustrative names in this plan.
>
> **Readiness report before edits:** state the exact base branch/SHA, documents reviewed, owning domain, current workflow call graph, proposed smallest extraction, current observable contracts and safety invariants, test files to change, commands/checks to run, documentation impact, and any blockers. Do not create a branch, edit files, or otherwise mutate repository state until this report is complete.
>
> **Scope:** implement only the first market-price workflow slice. Keep the public engine API, serialized transition boundary and state ownership intact. Extract meaningful deterministic domain rules into cohesive pure functions with explicit inputs/outputs. Keep application coordination, mutable state access, logging, event publication, broker calls and durable barriers in the application layer. Use named functions and direct composition by default. Add a local explicit stage sequence only if it clarifies the real workflow. Do not add a reusable pipeline/middleware framework unless the source proves at least two actual consumers need the same composition contract and the abstraction is materially simpler; if that condition is not met, do not add one.
>
> **Strict prohibitions:** do not change Conservative business rules, strategy decisions, order sizing/pricing, event contracts, submission/cancellation order, fill/accounting behavior, recovery, readiness, config, bootstrap lifecycle or exchange adapters. Do not refactor fill processing, cancellation/replacement, recovery, shutdown or unrelated files. Do not activate another strategy or claim concurrent strategy execution is supported. Do not add dependencies, a new generic utility, timers, polling, retries, network calls, persistence, or a new domain layer. Do not weaken/delete tests or assertions. Do not run TESTNET/LIVE or perform exchange reads/writes.
>
> **TDD and implementation:** first add or strengthen deterministic characterization/regression tests for the current observable behavior and run them. Confirm failures are genuine and attributable to the intended behavior when adding a behavior test. Refactor in small steps; after each extraction run the focused tests. Keep every assertion descriptive with a useful failure message. Use existing project conventions, named ESM exports, object-shaped inputs, accurate selective JSDoc, and existing result/error contracts. Search the shared utility package and local code before introducing any helper; keep Harvester business policy in Harvester.
>
> **Safety invariants to prove unchanged:** (1) all state-changing market-price work remains inside the existing serialized transition boundary; extracted internal functions do not re-enter/enqueue that boundary; (2) state mutation and event acceptance order remain unchanged; (3) freshness, readiness, pause, volatility and trailing-BUY gates remain unchanged; (4) order PENDING/acknowledgement/UNKNOWN and cancellation eligibility semantics remain unchanged; (5) durable submission/cancellation barriers still precede broker side effects; (6) canonical order/fill correlation, complete reconciliation and exact-once accounting remain unchanged; (7) existing fail-closed errors, pauses, diagnostics and shutdown behavior remain intact.
>
> **Verification:** run the focused market-price and affected engine tests first, then the Harvester test and coverage commands documented in the current README/package scripts. Run repository documentation/agent-policy checks for documentation changes and all required GitHub Actions checks. Keep all default tests offline and credential-free. Never claim a check passed unless it actually passed on the exact final PR head SHA. If a required test cannot run or fails, diagnose and fix it without weakening the test; if the blocker is outside scope or cannot be resolved safely, stop and report it.
>
> **Documentation:** update the architecture guide and any other living docs whose claims are affected by the actual extraction. Keep this plan's status and implementation details accurate; update indexes when adding/moving docs. Include a PR `Documentation impact` section listing exact paths. Do not rewrite historical audits/evidence.
>
> **Git workflow:** after the preflight, create a short-lived task branch from the latest `develop`, never `main`. Follow the exact branch naming and freshness rules in `AI_AGENT_WORKFLOW.md`. Commit the implementation, tests and documentation together. Open a focused PR targeting `develop` with a detailed description of scope, before/after responsibilities, DDD boundary, invariants preserved, tests/checks, documentation impact and known limitations. Inspect the exact PR head and GitHub Actions. Synchronize with latest `develop` and re-run affected checks when required. Do not merge unless all required checks pass and repository policy permits the responsible agent to merge. Never bypass branch protection.
>
> **Completion report:** provide the PR link, exact head SHA, files changed, extracted responsibilities and their layer ownership, tests/checks with exact results, any remaining limitations, and explicit confirmation that no TESTNET/LIVE activity occurred. Do not claim multi-strategy concurrency is implemented.

## Review questions

- Does the proposed split reduce cognitive load, or merely increase file count?
- Does every extracted module have one cohesive reason to change?
- Are pure functions truly deterministic and independent of runtime state?
- Are domain rules still in the domain and application workflows still in the application layer?
- Is any shared capability genuinely common, or is it prematurely coupling strategies?
- Does the existing serialized engine remain the sole owner of mutable order/accounting transitions?
- Are durable barriers and failure semantics preserved exactly?
- Is the pipeline abstraction smaller and clearer than ordinary function composition?
- Is the first PR limited to one workflow with no unrelated lifecycle refactoring?
