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


