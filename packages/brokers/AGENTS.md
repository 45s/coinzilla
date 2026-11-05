# Brokers agent instructions

This directory is owned by the **Brokers domain**. Read the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md` before working here. This file adds local rules; it cannot weaken repository-wide requirements.

## Ownership

Owned path: `packages/brokers/**`

This domain owns: broker base contracts, exchange adapters, exchange API and stream integration, normalization, order/account/market I/O.

Roadmap: [`ROADMAP.md`](./ROADMAP.md).

Do not silently change another domain's implementation, tests, roadmap, or public contract. For cross-domain needs, follow [the cross-domain request process](../../docs/engineering/CROSS_DOMAIN_REQUESTS.md).

## Local engineering rules

- Inspect current public exports, package manifest, consumers, tests, and existing conventions before changing the API.
- Keep the public entry point thin and export only intentional public contracts.
- Prefer cohesive modules, pure functions, explicit side-effect boundaries, and immutable inputs/outputs where practical.
- Add deterministic native Node.js tests for new behavior and regression tests for defects.
- Do not add dependencies without a concrete need; prefer existing dependencies and Node.js built-ins.
- Document public contract changes and consumer migration impact.
- Update this domain's roadmap when work is accepted, blocked, deferred, or merged. Mark work complete only after it is merged into `develop` and required checks pass.

## DDD responsibility boundaries

`@coinzilla/brokers` owns a **broker domain**: the exchange-neutral concepts, invariants, capability contracts, and broker application workflows needed to interact with exchanges. It also owns the infrastructure adapters that implement those contracts. It does not own portfolio/position policy, trading strategy, or bot product decisions.

- **Domain:** own broker-specific, exchange-neutral capability concepts, value objects, invariants, domain errors, and policies. Do not duplicate canonical shared entities or import Binance protocol/transport code.
- **Application:** own broker use cases and orchestration. Coordinate domain behavior through ports; keep socket management, signing, wire formats, and protocol retry mechanics in infrastructure.
- **Ports:** define narrow broker-owned interfaces for exchange operations, streams, user-data sessions, clocks/schedulers, and other external effects where application behavior needs them. Avoid speculative abstractions and one-wrapper-per-RPC interfaces.
- **Infrastructure:** own Binance RPC/Streams clients, transport, signing, configuration, protocol DTOs, and Binance-to-domain/entity mapping. Infrastructure implements the package's ports.
- **Composition/public API:** preserve the public broker contract while wiring application services to Binance adapters. Keep `src/index.js` and exchange entry points thin.
- The existing `broker-websocket/broker.js`, `methods/user-data-session.js`, `helpers/`, `utils/`, and `shared/` are the starting implementation, not immutable architectural boundaries. Move responsibilities incrementally when tests demonstrate a better boundary.
- `apps/harvester` owns portfolio/position policy, strategies, and bot application behavior. That boundary does not make brokers merely an infrastructure-only package.
- Create `domain/`, `application/`, `ports/`, or `infrastructure/` modules only when they contain real responsibilities; do not create empty template folders.

Keep order-changing calls gated on user-data readiness/reconciliation and marked `stateChanging: true`. An uncertain timeout/disconnect is an unknown outcome; never blindly replay the operation.

## Workflow

Follow the [mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md) for branch creation, PR targets, synchronization, merge gates, branch cleanup, and releases.

## Required package check

- Run `pnpm --filter @coinzilla/brokers test` (verify the package script exists before relying on it), followed by applicable workspace checks.

## Domain-specific constraints

Keep exchange-specific fields and behavior inside the relevant adapter. Default unit tests must be offline. Network integration tests are separate; any test placing orders must use TESTNET only. Preserve decimal strings at exchange boundaries and never fabricate unavailable broker facts.

## Autonomous DDD refactoring execution rules

These rules are mandatory for every AI agent working on the existing broker package. They clarify execution; they do not authorize replacing working broker behavior.

### Scope and compatibility
- The existing `packages/brokers` implementation works. Refactor its internal architecture toward the documented DDD boundaries; do not rebuild, replace, or redesign working functionality.
- Work strictly inside `packages/brokers/**`, except for repository-required metadata or explicitly coordinated cross-domain work under the repository workflow.
- Preserve public exports, APIs, method signatures, result envelopes, event/callback behavior, exchange integrations, decimal precision, error semantics, and consumer compatibility. Do not change business behavior as an incidental consequence of moving code.
- Characterize existing behavior before moving/refactoring it. Follow RED → GREEN → REFACTOR in small increments. Keep tests green after each increment; add regression tests for defects and tests for every intentional behavior change.
- Separate genuine Domain, Application, Ports, and Infrastructure responsibilities where the code has real concepts and boundaries. Do not create empty/template folders or wrappers without a concrete architectural benefit.

### Autonomous PR and merge loop
- **Create as many focused PRs as needed.** Prefer small, reviewable vertical slices over a risky all-at-once rewrite. Every task branch must be short-lived, based on the latest `develop`, and every task PR must target `develop`.
- **Do not pause for routine user approval, ask the user to merge, or wait for the user to tell you to continue.** The responsible agent owns implementation, testing, synchronization, PR creation, CI monitoring, merge, cleanup, and progression to the next task.
- Once a PR is fully validated—its exact head is current with `develop`, all required CI checks are green, broker package tests and applicable coverage checks pass, the final diff is focused and safe, and existing broker behavior/contracts remain intact—**merge it into `develop` without waiting for human approval**. Never bypass branch protection or merge with pending, failed, missing, or unexpectedly skipped required checks.
- After a successful merge, verify the merge and resulting `develop` state, update the roadmap, delete the merged task branch when safe, then immediately start the next incomplete DDD refactoring slice on a fresh branch from the latest `develop`. Continue until the agreed DDD refactor scope is complete or a concrete external blocker prevents safe progress.
- Multiple commits per branch and multiple PRs across the overall refactor are expected. Commit in coherent increments with meaningful messages. Each PR must be well tested, documented, and independently safe to integrate.
- A green CI run alone is not sufficient if broker behavior or compatibility is broken. Do not hold a validated task PR open for routine approval when required gates are green and the broker remains correct.
- If tests, CI, permissions, branch protection, conflicts, or a compatibility risk prevent a safe merge, fix the issue autonomously where possible. If genuinely blocked, report the exact evidence and continue with independent safe work where possible; never invent a passing result or silently bypass a gate.

### Definition of success for each merged slice
1. Existing behavior is characterized and preserved; public compatibility is checked.
2. Relevant deterministic tests and regression tests pass; package coverage thresholds remain satisfied.
3. Required repository CI checks pass on the exact final PR head.
4. Documentation and this roadmap reflect the actual change.
5. The PR is merged into `develop`, the merge is verified, and the task branch is cleaned up.
6. The next DDD slice starts without requiring another user prompt.
