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

Architecturally, `@coinzilla/brokers` is an **infrastructure adapter package**. The repository may group it under the Brokers ownership domain, but it is not the owner of portfolio, position, strategy, or trading-use-case domain logic.

- `apps/harvester` owns portfolio/position domain models, strategy policy, trading orchestration, and application use cases. Keep those concepts out of broker adapters.
- `broker-websocket/broker.js` is the Binance broker facade and composition root: preserve the public broker contract, coordinate injected clients, and enforce state-changing safety gates.
- `methods/user-data-session.js` owns the stateful user-data subscription/recovery lifecycle and consumer reconciliation acknowledgement.
- `helpers/adapters/` contains focused, deterministic Binance DTO/request/response mappers. Keep pure validation and mapping out of the broker facade when it forms a cohesive responsibility.
- `utils/` owns native transport and RPC/Streams protocol clients; `shared/` owns canonical entity adapters; `test-helpers/` owns deterministic fakes.
- Introduce a port when it creates a real side-effect boundary or allows a coordinator to be tested independently. Do not add a generic wrapper for every RPC method.
- Do not create empty `domain/` or `application/` folders merely to imitate a template. Add them only if the broker package acquires a genuine package-owned domain concept or use case.

Keep order-changing calls gated on user-data readiness/reconciliation and marked `stateChanging: true`. An uncertain timeout/disconnect is an unknown outcome; never blindly replay the operation.

## Workflow

Follow the [mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md) for branch creation, PR targets, synchronization, merge gates, branch cleanup, and releases.

## Required package check

- Run `pnpm --filter @coinzilla/brokers test` (verify the package script exists before relying on it), followed by applicable workspace checks.

## Domain-specific constraints

Keep exchange-specific fields and behavior inside the relevant adapter. Default unit tests must be offline. Network integration tests are separate; any test placing orders must use TESTNET only. Preserve decimal strings at exchange boundaries and never fabricate unavailable broker facts.

## Autonomous DDD refactoring execution rules

These rules are mandatory for every AI agent working on the existing broker package. They clarify how to execute the DDD refactor; they do not authorize replacing working broker behavior.

### Scope and compatibility
- The existing `packages/brokers` implementation works. The task is to refactor its internal architecture toward the documented DDD boundaries, not to rebuild, replace, or redesign working functionality.
- Work strictly inside `packages/brokers/**`, except for repository-required metadata or explicitly coordinated cross-domain work under the repository workflow.
- Preserve public exports, APIs, method signatures, result envelopes, event/callback behavior, exchange integrations, decimal precision, error semantics, and consumer compatibility. Do not change business behavior as an incidental consequence of moving code.
- Use characterization tests before moving/refactoring existing behavior. Follow RED → GREEN → REFACTOR in small increments. Keep tests green after each increment; add regression tests for defects and tests for every intentional behavior change.
- Separate genuine Domain, Application, Ports, and Infrastructure responsibilities where the code has real concepts and boundaries. Do not create empty/template folders or introduce wrappers without a concrete architectural benefit.

### Autonomous PR and merge loop
- **Create as many focused PRs as needed.** Prefer small, reviewable vertical slices over a risky all-at-once rewrite. Every task branch must be short-lived, based on the latest `develop`, and every task PR must target `develop`.
- **Do not pause for routine user approval, ask the user to merge, or wait for the user to tell you to continue.** The responsible agent owns implementation, testing, synchronization, PR creation, CI monitoring, merge, cleanup, and progression to the next task.
- Once a PR is fully validated—its exact head is current with `develop`, all required CI checks are green, the broker package tests and applicable coverage checks pass, the final diff is focused and safe, and the broker's existing behavior/contracts remain intact—**merge it into `develop` without waiting for a human approval**. Never bypass branch protection or merge with pending, failed, missing, or unexpectedly skipped required checks.
- After a successful merge, verify the merge and resulting `develop` state, update the roadmap, delete the merged task branch when safe, then immediately start the next incomplete DDD refactoring slice on a fresh branch from the latest `develop`. Continue this loop until the agreed DDD refactor scope is complete or a concrete external blocker prevents safe progress.
- Multiple commits per branch and multiple PRs across the overall refactor are expected. Commit in coherent increments with meaningful messages. Each PR must be well tested, documented, and independently safe to integrate.
- A green CI run alone is not sufficient if broker behavior or compatibility is broken. Conversely, do not hold a validated task PR open for routine approval when the required gates are green and the broker remains correct.
- If tests, CI, permissions, branch protection, conflicts, or a compatibility risk prevent a safe merge, fix the issue autonomously where possible. If genuinely blocked, report the exact evidence and continue with independent safe work where possible; do not invent a passing result or silently bypass a gate.

### Definition of success for each merged slice
1. Existing behavior is characterized and preserved; public compatibility is checked.
2. Relevant deterministic tests and regression tests pass; package coverage thresholds remain satisfied.
3. Required repository CI checks pass on the exact final PR head.
4. Documentation and this roadmap reflect the actual change.
5. The PR is merged into `develop`, the merge is verified, and the task branch is cleaned up.
6. The next DDD slice starts without requiring another user prompt.

