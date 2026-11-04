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


