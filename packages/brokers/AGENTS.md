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
- The existing `broker-websocket/broker.js`, `src/application/user-data-session.js`, `src/application/ports/user-data-client-port.js`, `helpers/`, `utils/`, and `shared/` are the evolving implementation. `src/application/user-data-session.js` owns the exchange-neutral user-data lifecycle; `src/application/ports/user-data-client-port.js` owns its injected client contract; `src/infrastructure/binance/user-data-client-adapter.js` implements that contract. Move remaining infrastructure responsibilities incrementally when tests demonstrate a better boundary.
- `apps/harvester` owns portfolio/position policy, strategies, and bot application behavior. That boundary does not make brokers merely an infrastructure-only package.
- Create `domain/`, `application/`, `application/ports/`, or `infrastructure/` modules only when they contain real responsibilities; do not create empty template folders or a separate top-level `ports/` directory.

Keep order-changing calls gated on user-data readiness/reconciliation and marked `stateChanging: true`. An uncertain timeout/disconnect is an unknown outcome; never blindly replay the operation.

## Workflow

Follow the [mandatory AI-agent workflow](../../AI_AGENT_WORKFLOW.md) for branch creation, PR targets, synchronization, merge gates, branch cleanup, and releases.

## Required package check

- Run `pnpm --filter @coinzilla/brokers test` and `pnpm --filter @coinzilla/brokers test:coverage` (verify both scripts exist before relying on them), followed by applicable workspace checks. The coverage command enforces 90% line, 80% branch, and 80% function coverage.

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

## Bitunix Spot development — mandatory reference audit

**Before implementing or changing any Bitunix Spot capability, first inspect how the same capability is implemented in the reference projects below.** This applies to every task, including WebSocket connections/subscriptions, REST transport and signing, market data, account/balance reads, order placement/cancellation, order status, execution history, reconciliation, reconnect behavior, and error handling. Do not begin by inventing an implementation from memory or by reading only the official endpoint page.

### Required reference projects

1. **Primary behavioral reference.** [JKorf/Bitunix.Net](https://github.com/JKorf/Bitunix.Net) is a substantial C# Bitunix client built on CryptoExchange.Net with separate Spot and Futures REST/Socket surfaces. Study its relevant Spot interfaces, implementation, request definitions, models, endpoint fixtures, and unit tests. Especially useful locations:
   - [Spot REST trading implementation](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Clients/SpotApi/Rest/BitunixRestClientSpotApiTrading.cs)
   - [Spot REST trading contract/interface](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Interfaces/Clients/SpotApi/IBitunixRestClientSpotApiTrading.cs)
   - [Spot account implementation](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Clients/SpotApi/Rest/BitunixRestClientSpotApiAccount.cs)
   - [Spot Socket implementation](https://github.com/JKorf/Bitunix.Net/tree/main/Bitunix.Net/Clients/SpotApi/Socket)
   - [Spot endpoint request fixtures and tests](https://github.com/JKorf/Bitunix.Net/tree/main/Bitunix.Net.UnitTests/Endpoints/Spot)
   - [Spot capability tests](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net.UnitTests/BitunixRestClientTests.cs)

   Treat this project as the first implementation to study and the primary behavioral reference when translating an existing Spot capability into JavaScript. Inspect the actual implementation and tests/fixtures, not only XML comments or generated documentation.

2. **Secondary JavaScript/TypeScript reference.** [samanzamani/bitunix-mcp](https://github.com/samanzamani/bitunix-mcp) is an unofficial TypeScript MCP server covering Bitunix Spot and Futures REST. Use it to cross-check JavaScript/TypeScript request construction, authentication/signing, validation, response handling, and available Spot endpoint examples:
   - [Spot tools](https://github.com/samanzamani/bitunix-mcp/blob/main/src/tools/spot.ts)
   - [REST client and signing implementation](https://github.com/samanzamani/bitunix-mcp/tree/main/src)
   - [Tests](https://github.com/samanzamani/bitunix-mcp/tree/main/src)
   - [README and supported capability list](https://github.com/samanzamani/bitunix-mcp#readme)

   This is an MCP integration, not a broker SDK. Do not assume it implements a complete broker lifecycle or continuous Spot private WebSocket subscriptions.

3. **Protocol authority — [Bitunix official Open API repository](https://github.com/BitunixOfficial/open-api) and [official Spot API documentation](https://www.bitunix.com/api-docs/spots/en_us/).** Third-party implementations are evidence and implementation examples, not the final authority for current wire contracts. Verify endpoint paths, authentication, parameters, quantity units, response shapes, error codes, pagination, timestamps, and WebSocket message semantics against official documentation and current official examples wherever available.

### Additional reference discovery when primary sources are incomplete

The primary pair above is not an exclusive search boundary. When JKorf or the TypeScript MCP does not cover the requested method, or when their source/tests conflict with each other or official docs, search GitHub for the exact endpoint path, method name, and Bitunix Spot capability. Inspect additional language clients and connector packages before concluding that no reference exists.

Known supplementary references from the maintained [Bitunix external implementation audit](./BITUNIX_REFERENCE_AUDIT.md) include:

- [StockSharp/Connectors](https://github.com/StockSharp/Connectors/tree/master/Bitunix) — independent C# Spot connector and DTOs.
- [0xCherryBlueZu/bitunix](https://github.com/0xCherryBlueZu/bitunix) — Python Spot REST client; inspect signing/logging defects before reuse.
- [LuiInventions/Bitunix-MCP](https://github.com/LuiInventions/Bitunix-MCP) — Python MCP/application workflows; not a precision-safe broker reference.
- [Steven-Chang/bitunix-api](https://github.com/Steven-Chang/bitunix-api) — Ruby Spot public metadata methods.
- [mydcc/cachy-app](https://github.com/mydcc/cachy-app/tree/main/docs/bitunix-api) — detailed Futures documentation audit only; it explicitly does not mirror Spot.
- [BitunixOfficial/open-api](https://github.com/BitunixOfficial/open-api) and [vgeyer/bitunix-client](https://github.com/vgeyer/bitunix-client) — inspect product scope carefully; the inspected demos/examples are Futures-oriented, not Spot proof.

For each additional repository, record the exact inspected commit/path and whether endpoint-level tests or fixtures exist. Label source evidence, fixtures, observed live behavior and official documentation separately. A package README or exposed method list is only discovery evidence. If a reference is Futures-only, unrelated, untested or defective, record that limitation and continue searching where the gap matters. Never add any of these packages as a Coinzilla runtime dependency.

### Required workflow for each Bitunix feature

1. Identify the exact capability being requested and the owning Coinzilla contract/port, current Bitunix adapter, consumers, tests, configuration, and relevant issue/roadmap item.
2. Inspect the matching Spot implementation in **JKorf/Bitunix.Net first**. Follow the call path from public interface through request construction, signing/transport, response model/adapter, and tests/fixtures. For a WebSocket task, inspect the Spot Socket code and its capability tests; do not substitute Futures behavior.
3. Inspect the corresponding TypeScript implementation in **bitunix-mcp** where one exists. Compare its signing, request/response handling, validation, and tests with the .NET implementation.
4. Verify the behavior against the official Bitunix Spot documentation and official repository. Record the relevant source paths, endpoint names, request/response examples, and any differences found.
5. Build a small comparison/audit before coding: reference behavior, official documented behavior, Coinzilla contract requirement, and proposed JavaScript mapping. Resolve discrepancies explicitly. If the official contract is ambiguous or references disagree, preserve fail-closed behavior and document the exact blocker; never guess.
6. Implement Coinzilla's own JavaScript version using the existing broker contracts, package conventions, DDD boundaries, shared utilities, exact-decimal handling, and error/result patterns. **Reimplement the proven behavior; do not port C# syntax/framework abstractions, add the .NET library as a runtime dependency, or add the MCP server as a runtime dependency.**
7. Follow strict TDD: add the smallest meaningful regression/contract test first, observe the expected RED result, then implement and verify GREEN. Reuse or adapt the reference project's test cases and captured fixtures as inspiration, while independently validating them against the official contract. Add boundary, malformed-response, error, timeout, cleanup, and lifecycle tests appropriate to the capability.
8. Update the Bitunix capability contract, package README if user-facing capability changes, this package roadmap, affected issue/PR, and any other living docs in the same task/PR. Record source links and meaningful discrepancies so the next agent can reproduce the audit.

### Reference quality and safety rules

- The .NET project is a reference implementation, **not infallible specification**. Audit its actual request path and tests. A method name, interface comment, README, or passing fixture alone does not prove correctness or completeness.
- Specifically verify that the implementation calls the endpoint documented by its own interface and that the fixture matches the real endpoint. Investigate apparent mismatches rather than copying them. For example, the inspected .NET Spot `GetUserTradesAsync` body appeared to request the pending-order endpoint while its interface documents `/order/deal/list`; re-check the current source before relying on that path.
- Distinguish Spot from Futures throughout the audit. Never copy a Futures-only WebSocket subscription or endpoint into Spot without official Spot evidence.
- A WebSocket RPC request/response method is not a continuous subscription. Do not claim a private order/execution stream exists unless official Spot documentation and implementation evidence demonstrate push events, subscription lifecycle, event identity, and reconnect/recovery semantics.
- Third-party tests are useful examples, not proof that Bitunix guarantees the behavior. Confirm pagination/completeness, stable identifiers, source timestamps, quantity semantics, and unknown-outcome reconciliation independently.
- Keep order placement/cancellation disabled when required identity, quantity, execution-history, lifecycle, or mutation-environment guarantees remain unresolved. No live order placement, cancellation, or account mutation as part of ordinary development or tests. Default tests remain offline and credential-free.
- Keep [issue #1185](https://github.com/45s/coinzilla/issues/1185) and the [Bitunix capability contract](../../docs/brokers-websocket-contract.md#bitunix-spot-capability-contract) aligned with verified findings. Do not silently remove an existing blocker because a third-party SDK implements a method.
