# Binance Broker Roadmap

---
status: active
type: roadmap
owner: brokers
---

## Priority execution plan — current develop direction (2026-11-10)

This section is authoritative for next work and orders the broker package by risk. Historical phases below remain implementation evidence.

### Historical candle and live Kline capability — Harvester issue #1016

**Status: IMPLEMENTED in PR #1017.** The Binance WebSocket broker now exposes a normalized candle contract:

- [x] Add the immutable, exchange-neutral candle shape and strict Binance history/stream adapters.
- [x] Expose getCandles using the unsigned WebSocket API time and klines methods. Validate symbol, interval, limit (1–1000), optional time bounds, response shape, exact OHLCV strings, timestamps, OHLC invariants and strict ascending order.
- [x] Expose subscribeForCandles through the existing public Streams client using the Kline stream; preserve the exchange isClosed flag and return an unsubscribe handle.
- [x] Add offline adapter, broker contract, malformed-response, history-order, subscription and unsubscribe tests.
- [x] Preserve the native WebSocket architecture; no REST transport, third-party SDK or order mutation is added.

Historical completion uses Binance server time sampled immediately before the klines query, avoiding local-clock assumptions. The broker deliberately does not sort, interpolate or backfill gaps; those are consumer-owned market-data responsibilities.

**Next consumer phase:** add the narrow methods to Harvester's application-owned BrokerPort and adapter, then implement history warm-up, gap/freshness handling and protection state.

### Canonical order acknowledgement completeness — issue #960

- [x] **Request complete Binance RESULT acknowledgements for canonical order placement — issue [#960](https://github.com/45s/coinzilla/issues/960), implemented in merged [PR #961](https://github.com/45s/coinzilla/pull/961).** Binance's default response for `LIMIT_MAKER` is minimal `ACK`, which omits the order facts required by `adaptCanonicalOrder()`. Canonical placement explicitly requests `newOrderRespType: "RESULT"`, returning the canonical order fields without the optional fills array.
- [x] **Verification:** the test-first regression and all seven GitHub Actions workflows passed on exact PR head `37b4a805219edc9fc901cc5c11dd44bf850b4908`; PR #961 merged as `8e2f795223a4d594947a6577a09bd183f9b48328` and issue #960 is closed. The compatibility `createOrder()` contract is unchanged; no automatic retry or inference from incomplete ACK was added.
- Consumer recovery remains Harvester-owned and is tracked separately in [issue #962](https://github.com/45s/coinzilla/issues/962).

### Trading environment selection — explicit contract

- Binance endpoint selection is controlled only by `TRADING_MODE`, with the exact values `testnet` and `live`.
- `testnet` selects the Spot TESTNET WebSocket API and Streams endpoints; `live` selects the Spot LIVE endpoints.
- The broker configuration requires an explicit `tradingMode` value. Missing or unsupported values fail during construction; there is no implicit default.
- `NODE_ENV` must never select or influence exchange endpoints.
- Harvester must pass its resolved `TRADING_MODE` into the broker adapter. All broker fixtures must state `tradingMode: "testnet"` explicitly unless a test specifically covers LIVE selection.
- TESTNET integration suites must assert `TRADING_MODE=testnet` and the actual TESTNET endpoint pair before connecting.
- [x] **Explicit Binance trading-mode selection — PR #841.** `TRADING_MODE` is the sole endpoint selector; required `tradingMode` configuration is validated fail-closed, Harvester passes the resolved value, and broker fixtures state TESTNET/LIVE explicitly. Offline endpoint, invalid-mode, override, and `NODE_ENV`-independence tests pass. Hosted TESTNET acceptance remains a separate, externally blocked verification.

### CRITICAL — protocol and recovery safety

1. **Resolve the outstanding native WebSocket TESTNET handshake/acceptance gap.**
   - **Why:** the read-only Binance TESTNET workflow has failed during the native Undici WebSocket handshake before account/recovery checks completed. Passing offline broker tests does not prove real endpoint compatibility or reconnect behavior.
   - **Do:** preserve the exact failing error/cause and distinguish DNS/TLS/HTTP upgrade/Undici transport failures from application authentication. Reproduce only in an authorized, eligible environment; use the existing read-only workflow and keep order mutations disabled. Do not inspect or print secrets, change regions, weaken validation or repeatedly retry an identical blocked path.
   - **Verify:** record exact Node/Undici versions, endpoint, workflow commit, handshake stage and sanitized cause; then complete read-only account/open-order/trade queries and user-data recovery acknowledgement. Full exchange acceptance remains unverified until the complete run succeeds.

2. **Preserve recovery-generation and subscriber acknowledgement invariants.**
   - **Why:** stale acknowledgements or a terminal recovery notification delivered to the wrong subscriber can reopen a consumer before authoritative reconciliation is complete.
   - **Do:** retain the explicit per-subscriber acknowledgement result API, monotonic generation token, active-subscriber fencing and one terminal `reconciled` notification per active subscriber. Keep state-changing RPCs blocked until global recovery completion; removed subscribers must not receive terminal events.
   - **Verify:** cover multiple subscribers, first-versus-last acknowledgement, duplicate/stale token, subscriber removal, second disconnect during reconciliation, reminder cancellation and exactly one terminal event. Do not regress the legacy boolean API's documented meaning.

### Accepted cross-domain contract work — Harvester issue #774

- [x] **Cancellation request outcome classification — Harvester issue [#774](https://github.com/45s/coinzilla/issues/774), implemented in merged PR [#786](https://github.com/45s/coinzilla/pull/786).** The broker exposes `NOT_SENT` only for a local preflight refusal before the Binance RPC and `OUTCOME_UNKNOWN` for a dispatched request without an authoritative canonical order result. Harvester accepts `NOT_SENT` only on `ok: false`, preserves known canonical order state, and retains fail-closed behavior for ambiguity. Exact-head broker/Harvester regressions, workspace tests, coverage, syntax/actionlint, Utils tests, and dependency audit passed. No TESTNET or exchange operations were performed.

### Accepted cross-domain market-stream liveness work — Harvester issue #760 / Brokers issue #1270

**Status: MERGED in PR #1272 (`1a52993483c7ce1684df26da7fef607e280305a3`).** This is a coordinated Brokers-owned transport capability with Harvester-owned freshness/trading policy.

- [x] Observe Binance server ping frames through Undici's `undici:websocket:ping` diagnostics channel, filter by the owned socket instance, and release the diagnostic subscription on close/setup failure.
- [x] Add a 45-second server-heartbeat watchdog. Missing pings close the public Streams transport and use the existing bounded reconnect/resubscribe lifecycle; generic transport errors remain diagnostic and do not cause blind reconnects.
- [x] Expose connection state/generation, last ping and age, desired/confirmed stream state, and per-stream last-message receipt timestamp/age. Heartbeat expiry reports `BINANCE_STREAM_HEARTBEAT_TIMEOUT` with the stream snapshot.
- [x] Detect a logical aggTrade gap using the documented all-market `!ticker_1h@arr` rolling-window ticker. Compare ticker last trade ID `L` with aggTrade last covered trade ID `l`; allow five seconds for normal delivery, then resubscribe only the affected aggTrade stream.
- [x] Bound logical-stream recovery to three attempts per 60 seconds. A quiet market does not trigger recovery without a newer ticker trade ID; a successful subscription acknowledgement is not treated as recovered until aggTrade catches up.
- [x] Keep market-data transport state separate from user-data/accounting recovery. Preserve Harvester's five-second stale-price gate; do not add a ticker-price fallback, REST fallback, order mutation, or process-wide restart.
- [x] Add fake-clock tests for ping timeout/reconnect, heartbeat reset, per-stream receipt diagnostics, quiet markets, trade-ID gaps, targeted resubscription, recovery acknowledgement, retry exhaustion, and disposal races.
- [x] Update [the WebSocket contract](../../docs/brokers-websocket-contract.md#public-market-data-liveness-and-recovery) and [package operations README](./README.md#binance-public-market-data-liveness).

**Verification evidence:** all required CI passed on exact PR head `378c59ea4f2529607d212c001f2f6fd93afcc870`: workspace unit tests, workspace coverage, JavaScript syntax/lint, Harvester targeted tests, Utils unit tests, external documentation links, and dependency audit. The implementation was merged as `1a52993483c7ce1684df26da7fef607e280305a3`. Issues #760 and #1270 are closed. No TESTNET/LIVE connection or order activity was performed.

**Known limit:** a WebSocket ping proves transport liveness, not delivery of every logical stream. The per-symbol detector requires the rolling ticker to report a newer trade ID. If aggTrade and ticker delivery both stop while server pings continue, the broker cannot safely infer an exchange data-plane outage; the consumer stale-price gate remains fail-closed and operators need runtime evidence.

### IMPORTANT — lifecycle quality and maintainability

3. **Complete the read-only integration matrix and document what remains unverified.**
   - **Why:** unit tests prove deterministic behavior against fakes, not Binance protocol compatibility, signed RPC behavior, or exchange-side recovery semantics.
   - **Do:** keep integration suites explicitly opt-in, read-only by default, credential-safe and separate from offline CI. Add a clear result matrix for public streams, signed RPC, user-data subscription, reconnect/resubscribe, account snapshots and canonical order/trade reconciliation.
   - **Verify:** every run records exact commit/runtime and skipped checks; never describe skipped mutation tests or failed handshakes as passed acceptance.

4. **Decompose the largest broker lifecycle modules in small, behavior-preserving steps.**
   - **Why:** the broker contains large transport, streams and user-data lifecycle modules. Their responsibilities overlap at connection ownership, pending requests, listener cleanup and recovery, making regressions difficult to localize.
   - **Do:** map state ownership first; extract only cohesive state machines (transport handshake/close, RPC request lifecycle, stream subscription control, user-data recovery) with explicit ports. Keep the public broker interface and wire contracts stable.
   - **Verify:** add characterization tests before each extraction and retain timeout, late-ack, reconnect, manual-close, listener-removal and resource-cleanup regressions. Do not refactor several lifecycle areas in one PR.

5. **Keep broker contracts exchange-neutral and testable.**
   - **Why:** Harvester and other consumers should depend on normalized broker capabilities/results, not Binance-specific transport details.
   - **Do:** use the existing Entities contracts for orders, fills, commissions, balances, trading rules and capability snapshots. Add a shared contract only when a second consumer needs it; keep Binance mapping inside the adapter.
   - **Verify:** contract tests cover supported/unsupported/unknown capabilities, partial responses, unknown outcomes, exact decimal strings and timestamp identity.

### DEFERRED

6. **Additional exchanges/transports:** do not add another venue or generic transport abstraction until a real consumer and protocol acceptance matrix exist.
7. **Performance work:** add benchmarks only when production evidence identifies throughput, memory or latency limits; preserve bounded queues and deterministic cleanup first.

> **Agent entry point:** When asked to implement, improve, audit, or maintain `/packages/brokers`, read this file first and follow it as the package-level source of truth. Start with **Current status and next action**, then complete the mandatory pre-work checks before changing code. Do not rely on chat history or assume earlier findings are still current.

**Package:** `@coinzilla/brokers`
**Repository:** `45s/coinzilla`
**Shared integration branch:** `develop` (use short-lived broker task branches; see the repository-root `AI_AGENT_WORKFLOW.md`)
**Scope:** broker package, broker tests, required root dependency metadata/lockfile changes, and broker documentation.

This roadmap is intentionally detailed. It contains the architecture, verified decisions, compatibility contract, phased implementation plan, test requirements, branch synchronization policy, and agent working rules for the broker package. Update it whenever implementation evidence changes a decision or phase status.

---

## 1. Mission and definition of done

### Mission

Replace the Binance broker's third-party SDK-backed runtime with a carefully tested native Node.js implementation, while preserving the existing public broker contract and consumer behavior.

The target is **zero third-party runtime dependencies in `@coinzilla/brokers`**. Internal workspace dependencies such as `@coinzilla/entities` and `@coinzilla/utils` may remain when needed; they are not third-party dependencies.

Use WebSockets for supported Binance operations:

- **Binance Spot WebSocket API:** request/response operations, including orders, account information, order/trade history, symbol metadata, and authenticated user-data subscription/events.
- **Binance Spot WebSocket Streams:** public market-data push streams.

Do not build a new REST trading client. Move symbol-filter retrieval from REST to the WebSocket API's `exchangeInfo` method. Existing custom REST broker code is legacy: deprecate it, do not expand it, and remove it only after compatibility and consumer checks prove removal is safe.

### Non-goals and hard scope boundaries

- Do not add trading strategy or bot product features.
- Do not add another third-party WebSocket package as a shortcut.
- Do not add credentials, Ed25519 keys, or a new authentication setup for the current HMAC signature-subscription flow.
- Do not remove public exports or change consumer-facing method/event/result shapes without an explicit compatibility decision supported by repository-wide consumer checks.
- Do not claim completion based only on code being present or tests starting. Require verified exit criteria and checks on the exact commit.

### Definition of done

The migration is complete only when all of the following are true:

1. The supported broker path has no third-party runtime dependency; manifests, lockfile, source imports, and production dependency audit agree.
2. Existing supported public exports, method signatures, result shapes, normalized decimal strings, and event callback contracts remain compatible, or any deliberate breaking change has an explicit approved migration plan.
3. WebSocket API RPC and public WebSocket Streams are separate, well-defined clients with explicit lifecycle and error behavior.
4. User-data subscription uses the verified compatible API method on the WebSocket API connection.
5. State-changing requests are never blindly replayed after uncertain disconnects.
6. Deterministic unit tests cover transport, RPC, stream lifecycle, broker adaptation, and failure/recovery paths. Opt-in testnet tests provide a separate live-protocol verification layer.
7. Supported Node.js runtime requirements are declared and tested.
8. No bot application files were changed by this migration.
9. All required CI checks pass on the exact final PR head, and the shared `develop` branch remains the integration source of truth for ongoing work.
10. This roadmap and the contract audit describe the implementation that actually shipped.

---

## 2. Current status and next action

### Overall status

### Accepted cross-domain recovery contract — issue #702 (2026-11-08)

The repository owner approved the compatibility-preserving per-subscriber acknowledgement result contract. This is now authorized implementation work, not a pending product decision.

- [x] Add `acknowledgeRecoveryResult()` to each user-data subscription handle; preserve the existing `acknowledgeRecovery()` boolean behavior exactly. Merged in PR #732 (`adb3639e6c1a1b03e885d394a07f8ce4c05356dd`).
- [x] Return `{ accepted: true, completed: false }` when this active subscriber's acknowledgement is recorded but another active subscriber remains pending.
- [x] Return `{ accepted: true, completed: true }` when this call completes shared recovery.
- [x] Reject inactive/stale handles explicitly; reject calls when no recovery is pending without changing subscriber state.
- [x] Broker-side recovery remains required, bounded reminders continue, and state-changing RPCs remain blocked until all active subscribers acknowledge. Harvester's consumer failure behavior is completed in PR #735; rejected acknowledgements remain fail-closed.
- [x] Preserve exactly one terminal `reconciled` status per recovery generation for each still-active subscriber; removed subscribers receive none (PR #729).
- [x] Update the Harvester consumer only after the broker contract is merged. Local acceptance must never open the application readiness gate before the matching global `reconciled` status. Completed in [PR #735](https://github.com/45s/coinzilla/pull/735); Harvester readiness is matched to recovery generation and active subscription ID.
- [x] Fence `acknowledgeRecoveryResult(recoveryGeneration)` with a broker-issued monotonic generation token. The token is emitted with `recovered` and `reconciled`; missing/invalid/older tokens are rejected without changing subscriber acknowledgement state. Implemented in follow-up PR #740.
- [x] Propagate the broker token through Harvester and require it to match the locally acknowledged recovery generation and active subscription ID before readiness opens. The legacy no-argument boolean method remains callable for compatibility; it cannot provide stale-work fencing because it carries no generation token.

**DDD/TDD execution:** the Brokers Application user-data session owns the subscription-handle use case and result contract; the Domain recovery policy remains authoritative for the all-active-subscriber completion invariant; Infrastructure/ Binance adapters remain unchanged. Add deterministic application-session tests first (RED), implement the smallest additive application change (GREEN), then update README and consumer tests. Preserve the existing Broker API for current consumers. No TESTNET/live exchange action is required.

- [x] Phase 0 — contract and dependency inventory.
- [x] Phase 1 — characterization tests and reusable deterministic test seams; PR #256 merged into `migration/binance-native-ws`.
- [x] Phase 2 — native WebSocket transport; PR #261 merged into the integration branch (merge commit `8397d6bb494d28b5f357fdaa663358e3a4128002`).
- [x] Phase 3 — WebSocket API RPC client; PR #263 merged into `migration/binance-native-ws` (merge commit `cdc2333fdf43e84d4cba2a0814e905472a558b70`).
- [x] Phase 4 — public WebSocket Streams client; PR #265 merged into `migration/binance-native-ws` (merge commit `b8daae9a5d7df6dd081de8537783ce3976ab7b39`).
- [x] Phase 5 — rebuild the broker on native clients; PR #271 merged into `migration/binance-native-ws` on 2026-10-31 (merge commit `a0ec1e64609c2291342f4470e203b453e0935c51`).
- [x] Phase 6 — user-data session lifecycle and recovery; deterministic offline coverage characterizes subscription setup and uncertain outcomes, termination/reconnect retries, repeated reconciliation acknowledgements, state-changing request gates, stale events, listener rollback, and stale-subscription cleanup. Opt-in live TESTNET/soak validation remains in Phase 8.
- [x] Phase 7 — remove the SDK and retire legacy REST implementation; completed by PR #333 on 2026-10-31.
- [~] Phase 8 — operational hardening and completion; code-level hardening and offline verification are complete, but live TESTNET acceptance is blocked by a failed read-only integration run. Workflow run [#42483880274](https://github.com/45s/coinzilla/actions/runs/42483880274) ran on `develop` at `6236f49dca53a2938b016b52802f907c90611b44` on 2026-11-08. All nine package unit-test jobs passed; `Run read-only Binance TESTNET integration` failed during `BinanceWebSocketBroker.connect()` with a native Undici WebSocket handshake `TypeError` (`failHandshake`, blank message). The account/read-only checks and recovery test did not complete. The repository owner confirms the credentials are Binance Spot TESTNET credentials with trading permissions; secret values remain uninspected. The run kept `BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS=0` and `BINANCE_TESTNET_EXPECT_USER_DATA_EVENT=0`; order mutation and external-event tests remained skipped. Diagnose the handshake failure before retrying; do not enable mutations or weaken reconciliation. A controlled live recovery/soak remains pending.
  - Offline regression coverage now includes 100 deterministic disconnect/reconnect cycles in `src/infrastructure/binance/broker-websocket/tests/user-data-session.soak.test.js`, using the existing Node.js test runner and fake clients/scheduler. This simulated soak verifies order-safety gating, current/stale event handling, one replacement subscription per cycle, and listener/timer cleanup; it does not replace the still-pending live TESTNET run or controlled real-session soak.
- [x] Phase 9 — DDD/TDD architecture refactor inside `@coinzilla/brokers`; complete after PR #697 (complete Binance Infrastructure placement) and PR #704 (executable dependency-direction and public API guards) merged into `develop`. Slices 1–10 are merged. The user-data recovery workflow is separated across Domain, Application, Application Ports, and Binance Infrastructure; the concrete broker facade remains the Infrastructure composition boundary. No speculative use-case wrappers or separate Bootstrap were introduced.
- [x] JSDoc contract coverage — completed by PR #657 and merged into `develop` at `ccf4662`. Public broker methods and non-obvious inputs/outputs at Binance adapter, RPC, Streams, transport, and user-data boundaries are documented. The package remains JavaScript-first; no `checkJs` or TypeScript tooling was added.

### DDD architecture modernization — first tranche complete; operational verification remains

The first DDD/TDD modernization tranche established deterministic tests, selected ports, and focused adapters, but did not complete the intended architecture at that time. The subsequent Phase 9 work below has since completed and is merged into `develop`.

- [x] Establish and execute the package-scoped coverage command in CI. Pre-threshold package coverage snapshot on PR #528 head `ba1fe560048fecd1d7d7aec83f071cf709c218da`: **83.20% lines, 85.89% branches, 80.55% functions**.
- [x] Document the initial package boundary and selected responsibilities in `packages/brokers/AGENTS.md` and [the broker contract audit](../../docs/brokers-websocket-contract.md). This first-tranche description is historical; Phase 9 supersedes its blanket instruction against package-owned `domain/` and `application/` layers.
- [x] Add deterministic RPC/Streams failure-path characterization. The package suite has since grown to **387/387** passing tests on PR #573's synchronized head. Latest critical runtime coverage is recorded below; the RPC client remains at 99.06%/93.39%/94.12% (lines/branches/functions). PR #527 prevents late message/close callbacks from superseded Streams transports; PR #528 explicitly verifies that all four order mutation methods fail closed while user data is unavailable.
- [x] Introduce the injected `createUserDataClientPort` boundary. The user-data session owns lifecycle/recovery and acknowledgement state; the Binance adapter owns RPC method names, signed subscription options, and client listener forwarding.
- [x] Complete deterministic user-data lifecycle/recovery characterization. The session suite has 42 offline tests covering uncertain subscription resolution, retries, reconnect races, repeated reconciliation acknowledgement, blocked state-changing operations, stale events, listener rollback, and stale-subscription cleanup. `user-data-session.js` measures 98.11% lines / 90.05% branches / 100.00% functions on PR #555's exact CI head. The broker-level order-safety regression also verifies that `createOrder`, `createCanonicalOrder`, `cancelOrder`, and `cancelAllOpenOrders` issue no mutation RPC after stream termination.
- [x] Extract focused pure Binance adapters for symbol filters, canonical fills, order history, and order request parameters. Each new adapter has direct tests and 100% line/branch/function coverage.
- [x] Follow RED → GREEN → REFACTOR for the vertical slices while preserving public exports, method signatures, result envelopes, decimal strings, event semantics, order-safety gates, and reconciliation acknowledgement behavior.
- [x] Verify package/workspace tests, package coverage, JavaScript syntax, actionlint, workflow lint, production dependency audit, and Utils tests on the exact PR heads. PRs #516–#525 are merged.
- [x] Set risk-based package coverage thresholds after reviewing the critical recovery/operational paths. `packages/brokers/package.json` now enforces 90% lines / 80% branches / 80% functions for active Binance WebSocket runtime and shared adapter sources. TESTNET integration suites, test files, and test-only fixtures/helpers are excluded; this is a targeted broker-runtime floor, not a blanket workspace percentage.

  Coverage review on PR #539's exact CI head `c6c073ee07043b63e83f1d72863e768bc903df51`: broker facade 97.25% lines / 90.79% branches / 96.00% functions; user-data session 99.37% / 91.28% / 100.00%; RPC client 99.06% / 93.39% / 94.12%; Streams client 93.47% / 85.78% / 81.03%; native transport 93.84% / 79.10% / 92.31%. This was the initial risk review before the targeted 90% lines / 80% branches / 80% functions threshold was enforced. Integration suites and test helpers remain excluded from production-code thresholds.

  PR #543's exact CI head `dfbb79ba3de1e656270cb81ec176304e3d3e2b1b` raised native transport coverage to 100.00% lines / 91.25% branches / 96.15% functions. The legacy `adaptTrade` adapter measured 81.25% lines / 40.00% branches / 100.00% functions before PR #547; its direct required-field, ID, side, decimal-string, optional-fee, and timestamp tests raised it to 100.00% lines / 100.00% branches / 100.00% functions.
  PR #547's exact CI head `d289dfe8fd96be47e67099e4dcfb1c71ebc3d26a` confirms the legacy adapter at 100.00% lines / 100.00% branches / 100.00% functions. PR #548 adds further Streams lifecycle tests for late connection completion after shutdown, invalid initial subscription lists, custom base URL paths, array-form server shutdown, pending-request cleanup, close cleanup failures, and throwing error observers.

  PR #573's synchronized exact CI head `22a961bbb4565962ff86021002bbcc674c963f5c` passed 387/387 broker tests and all 5 required checks. Current runtime coverage: broker facade 97.24% lines / 92.15% branches / 96.08% functions; user-data session 99.37% / 91.28% / 100.00%; RPC client 99.06% / 93.39% / 94.12%; Streams client 98.57% / 92.80% / 82.76%; native transport 100.00% / 91.25% / 96.15%.

The broker facade remains the public infrastructure composition boundary. Keep simple RPC methods there unless a cohesive mapping or stateful responsibility justifies extraction; avoid one-wrapper-per-RPC over-abstraction.

### Phase 9 — DDD/TDD architecture refactor inside `@coinzilla/brokers` (complete)

**Scope is the broker package itself.** This phase is not a Harvester refactor, does not move broker responsibilities into another package, and does not authorize changes to other domains. Harvester and bot packages may be inspected only when necessary to verify existing public broker consumers; they are not implementation scope.

**Architecture objective:** make `@coinzilla/brokers` a cohesive, independently testable broker domain/application package with exchange-specific infrastructure adapters. The package owns the domain of broker capabilities and exchange interaction contracts—not portfolio policy, trading strategy, or bot product decisions.

Target dependency direction:

`Infrastructure adapters → Application use cases → Broker domain`

Ports are defined at the boundary needed by application/domain policy; infrastructure implements those ports. Dependencies and imports must not point inward from domain/application to Binance SDK/protocol/transport implementation details.

**Target responsibilities (derive names and module layout from real concepts; do not create empty template folders):**

- **Domain:** exchange-neutral broker concepts, capability contracts, value objects, invariants, domain errors, and policies that genuinely belong to the broker domain. Keep Binance DTOs, wire names, sockets, and protocol envelopes out.
- **Application:** broker-owned use cases and orchestration for account, order, market-data, and user-data capabilities. Coordinate domain behavior through explicit ports; do not embed transport mechanics.
- **Application ports:** application-owned, narrow interfaces for user-data subscription/session capabilities and other demonstrated external effects. Keep them under `src/application/ports/`; infrastructure implements them. Avoid speculative generic abstractions and one-wrapper-per-method interfaces.
- **Infrastructure:** Binance-specific RPC/Streams clients, transport, signing, endpoint configuration, protocol DTOs, request/response/event mapping, and adapters implementing broker ports.
- **Composition/public API:** preserve the existing public broker exports and consumer contract while composing application services with Binance infrastructure.

**Implementation sequence:**

1. Inventory the current package modules, imports, responsibilities, public exports, and existing tests. Produce a dependency/responsibility map before moving code.
2. Identify concrete domain rules and application workflows currently embedded in the Binance facade, user-data session, or protocol utilities. Do not relabel pure DTO mapping as domain logic.
3. Define broker-owned domain contracts and application use cases from actual package behavior. Record important architectural decisions and dependency rules.
4. Add ports at demonstrated side-effect boundaries and adapt Binance infrastructure to implement them.
5. Refactor one vertical capability slice at a time (for example account reads, order lifecycle, market metadata, or user-data lifecycle). Preserve behavior and compatibility at every slice.
6. Remove duplicated responsibilities and accidental dependencies only when tests and the dependency map demonstrate the improvement.
7. Update package architecture documentation and this roadmap as the implementation evolves.

**TDD is mandatory for each slice:** write a failing test first (RED), implement the smallest passing behavior (GREEN), then improve structure without changing behavior (REFACTOR). Verify focused tests, package tests, coverage, and relevant workspace consumers after each slice. Do not perform a directory-only rewrite or move code without behavioral/architectural tests.

**Required test boundaries:**

- Domain tests: deterministic, pure, no Binance client, socket, network, or credentials.
- Application tests: use-case behavior with fake/in-memory ports; cover success, invalid state, failures, retries, timeouts, and uncertain outcomes.
- Port/adapter contract tests: prove Binance infrastructure satisfies the application-facing contracts.
- Infrastructure tests: protocol framing, signing, DTO mapping, transport lifecycle, reconnect, cleanup, and malformed responses.
- Public broker contract tests: preserve exports, signatures, result envelopes, decimal strings, callback/event semantics, and safety gates.
- Integration tests: remain opt-in, TESTNET-only, and separate from default offline tests.

**Compatibility and safety constraints:**

- Preserve current public exports, method signatures, result shapes, exact decimal strings, event semantics, reconciliation acknowledgements, and order-safety gates unless a separately reviewed compatibility change is approved.
- Never blindly replay a state-changing RPC after an uncertain timeout or disconnect.
- Never enable live order mutations or weaken TESTNET safety controls as part of architecture work.
- Keep portfolio/position policy, strategies, and bot product behavior outside this package; this is a scope boundary, not a reason to keep broker-owned domain/application concepts out of brokers.

**Phase 9 exit criteria (all required):**

- The package has a documented, implemented domain/application/ports/infrastructure responsibility map that matches actual source dependencies.
- Domain code has no dependency on Binance protocol, transport, or concrete infrastructure.
- Application use cases depend on explicit ports rather than concrete Binance clients.
- Binance infrastructure implements the ports and passes adapter contract tests.
- Domain and application tests run offline without credentials or network.
- Important failure, retry, timeout, reconnect, cleanup, and uncertain-outcome paths have deterministic coverage.
- Existing public broker contracts and consumers remain compatible, or an approved migration is documented and verified.
- Package tests and the configured coverage gates pass on the exact final PR head.
- Architecture docs and this roadmap describe the shipped code; Phase 9 is marked complete only after merge into `develop` and required validation.

**Status:** complete. Slices 1–10 are merged. Slice 9 was merged in [PR #697](https://github.com/45s/coinzilla/pull/697) at `ae5d1a8a9c474cff46a6db72f4258787bb071669`; Slice 10 was merged in [PR #704](https://github.com/45s/coinzilla/pull/704) at `216f7c8397d83837c4e6d3202778469c2a4e85bf`. The Domain/Application/Ports/Infrastructure responsibility map matches the source tree, dependency direction is executable, the four public exports are pinned, and the user-data application workflow has offline port-based tests. The broker facade remains the concrete Infrastructure composition boundary.

**Progress**

- [x] Slice 1 — extract the exchange-neutral user-data recovery completion invariant into `src/domain/user-data-recovery-policy.js`; merged via PR #596. Six pure domain tests; package tests and domain coverage gate passed.
- [x] Slice 2 — normalize user-data client-port subscription results; merged via PR #599. The adapter unwraps Binance RPC envelopes; the session consumes IDs and ID arrays only. 399/399 broker tests and coverage passed.
- [x] Slice 3 — normalize Binance user-data events and termination notifications in the adapter; the session retains only generic bounded identity state. Merged via PR #602; 400/400 broker tests and coverage passed.
- [x] Slice 4 — move the session coordinator into `src/application/user-data-session.js` and initially define `src/ports/user-data-client-port.js` (relocated under `src/application/ports/` by Slice 6); runtime port validation and application/port coverage merged via PR #603. 405/405 broker tests and coverage passed.
- [x] Slice 5 — move the Binance user-data client-port implementation into `src/infrastructure/binance/user-data-client-adapter.js`, co-locate deterministic adapter tests, and include infrastructure modules in the package coverage gate; merged via PR #605 on 2026-11-05 (merge commit `675b4c693abceecfd26a6401a7430f148c0ca1cc`).
- [x] Slice 6 — move the application-owned `UserDataClientPort` contract and its deterministic contract tests from `src/ports/` to `src/application/ports/`; update application/adapter imports, package coverage includes, and architecture/roadmap docs. Merged via PR #691; contract/test contents unchanged, and package/workspace verification passed.
- [x] Slice 7 — move the Binance-specific DTO/Entity adapters from `src/binance/shared/` to `src/infrastructure/binance/adapters/`; move all direct mapper tests with assertions unchanged; update relative test imports where needed, update the broker/root/helper imports, remove the obsolete shared coverage glob (the infrastructure glob now covers these modules), and preserve public exports/results. Merged via [PR #693](https://github.com/45s/coinzilla/pull/693) at `512b77f4a7745e2b5fbff7849dcfe136830acab8`; Brokers tests/coverage, workspace tests/coverage, Harvester targeted tests, syntax, and dependency audit passed.
- [x] Slice 8 — extract the six direct `UserDataSession` tests from the broker setup suite into `src/application/user-data-session.test.js`; move broker-level setup/recovery/reconciliation/cleanup suites and the opt-in integration test from `methods/` to `infrastructure/binance/broker-websocket/tests/`. Preserve assertions and keep application tests independent of Binance. Merged via [PR #695](https://github.com/45s/coinzilla/pull/695) at `5e7313a22303534dc555522fed22ccac0d3b08d9`; Brokers unit tests/coverage, workspace tests/coverage, Harvester targeted tests, syntax, and dependency audit passed.
- [x] Slice 9 — move the complete former `src/binance/` tree (88 files) under `src/infrastructure/binance/`, preserving the internal `broker-websocket/` layout, tests, and fixtures. Update the root entrypoint, broker facade, user-data adapter, cross-folder imports, coverage globs, and opt-in integration scripts. Public exports, broker methods, result shapes, decimal fidelity, event semantics, and protocol behavior remain unchanged. Merged via [PR #697](https://github.com/45s/coinzilla/pull/697) at `ae5d1a8a9c474cff46a6db72f4258787bb071669` (verified head `96acccc94532641aaa5be4e2bc4cd314a512e150`); Brokers unit tests/coverage, workspace tests/coverage, Harvester targeted tests, JavaScript syntax, and production dependency audit passed. TESTNET integration remained opt-in and was not run.

---

### Large-file review and scoped refactoring plan

The following modules and test suites are review targets because of state ownership, historical size, or shared lifecycle fixtures. File size is a review signal, not a reason for mechanical splitting:

| File | Current technical justification | Scoped follow-up plan |
|---|---|---|
| `infrastructure/binance/broker-websocket/broker.js` | Public facade coordinates the exchange RPC/Streams clients and preserves result/callback contracts. Pure mappings for symbol filters, canonical fills, order history, and order parameters are already extracted. | Keep simple RPC methods cohesive in the facade. `getAccountSnapshot` was inspected: balance normalization already delegates to shared `adaptSpotBalance`, while the only local transformation is a single safe-integer `updateTime` guard with no second caller. A separate one-function adapter would add indirection without improving testability, so this extraction is deliberately not needed. Revisit only if multiple account operations acquire a shared, independently testable mapping. Do not create one wrapper per RPC. |
| `src/application/user-data-session.js` | The application coordinator owns subscriber state, reconnect/ack timers, remote subscription identity, and listener cleanup through the injected `UserDataClientPort`. | Keep its state machine cohesive; split only when a distinct use case or domain invariant warrants it. |
| `application/user-data-session.test.js` and `infrastructure/binance/broker-websocket/tests/user-data-session*.test.js` | Direct Application tests exercise the injected port without Binance; broker-composition suites share deterministic scheduler, client, and broker fixtures. | Keep direct Application tests independent of Binance. Keep broker-level setup/recovery/reconciliation/cleanup scenarios and the opt-in integration test grouped under `broker-websocket/tests/`; shared broker fixtures remain in `test-helpers/`. Existing cases/assertions are preserved. |
| `utils/rpc-client*.test.js` | Request/protocol and transport-lifecycle scenarios share one fake transport and deterministic timer setup. | Split the former 609-line suite into protocol/request (16 tests) and lifecycle/cleanup (13 tests) files; extracted the shared native transport/fake socket/fake clock setup into `test-helpers/rpc-client-fixtures.js`. All 29 test cases remain in their original order with unchanged bodies. |
| `utils/streams-client.js` (585 lines) | One stateful coordinator owns desired/active streams, request acknowledgements, reconnect, rotation, and control timers. | Keep the lifecycle class cohesive. Consider extracting the pure raw-event-to-stream matching matrix only if it gains independent consumers or a substantially larger rule set. |
| `utils/streams-client*.test.js` | Subscription, reconnect, acknowledgement, and cleanup cases share one FakeTransport/FakeClock fixture. | Split the former 661-line suite into protocol/subscription (10 tests) and lifecycle/cleanup (16 tests) files; extracted `FakeTransport`, client factory, flush helper, and acknowledgement helper into `test-helpers/streams-client-fixtures.js`. All 26 test cases remain in original order with unchanged bodies. |

### Next action

1. The source of truth is `develop`; the baseline for PR #527 was merge commit `322a60c0cb1c1f41933539cea5815a601f4a1e25` (PR #525).
2. The DDD/TDD first tranche is merged through PRs #516–#525: package coverage baseline; user-data client port; RPC/Streams failure tests; symbol-filter, canonical-fill, order-history, and order-request adapters; and explicit architecture boundaries.
3. Latest package verification on PR #573 synchronized head `22a961bbb4565962ff86021002bbcc674c963f5c`: **387/387 broker tests passed**. The exact package coverage workflow passed on PR #573's synchronized head `22a961bbb4565962ff86021002bbcc674c963f5c`; the targeted 90% lines / 80% branches / 80% functions runtime gate passed. The pure Binance adapters retain direct deterministic coverage.
4. Phase 6 is complete for deterministic offline lifecycle/recovery behavior: 42 session tests cover uncertain subscribe/unsubscribe outcomes, reconnect retry liveness, fresh acknowledgements after each interruption, order gates, and stale cleanup. The latest package coverage report measures `user-data-session.js` at 98.11% lines / 90.05% branches / 100.00% functions. A connected socket or successful subscription is never proof that missed events have been reconciled.
5. Phase 8 remains open for opt-in TESTNET verification and long-running recovery/soak validation. The integration suite requires `BINANCE_TESTNET_INTEGRATION=1`, non-placeholder `BINANCE_API_KEY`/`BINANCE_API_SECRET_KEY`, and a TESTNET endpoint; the live-event case additionally requires `BINANCE_TESTNET_EXPECT_USER_DATA_EVENT=1` and external TESTNET activity. These checks were not run in this offline workstream. Do not claim replay of events missed during a disconnect unless that behavior is proven.
6. Keep state-changing order requests blocked while user data is unavailable or any consumer has not acknowledged reconciliation. A timeout or connection loss during a state-changing RPC is an unknown outcome; never blindly replay it.
7. Phase 7 is complete through PR #333. Do not reintroduce the removed REST transport, legacy listen-key session, or third-party Binance SDK.
8. RPC cancellation was reviewed: `BinanceWebSocketApiClient.request()` supports a bounded timeout and settles pending requests on disconnect, but exposes no `AbortSignal` option. Abort semantics are not part of the existing contract; do not invent a cancellation API as part of this modernization.
9. Phase 9 is complete: Slices 1–10 are merged, including the full Binance Infrastructure relocation (PR #697) and executable dependency/public API boundary enforcement (PR #704). The user-data recovery vertical slice is separated across Domain, Application, Application Ports, and Binance Infrastructure, with direct Application tests beside the workflow. Keep the broker facade as the current composition boundary; do not add one wrapper or port per RPC. Phase 8's manual TESTNET/soak validation remains pending.

**Do not skip the next-action checklist because a previous chat said a phase was complete. Verify branch state and current files.**

---

## 3. Verified baseline and compatibility contract

The [Phase 0 broker contract audit](../../docs/brokers-websocket-contract.md) records the original SDK-to-native migration baseline. Its historical SDK dependency and export inventory is not the current state; use the current facts below and re-check source/consumers before changing a contract.

### Current dependency inventory

- `packages/brokers/package.json` has **no third-party runtime dependencies**. Its only runtime dependencies are workspace packages `@coinzilla/entities` and `@coinzilla/utils`.
- The native WebSocket implementation uses Node.js built-ins (`WebSocket`, `node:crypto`) and requires Node.js `>=22.23.4`, with a runtime guard for patched bundled Undici.
- Do not reintroduce the Binance SDK, third-party WebSocket packages, or REST trading fallbacks.

### Current public package exports

The current `packages/brokers/src/index.js` exports exactly:

| Export | Source | Contract |
|---|---|---|
| `BinanceWebSocketBroker` | `infrastructure/binance/broker-websocket/broker.js` | Public Binance Spot WebSocket API/Streams broker facade |
| `BinanceWebSocketConfig` | `infrastructure/binance/broker-websocket/config/binance-websocket-config.js` | Validated credentials, endpoints, and reconnect configuration |
| `CoreBroker` | `broker.core.js` | Shared base class used by broker implementations, including Market Simulator |
| `normalizeBinanceId` | `infrastructure/binance/adapters/normalize-binance-id.js` | Exact non-negative Binance identifier normalization |

The module retains an internal `BinanceSdkConfig` alias for compatibility inside its own module, but it is not a separate public root export. The old SDK/REST broker and standalone legacy Streams exports are not current root exports. Do not restore or remove aliases without a consumer-backed compatibility decision.

### Verified workspace consumers

A scan of current workspace manifests found two consumers of `@coinzilla/brokers`:

| Consumer | Usage | Compatibility contract |
|---|---|---|
| `apps/harvester` | `createBinanceBrokerAdapter` wraps `BinanceWebSocketBroker` and implements Harvester's application-owned `BrokerPort`. | Preserve broker methods/results/events, exact decimal strings, recovery acknowledgement, and order safety. Harvester owns trading use cases and its port. |
| `packages/market-simulator` | `HistoricalMarketBroker` extends `CoreBroker`; `SimulatedExecutionBroker` extends the historical broker. | Preserve `CoreBroker` construction, shared maps/state, and default unsupported-method behavior. Treat it as a live public extension point. |

Do not modify either consumer's implementation as part of a Brokers-owned refactor. Read them to verify compatibility and run their relevant tests through repository CI.

### Current broker operations and Binance mapping

| Broker operation | Binance operation / behavior |
|---|---|
| `getAssets()` | `account.status` with zero balances omitted; legacy `Coin` values |
| `getBalances()` | `account.status` including zero balances; canonical `Balance[]` |
| `getAccountSnapshot()` | `account.status` including balances and validated source `updateTime` |
| `getServerTime()` | `time` |
| `getOpenOrders({ symbol? })` | `openOrders.status` |
| `getOrder({ symbol, orderId })` / `getOrder({ symbol, clientOrderId })` | `order.status` using `orderId` or `origClientOrderId` |
| `getCanonicalOrder({ symbol, orderId? , clientOrderId? })` | `order.status` plus canonical order adaptation |
| `getOrderHistory(...)` | `allOrders`, preserving the established normalized legacy result |
| `getCanonicalOrderHistory(...)` | `allOrders` plus canonical `CanonicalOrder[]` adaptation |
| `getMyTrades(...)` | `myTrades`, preserving the established trade result |
| `getFills(...)` | `myTrades` plus canonical `Fill[]` adaptation |
| `createOrder(input)` / `createCanonicalOrder(input)` | `order.place`; preserve each method's current result contract |
| `cancelOrder(...)` | `order.cancel` |
| `cancelAllOpenOrders({ symbol })` | `openOrders.cancelAll` |
| `getPrices({ symbol })` | `ticker.price` |
| `getSymbolFilters({ symbol })` | `exchangeInfo` with symbol filter |
| `getExchangeMarkets()` | Unfiltered `exchangeInfo`, adapted to canonical `Market[]` |
| `subscribeForPrices({ symbol, onPrice })` | Public `<symbol>@aggTrade` stream |
| `subscribeForBookTicker({ symbol, onBookTicker })` | Public `<symbol>@bookTicker` stream |
| `subscribeForUserData({ onEvent, onStatus })` | Signed `userDataStream.subscribe.signature` on the WebSocket API connection |

Verify exact current parameters, response envelopes, signing rules, rate limits, and error codes against official Binance documentation during implementation. This table is a current mapping, not permission to guess undocumented behavior. `CoreBroker.getPrice()` remains the inherited unsupported default unless a concrete broker overrides it.

### Current public stream surface

The active public streaming methods are `subscribeForPrices` (aggregate trades) and `subscribeForBookTicker` (best bid/ask). Public stream protocol details, subscription limits, reconnect behavior, and payload contracts are internal infrastructure; do not reintroduce the old standalone `BinanceStreamClient` API as part of architecture work.

### Compatibility invariants

- Preserve public root exports and existing method signatures/results unless a separately reviewed migration plan exists.
- Preserve exact decimal strings in canonical order/fill/balance and market-data contracts; do not route financial values through JavaScript `Number` where precision matters.
- Preserve `onEvent({ event })`, optional status notifications, and explicit recovery acknowledgement semantics.
- Treat state-changing RPC timeouts/disconnects as unknown outcomes. Never blindly replay order placement or cancellation.
- Keep all default tests offline; TESTNET integration remains opt-in and TESTNET-only.

## 4. Architecture decisions and non-negotiable protocol rules

### Two distinct WebSocket roles

**A. WebSocket API connection**

- Request/response RPC for order, account, history, metadata, and other API operations.
- Authenticated user-data subscription and push events.
- Request IDs and pending-request correlation.
- API-key authentication and signed request parameters where required.

**B. Public WebSocket Streams connection**

- Public market-data push events such as `<symbol>@aggTrade`.
- Stream subscription/unsubscription messages and raw/combined stream envelopes.
- Independent lifecycle, reconnect policy, and message adaptation.

Do not put user-data subscription on the separate public market-data Streams connection. Binance delivers the selected signature-subscription events on the WebSocket API connection.

### User-data authentication: preserve the HMAC signature method

The current SDK uses `userDataStream.subscribe.signature` on the WebSocket API connection.

- Preserve the existing `apiKey` + `apiSecret` configuration.
- Use HMAC-SHA-256 with the API secret for the signature, following the exact current Binance signing rules.
- This method does not require an Ed25519 key pair or `session.logon`.
- Do not replace it with `userDataStream.subscribe`, which is a separate Ed25519-authenticated-session method.
- Do not revive the old REST listen-key timer for this new broker path.
- Exact payload canonicalization is not considered proven until known signing test vectors and opt-in testnet verification pass.

### Node.js runtime floor

**Updated approved decision (2026-10-31): `@coinzilla/brokers` and every consumer using its native WebSocket implementation require Node.js >=22.23.4, and the runtime guard verifies the bundled Undici version is patched.**

- Use Node's built-in WHATWG `WebSocket` and `node:crypto` where their documented behavior meets the requirements.
- The broker package declares `engines.node: >=22.23.4`; the unit-test workflow runs on exactly Node.js 22.23.4.
- The runtime guard checks `process.versions.undici` against fixed releases (6.29.1, 7.30.1, and 8.12.2), because a Node major version greater than 22 alone does not prove its bundled Undici is patched.
- This floor addresses CVE-2026-109932, which affected Undici automatic WebSocket pong handling under ping floods. Node.js 22.23.4 includes Undici 6.29.1.
- Do not imply unrelated workspace packages independently require this runtime floor.
- Test the exact supported runtime floor in CI and in the relevant integration checks.

### Native WebSocket ping/pong is a hard gate

Binance Spot Streams sends server ping control frames and expects timely pong responses with the required payload behavior. WHATWG WebSocket does not expose the low-level `.ping()` / `.pong()` methods familiar from some third-party libraries.

The old custom `WS.js` assumes EventEmitter-style `.on()` and low-level ping/pong methods, and its `createWebSocket()` is stubbed. It is not a working replacement.

**Do not assume the native WebSocket automatically satisfies Binance's ping/pong requirements. Prove it on the exact supported Node runtime. If it cannot be demonstrated, stop and revisit the architecture decision before proceeding; do not silently add a third-party dependency.**

### Reliability and safety rules

- Never automatically replay order placement, cancellation, or another state-changing RPC after an uncertain disconnect.
- Surface an uncertain outcome to the caller and reconcile using client order ID/order queries or another documented safe mechanism before retrying.
- Correlate concurrent RPC responses by request ID, not arrival order.
- Bound request timeouts and clean pending entries on every success, error, timeout, and disconnect path.
- Make connect, reconnect, and disconnect states explicit and idempotent.
- Clean up timers, sockets, and listeners on every shutdown/failure path.
- Restore desired public stream subscriptions after reconnect without duplicate callbacks.
- Validate stream names, parameters, message envelopes, and API responses at boundaries.
- Keep protocol handling, signing, message validation/adaptation, and broker result mapping in separate testable modules.
- Use pure functions for deterministic parsing, normalization, validation, and mapping where practical.
- Never log API secrets, private keys, signatures, or complete authenticated payloads.
- Do not hide network calls inside unit tests. Live Binance tests must be opt-in and clearly separated from deterministic tests.

---

## 5. Phased implementation plan

Each phase should be a separate, reviewable PR unless a tightly coupled test or documentation change belongs with its implementation. Keep PRs focused, but replace complete affected files when that reduces merge-conflict risk. Never start implementation from a stale branch.

### Phase 0 — Contract and dependency inventory

**Status: Complete.**

- [x] Inventory every `packages/brokers` export, repository consumer, and `@binance/spot` import.
- [x] Map broker methods to Binance WebSocket API/Streams operations, including parameters, response shape, authentication, and error behavior.
- [x] Decide supported Node runtime before choosing native WebSocket. Initial decision: Node.js >=22.4.0; superseded during Phase 2 by the security-reviewed Node.js >=22.23.4 floor and patched-Undici runtime guard.
- [x] Review current official Binance Spot WebSocket API and Streams documentation for the mapped operations and lifecycle constraints.
- [x] Confirm `userDataStream.subscribe.signature` is the intended compatibility method; existing HMAC API key/secret flow is sufficient, subject to exact signing test vectors.
- [x] Record legacy REST implementation gaps and compatibility exports.
- **Evidence:** [Phase 0 contract and audit](../../docs/brokers-websocket-contract.md). No runtime implementation changes were made in this phase.

### Phase 1 — Characterization tests and test seams

**Status: Complete. PR #256 was merged into `migration/binance-native-ws` on 2026-10-31.**

- [x] Characterize the public broker methods and their existing normalized result shapes.
- [x] Add a reusable WHATWG-style fake WebSocket with deterministic lifecycle and message delivery.
- [x] Add a deterministic fake clock for timeout scheduling.
- [x] Pin existing normalization and `toResult` behavior with tests.
- [x] Add RPC-specific regression cases for concurrent requests, malformed messages, unknown request IDs, duplicate/late responses, and disconnects with pending requests. `utils/rpc-client.test.js` covers concurrent/out-of-order correlation, malformed JSON and envelopes, unknown/duplicate/late IDs, disconnect settlement of all pending requests, timeout/send-failure cleanup, and uncertain state-changing outcomes; Phase 3 exact-head CI evidence is recorded below.
  - These cases must run against the native RPC client introduced in Phase 3. The current SDK owns its socket/correlation internals, so do not write misleading tests against a nonexistent native RPC implementation.
- **Exit criteria:** existing broker compatibility behavior and reusable test seams are tested without live credentials or network access. RPC correlation/failure tests remain Phase 3 gates.
- **PR:** [#256 — test(brokers): characterize Binance broker contract](https://github.com/45s/coinzilla/pull/256). Merged into the migration integration branch; no bot application files or runtime dependencies were added.

### Phase 2 — Native WebSocket transport

- [x] Implement a small Node-native WebSocket transport with injectable socket construction.
- [x] Normalize open/message/error/close events, message data, close codes/reasons, and send failures behind one internal interface.
- [x] Implement explicit connect/close state, connection timeout, idempotent shutdown, and listener cleanup.
- [x] Verify the local raw-WebSocket ping/pong integration test on Node >=22.23.4; the server receives a pong with the exact ping payload.
- [x] Add duplicate close/error, constructor-failure, close-during-connect, and listener-cleanup regression cases.
- [x] Exercise the Phase 1 fake socket and fake clock in transport tests; avoid unused testing scaffolding.
- [x] Verify official Binance connection lifetime (24 hours), server-shutdown notification, ping/pong behavior, 5 incoming messages/second, 1024 streams/connection, and 300 connection attempts/5 minutes/IP. Phase 4 must enforce application-level subscription/message limits and rotate/reconnect safely.
- **Exit criteria:** deterministic transport tests and the local ping/pong protocol test pass on Node.js 22.23.4; no third-party WebSocket package is added. CI evidence on PR #261 head `e4c442c61109807ee841485d40f5c0b64db8397e`.

### Phase 3 — WebSocket API RPC client

- [x] Implement request IDs and a pending-request map with deterministic response correlation.
- [x] Implement bounded request timeouts and cleanup on success, API error, malformed response, timeout, send failure, and disconnect.
- [x] Reject pending work on disconnect with actionable errors; mark state-changing request outcomes uncertain.
- [x] Implement HMAC-SHA-256 signing with `node:crypto`, preserving API-key/secret credentials for signed methods.
- [x] Add official Binance ASCII and UTF-8 signing vectors, including exact signature bytes.
- [x] Validate success/error response envelopes and preserve Binance status, error code, and message.
- [x] Handle concurrent requests and out-of-order responses.
- [x] Add deterministic tests for unknown/duplicate/late IDs, malformed payloads, multiple pending requests on disconnect, and timeout cleanup using the Phase 1 fake socket/clock.
- [x] Make reconnect behavior explicit: this client is one-connection/one-lifecycle; it never retries or replays requests.
- [x] Verify all tests on exact PR #263 head `1300fd57651cd5809feb0a5d0fd66541ee1ced6a`; Unit Tests, Utils Unit Tests, JavaScript Syntax, and Dependency Audit passed before merge.
- **Exit criteria:** deterministic tests cover success, API error, timeout, malformed response, concurrency, out-of-order, unknown ID, duplicate/late response, send failure, and disconnect. Signing has known test vectors.
- **PR:** [#263 — feat(brokers): add Binance WebSocket API RPC client](https://github.com/45s/coinzilla/pull/263). Merged into the integration branch with merge commit `cdc2333fdf43e84d4cba2a0814e905472a558b70`.

### Phase 4 — Public WebSocket Streams client

**Status: Complete. PR #265 merged into `migration/binance-native-ws` at merge commit `b8daae9a5d7df6dd081de8537783ce3976ab7b39`.**

- [x] Implemented the native public Streams client on `NativeWebSocketTransport`; the broken legacy `WS.js` class was not extended.
- [x] Kept public market-data Streams separate from WebSocket API RPC and authenticated user-data events.
- [x] Preserved the existing exported `BinanceStreamClient` and its method surface for the later compatibility migration.
- [x] Implemented combined `/stream?streams=...` setup, initial `LIST_SUBSCRIPTIONS` verification, acknowledged SUBSCRIBE/UNSUBSCRIBE operations, and defensive raw-envelope parsing.
- [x] Validated stream names and parameters; rolling-window ticker streams are restricted to Binance-supported 1h and 4h windows.
- [x] Added acknowledgement correlation, API error normalization, timeout/socket-failure handling, duplicate-listener management, 4-message/second control pacing, 1,024-stream limit, batching, reconnect/resubscribe, server-shutdown handling, pre-24-hour rotation, and idempotent cleanup.
- [x] Added a public-only adapter boundary: aggregate trades are adapted, other public market-data events pass through, and authenticated user-data events are rejected.
- [x] Added deterministic tests for the stream protocol, client lifecycle, failure paths, and adapter boundary.
- **Exact-head CI evidence:** PR #265 head `ce9bb384b7e9ea754e9f2b558ca56f7a180d760d` passed Unit Tests, Utils Unit Tests, JavaScript Syntax, and Dependency Audit.

**Legacy method-to-stream compatibility matrix** (the old exported methods remain untouched until Phase 5):

| Legacy method | Required parameters | Native stream mapping |
|---|---|---|
| `trade({ tickets })` | First ticket/symbol | `{symbol}@trade` |
| `kline({ tickets, interval })` | First ticket/symbol, interval | `{symbol}@kline_{interval}` |
| `miniTicker({ symbol? })` | Optional symbol | `{symbol}@miniTicker` or `!miniTicker@arr` |
| `ticker({ symbol? })` | Optional symbol | `{symbol}@ticker` or `!ticker@arr` |
| `rollingWindowTicker({ windowSize, symbol? })` | Window `1h` or `4h`; optional symbol | `{symbol}@ticker_{windowSize}` or `!ticker_{windowSize}@arr` |
| `bookTicker({ symbol })` | Symbol | `{symbol}@bookTicker` |
| `partialBookDepth({ symbol, levels, speed })` | Symbol, levels `5/10/20`, speed `100ms/1000ms` | `{symbol}@depth{levels}@{speed}` |
| `diffBookDepth({ symbol, speed })` | Symbol, speed `100ms/1000ms` | `{symbol}@depth@{speed}` |
| `aggTrade({ tickets })` | First ticket/symbol | `{symbol}@aggTrade` |

`userData()` is intentionally excluded: its old REST listen-key lifecycle is legacy behavior and the replacement belongs to Phase 6 on the authenticated WebSocket API connection.

**Exit criteria:** all Phase 4 implementation and deterministic test criteria were met on the exact CI-verified PR head. No live credentials or network calls are used by default unit tests.

### Phase 5 — Rebuild the broker on native clients

**Status: Implementation and deterministic tests complete. PR #271 is open; all four required CI workflows pass on exact head `88f56339d7f6ede226776574c0fdadce2037f0f9`. Awaiting explicit merge approval.**

- [x] Replace the SDK-backed `BinanceSdkBroker` internals with the native WebSocket API RPC client and native public Streams client; preserve the public broker/config export names.
- [x] Map broker request methods to native RPC methods: `account.status`, `openOrders.status`, `order.status`, `allOrders`, `myTrades`, `order.place`, `order.cancel`, `openOrders.cancelAll`, `ticker.price`, and `exchangeInfo`.
- [x] Move `getSymbolFilters()` from REST `fetch()` to WebSocket API `exchangeInfo`; preserve validated exact `tickSize`/`stepSize` strings.
- [x] Use the native Streams client for aggregate-trade price subscriptions and preserve the adapted price callback payload.
- [x] Route `userDataStream.subscribe.signature` through the WebSocket API connection with HMAC signing, and expose a lifecycle handle that sends `userDataStream.unsubscribe` before removing local observers; reconnect/recovery remains Phase 6.
- [x] Preserve order/fill normalization, client order ID mapping, order defaults, result wrappers, and exact fill decimal strings.
- [x] Mark order placement, cancellation, and cancel-all as state-changing RPC operations so uncertain outcomes are surfaced and never blindly replayed.
- [x] Remove direct `@binance/spot` imports from the broker implementation and config defaults; use explicit official production/testnet WebSocket endpoints.
- [x] Verify failure-safe startup cleanup, partial-shutdown cleanup, idempotent disconnect, and callback/resource cleanup with deterministic tests; exact-head CI remains the verification gate.
- [x] Complete the full broker contract and regression suite on the native client interfaces; Unit Tests, Utils Unit Tests, JavaScript Syntax, and Dependency Audit all pass on the exact PR head.
- [x] Re-audit current consumers read-only against latest `main`; no bot application files were changed.

- The bot consumes `getSymbolFilters()` as decimal strings and converts them to numbers itself; exact string outputs are preserved.
- Fill reconciliation expects `getMyTrades()` to return an array of canonical fills. `adaptTrade` remains the normalizer.
- Order execution consumes `createOrder()`/`cancelOrder()` results with IDs, status, and original/executed quantities. `adaptOrder` remains the normalizer.
- No `apps/` changes are included in this PR. User-data remote unsubscribe and reconnect recovery remain Phase 6.

- **Exact-head CI evidence:** PR #271 head `88f56339d7f6ede226776574c0fdadce2037f0f9` passed Unit Tests, Utils Unit Tests, JavaScript Syntax, and Dependency Audit.
- **Exit criteria:** every supported broker method uses native WebSocket clients; the supported broker path performs no REST requests; deterministic broker contract/failure tests and exact-head CI pass; consumer-facing behavior remains compatible.

### Phase 6 — User-data session lifecycle and recovery

- [x] Implement `userDataStream.subscribe.signature` on the WebSocket API connection using the existing HMAC `apiKey` + `apiSecret` credentials. Verified in `src/application/user-data-session.js`, the Binance signing adapter, deterministic session tests, and the opt-in `user-data-session.integration.js` suite.
- [x] Do not require Ed25519 keys or `session.logon`; do not switch to the Ed25519-session `userDataStream.subscribe` method. Repository source search under `packages/brokers/src` returns no `ed25519` or `session.logon` references.
- [x] Do not carry forward the legacy REST listen-key timer. Repository source search under `packages/brokers/src` returns no `listenKey` references; the legacy REST/listen-key implementation was retired in Phase 7.

#### Phase 6A — lifecycle observability and event idempotency (merged PR #285)

- [x] Expose RPC socket-close notifications without changing existing request/event behavior.
- [x] Detect explicit `eventStreamTerminated` events and unexpected API socket closure.
- [x] Add an optional `onStatus` callback that reports `terminated` and `connectionClosed` with `recoveryRequired: true`, plus `rpcError` diagnostics without claiming a recovery gap; keep the existing `onEvent({ event })` contract unchanged.
- [x] Ignore events whose `subscriptionId` does not match the active subscription.
- [x] Deduplicate execution reports using `symbol`, `orderId`, and `executionId`; use a bounded exact-payload cache for event types without a stable unique ID.
- [x] Avoid reporting intentional broker shutdown as an unexpected recovery gap.
- [x] Log unexpected API socket closure even when no optional status callback is supplied.
- [x] Fail closed for new `createOrder()` calls after user-data subscription failure, termination, explicit unsubscribe, or API socket loss; restore order placement only after a new subscription succeeds.
- [x] Document that event timestamps are not a global replay cursor and that recovery requires state reconciliation.
- [x] Phase 6A follow-up: deterministic account-update duplicate tests and callback/error isolation review (covered by Phase 6B.1 regression tests).

#### Phase 6B — reconnect, resubscribe, and reconciliation (split into 6B.1 and 6B.2)

**6B.1 — single-subscription session manager and safe recovery coordinator (PR #288)**

- [x] Maintain one remote signature subscription per account/API connection and fan out to local subscriber handles.
- [x] Coalesce concurrent local subscribe calls; detach a handle locally and remotely unsubscribe only after the last handle is removed.
- [x] Recreate the one-shot RPC client/transport after unexpected close; preserve the injected factory seam and intentional shutdown semantics.
- [x] Use a single-flight reconnect loop with bounded exponential backoff, cancellable on explicit broker shutdown, and a finite retry budget.
- [x] Re-subscribe only after the replacement socket is open; bind events to the new subscription ID and ignore stale events.
- [x] Never replay pending or uncertain state-changing RPC requests during recovery.
- [x] If a subscribe request has an uncertain outcome, query `session.subscriptions` and adopt the single active subscription only when unambiguous.
- [x] Keep trading fail-closed while recovery is underway and after resubscription until every active consumer explicitly acknowledges reconciliation.
- [x] Add deterministic tests for concurrent subscriptions, listener fan-out, handle cleanup, reconnect races, retry exhaustion, resubscribe failures, stale IDs, cross-reconnect duplicate events, late subscribers, repeated interruptions, and shutdown during recovery.
- [x] Isolate callback exceptions and preserve connection-close observability even without active user-data handles.

**6B.2 — reconciliation contract and integration verification (in progress)**

- [x] Complete deterministic account-update / execution-report duplicate and recovery-acknowledgement coverage in Phase 6B.1.
- [x] Document the consumer reconciliation procedure: `account.status` and `openOrders.status` for current snapshots; symbol-scoped `myTrades` / `allOrders` for available trade/order history. These cannot reconstruct every missed intermediate balance delta.
- [x] Add opt-in Binance TESTNET coverage for signature subscription, forced API socket disconnect, reconnect/resubscription, read-only account/order/trade reconciliation queries, and explicit recovery acknowledgement.
- [x] Add an additional opt-in event-receipt test gated by `BINANCE_TESTNET_EXPECT_USER_DATA_EVENT=1`; it requires external testnet activity while the test runs and never places an order.
- [~] Run the opt-in integration suite with real, read-only-capable Binance TESTNET credentials and record the result. The repository owner has reported configuring repository secrets `BINANCE_TESTNET_API_KEY` and `BINANCE_TESTNET_API_SECRET_KEY`; secret presence/value is intentionally not inspected by agents. The **Unit Tests** workflow's `run_broker_testnet_read_only` manual input rejects placeholders and hard-disables order mutations and externally triggered live-event checks. **Next: dispatch on `develop` and record the exact run/commit/results.** Use a dedicated TESTNET key with account-read access and Spot trading/withdrawal permissions disabled. Default CI remains offline.
- **Exit criteria:** deterministic recovery tests and opt-in testnet verification pass; callback/resource lifecycle is safe; consumer reconciliation is implemented by its owning domain; recovery acknowledgement contract is clear and adopted.

### Phase 7 — Remove the SDK and retire legacy REST implementation

- [x] Confirm repository consumers use the supported WebSocket broker contract.
- [x] Remove `@binance/spot` from `packages/brokers/package.json` and regenerate `pnpm-lock.yaml`.
- [x] Remove the legacy custom REST broker, REST signing/query helpers, listen-key transport, and obsolete REST-only examples/tests.
- [x] Reorganize the active implementation under `broker-websocket/` and retain the `BinanceSdkBroker` compatibility alias while exposing the WebSocket-native name.
- [x] Search the full repository for remaining `@binance/spot` imports and obsolete REST broker references.
- [x] Verify the production dependency audit and exact-head CI for PR #333.
- **Exit criteria:** met by PR #333; the active broker uses native WebSocket API/Streams clients and has no third-party runtime dependency.

### Phase 8 — Operational hardening and completion

- [x] Add opt-in Binance TESTNET integration coverage for connection, public stream, signed RPC, independently gated safe order lifecycle, and user-data events. Both `broker.integration.js` and `user-data-session.integration.js` are present, assert TESTNET endpoints, and require explicit opt-in plus non-placeholder credentials. This marks test coverage implemented, not live TESTNET execution.

  Offline safety regression: the native broker integration suite now creates its broker only inside the credential-gated setup hook, so missing credentials produce a clean skip instead of a module-load exception. The suite asserts both configured WebSocket endpoints are Binance TESTNET before connecting. A deterministic unit test launches both integration suites with dummy non-placeholder credentials but no opt-in flag and verifies that they exit successfully as skipped.
- [x] Require the explicit `BINANCE_TESTNET_INTEGRATION=1` opt-in in both native broker and user-data integration suites, in addition to non-placeholder credentials. The default unit suite proves both suites skip without network access even when dummy non-placeholder credentials are present.
  The opt-in flag is documented in `.env.example` and defaults to `0`. Live TESTNET protocol/order verification remains outstanding.
- [x] Add an independent `BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS=1` gate around the order create/check/cancel integration case. The general TESTNET opt-in continues to permit read-only checks without enabling order mutations. Deterministic guard tests and both configuration flags are documented. PR #530 passed all six required `develop` CI contexts on synchronized head `216c4eeea2268399c4d1507c279bd38fb56a016d`; the broker package reported 349/349 tests passing. Live order execution remains intentionally unrun until a TESTNET environment is explicitly configured.
- [x] Remove fixed microtask-count polling from user-data recovery unit tests. The fake scheduler now awaits asynchronous timer callbacks, and race tests await the session's recovery promise instead of relying on twelve `Promise.resolve()` turns.
- [x] Document supported Node versions, required API permissions, endpoints, reconnect semantics, rate-limit handling, failure modes, uncertain order outcomes, and safe shutdown in `packages/brokers/README.md` (PR #345).
- [x] Document the manual GitHub Actions TESTNET secret names, repository-secret scope, least-privilege permissions, and the distinction between the read-only workflow and the separately gated order-mutation integration case. The read-only workflow must use a TESTNET key with Spot trading/withdrawals disabled; extra trading permission is unnecessary even though the workflow's mutation flag is hard-disabled.
- [x] Audit and harden the manual TESTNET workflow's credential boundary. The prior job-level secret environment exposed credentials to checkout, tool setup, and dependency installation; placeholder matching was also case-sensitive, allowing uppercase placeholder values to reach integration suites that then skipped. Credentials are now scoped to the final integration step, and missing/placeholder validation fails closed regardless of placeholder casing. Order mutations and externally triggered event checks remain explicitly disabled. This workflow-policy hardening is not evidence of a live exchange run.
- [x] Verify broker package tests, full workspace tests, syntax checks, production dependency audit, and repository-required branch-protection checks. PR #548 passed all required CI contexts on synchronized head `e7b5a0df1ee3c2ee00de5f20c785e738e3b4baa4`; broker package tests reported 370/370 passing. PR #549 then passed the package coverage gate enforcing 90% lines / 80% branches / 80% functions.
- [~] Run opt-in TESTNET verification with explicitly configured credentials and record the exact runtime/environment/results; do not treat default CI as live protocol verification. The manual workflow performs read-only checks only. The repository owner reports that both required repository Actions secrets have been added; agents must not inspect or request their values. Before dispatch, verify the dedicated TESTNET key has account-read access and Spot trading/withdrawals disabled. **Pending manual dispatch on `develop` and evidence capture.** No live exchange requests/orders have been run as part of this documentation update.
- [x] Review broker runtime logging for secret leakage. Inspected all broker logger call sites and the signing/config/RPC paths: no API key, API secret, signature, signed request parameters, or authenticated payload is logged; diagnostics contain contextual messages and caught error objects only.
- [x] Review the remaining defensive Streams lifecycle branches. PR #555 adds deterministic coverage for obsolete initial-subscription cleanup when listeners change during reconnect, disconnect racing with the initial `LIST_SUBSCRIPTIONS` acknowledgement, and cancellation of the control-pump timer when its only queued request times out. The connection handshake now rechecks transport identity, open state, and manual-disconnect status after each awaited control request, so a superseded connection cannot issue stale unsubscribe/subscribe work. The request timeout clears the pump timer when no queued control work remains.
  The raw matcher’s fallback remains a defensive false result: `validateStreamName` is the only ingress into the desired-stream map and rejects unsupported names; the raw-event matrix covers every supported event family. The array recursion fallback is not used by dispatch: `#handleMessage` expands parsed array payloads before calling the matcher. PR #573 synchronized exact CI head `22a961bbb4565962ff86021002bbcc674c963f5c` passed all 5 required checks with 387/387 broker tests; `streams-client.js` measured 98.57% lines / 92.80% branches / 82.76% functions.
  Earlier lifecycle cleanup remains covered by PRs #347, #350, #351, #353, #354, #355, #357, #359, #361, #362, #365, #366, #532, #534, #543, #548, and #569.
- [x] Verify timers, sockets, pending requests, and listeners are cleaned up on shutdown and failure. Deterministic coverage spans transport connect/close timeouts and listener removal, RPC pending-request/timer settlement and listener removal, Streams reconnect/manual shutdown cleanup, user-data reconnect/stop/final-subscriber races, and broker dual-client shutdown. PRs #532, #534, #543, and #548 add the late replacement-client, late resubscription, transport close, and Streams pending-request cleanup regressions.
- **Exit criteria:** all required checks pass on the exact final PR head; opt-in integration results are recorded against the supported TESTNET environment; `develop` contains the verified implementation; all definition-of-done items in Section 1 are evidenced.

---

## 6. Test strategy and quality gates

### Test layers

1. **Pure unit tests:** parameter validation, signing payload construction, parsing, adapters, normalization, error mapping. No sockets, credentials, or network.
2. **Deterministic transport/RPC/stream tests:** inject fake socket and fake clock. Exercise lifecycle, correlation, timeouts, malformed messages, duplicates, concurrency, disconnects, cleanup, reconnect.
3. **Broker contract tests:** verify public methods and result/event shapes at the broker boundary.
4. **Opt-in integration tests:** connect to Binance testnet only when explicitly enabled and valid credentials are provided. These are not a substitute for deterministic tests and must not make default unit tests depend on the network.
5. **CI gates:** run package tests, workspace checks, syntax checks, dependency audit, and applicable branch-protection checks. Report results only for the exact commit being reviewed.

### Minimum failure matrix

Cover relevant cases across layers:

- invalid/missing parameters and unsupported stream names;
- socket constructor failure, connection timeout, send failure, close during connect;
- duplicate error/close events and messages after close;
- RPC API error, malformed envelope, missing/unknown ID, duplicate/late response;
- concurrent requests and out-of-order responses;
- timeout and pending-request cleanup;
- disconnect with pending read-only and state-changing requests;
- uncertain state-changing outcome with no automatic replay;
- subscription rejection, duplicate events, malformed event payloads;
- reconnect/resubscribe without duplicate callbacks;
- shutdown during active requests/subscriptions;
- secret/signature redaction from logs.

Do not create tests solely to inflate test count. Every test should protect a concrete contract, failure mode, or safety property.

### Fake infrastructure expectations

The fake WebSocket and fake clock are test tools, not deliverables by themselves. Each helper must be exercised by the implementation tests that need it. Keep their behavior close to the relevant WHATWG WebSocket/timer contract, and add behavior only when a real test requires it. Do not treat a fake socket test as proof that Binance's live protocol behavior is correct.

### Commands

Use the actual package scripts and workspace scripts from current manifests; verify them before assuming command names. At minimum, run:

- broker package deterministic tests;
- relevant workspace tests;
- JavaScript syntax workflow/check;
- production dependency audit;
- opt-in integration tests only when explicitly configured and safe.

Run narrow tests first, then broaden. Fix failures rather than hiding them or using empty commits to restart CI.

---

## 7. Agent operating procedure

Follow the repository-root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, and `AI_AGENT_WORKFLOW.md`. This package roadmap supplies broker-specific scope and technical constraints; it does not define a separate branch or release workflow.

### Before every task

1. Read this roadmap and [the broker contract audit](../../docs/brokers-websocket-contract.md).
2. Inspect the latest `develop`, relevant open PRs, complete affected files, tests, package scripts/manifests, and all consumers of changed exports or methods.
3. Identify the next incomplete phase and its acceptance criteria. Do not jump phases without recording the reason.
4. Confirm that the task belongs to `packages/brokers/**`. Route bot, entity, utility, or other domain changes through the cross-domain request process.
5. Check for overlapping task branches/PRs and coordinate rather than overwriting another agent's work.

### During implementation

- Create a short-lived branch from the latest `develop`, named `feature/brokers/<task>` or `fix/brokers/<task>`.
- Keep changes within broker ownership. Do not modify bot application files or another package's implementation.
- Keep functions small, deterministic, and testable; prefer pure helpers for parsing, normalization, and mapping.
- Add deterministic tests for changed behavior and important failure paths.
- Do not add runtime dependencies without explicit justification and a roadmap decision.
- Do not use real credentials or live network calls in default tests.
- Never blindly replay a state-changing request after an uncertain disconnect.

### Before opening a PR

1. Synchronize the task branch with the latest `develop`; never rebase or force-push shared history.
2. Review the complete diff for unrelated changes, secrets, generated noise, and ownership violations.
3. Run narrow tests, broker package tests, relevant workspace tests, syntax checks, and dependency audit as applicable.
4. Open a focused PR targeting `develop` with scope, compatibility impact, test evidence, exact checked commit, and remaining limitations.
5. The responsible agent may merge after all required CI, freshness, and ownership gates pass. Routine human approval is not required for `develop`.

### Stop and ask the user when

- Official Binance documentation conflicts with this roadmap or leaves a security-critical behavior ambiguous.
- Native Node WebSocket cannot be proven to satisfy Binance's ping/pong or lifecycle requirements.
- A change would alter a public export, consumer contract, runtime floor, credentials, or third-party dependency policy.
- A cross-domain contract change cannot be agreed with affected owners.
- A test requires live credentials, a real order, or a potentially destructive exchange action.
- CI failures cannot be diagnosed safely.

## 8. Documentation and decision records

Keep these files aligned:

- `packages/brokers/ROADMAP.md` — package mission, decisions, phases, agent procedure, status, and acceptance criteria. This is the primary starting point for broker work.
- `docs/brokers-websocket-contract.md` — detailed Phase 0 source inventory, public contract, method mapping, old implementation findings, and official protocol references.
- Root `ROADMAP.md` — project-wide engineering roadmap and links to package-level roadmaps; do not move broker protocol implementation details back into the root file.

When a new discovery changes an implementation decision:

1. Verify it against current source, tests, consumer usage, and official documentation.
2. Update this roadmap and the contract audit where appropriate.
3. Record the date, old decision, new decision, evidence, and affected phases in the decision log below.
4. Only then continue implementation.

### Decision log

| Date | Decision | Reason / evidence | Impact |
|---|---|---|---|
| 2026-10-31 | Raise the native WebSocket runtime floor from Node.js >=22.4.0 to >=22.23.4 and guard the bundled Undici version. | User approval after discovery of CVE-2026-109932; Node.js 22.23.4 bundles fixed Undici 6.29.1. Runtime guard also rejects affected Undici 6.29.0, 7.30.0, and 8.12.1 or older affected releases. | Package `engines`, Phase 2 transport, and CI runtime pin. |
| 2026-10-31 | Use WebSocket API connection for RPC and signature-based user-data subscription/events; use separate public Streams connection for market data. | Phase 0 SDK/source and official Binance protocol audit. | Phases 2–6; do not mix user-data events into public Streams. |
| 2026-10-31 | Preserve `userDataStream.subscribe.signature` with existing HMAC `apiKey` + `apiSecret`; do not require Ed25519 or `session.logon`. | Current SDK behavior and official Binance documentation reviewed in Phase 0. Exact signing payload still requires test vectors. | Phase 3 signing and Phase 6 lifecycle. |
| 2026-10-31 | Never blindly replay state-changing requests after uncertain disconnects. | Order placement/cancellation may have succeeded remotely even if response was lost. | RPC design, broker result contract, recovery tests. |
| 2026-10-31 | Do not edit bot application files during this migration. | Other teams are actively developing bot behavior; avoid conflicts and preserve ownership. | All phases; consumer source is read-only audit evidence. |
| 2026-10-31 | Treat `eventStreamTerminated` as an explicit subscription lifecycle signal, not an order/account event. | Binance Spot User Data Streams documentation defines the event and its termination causes. | Phase 6 lifecycle state machine and tests. |
| 2026-10-31 | Treat a socket interruption as an unrecoverable event-history gap; do not use event timestamps as a global sequence cursor. | Binance user-data event schemas expose event/transaction timestamps and execution IDs, but no universal replay cursor. | Phase 6 status signaling, idempotency, and reconciliation. |
| 2026-10-31 | Reconcile current account/order state from WebSocket API snapshots after recovery; do not claim snapshots reconstruct missed intermediate events. | `account.status`, `openOrders.status`, `myTrades`, and `allOrders` provide current or queryable state, not a replay log for every event. | Phase 6 recovery contract. |

---

## 9. Pull request and integration policy

- Each broker task uses a short-lived branch created from the latest `develop`.
- Every task PR targets `develop`; do not open new work against `migration/binance-native-ws`, `feature/brokers`, or `main`.
- Keep PRs focused on one broker task or a tightly coupled implementation/test/documentation change.
- A task is complete only after its PR is integrated into `develop`, all required checks pass, and this roadmap reflects the verified result.
- The responsible agent may merge a task PR after CI, target freshness, and ownership gates pass. No routine human approval is expected for `develop`.
- Keep all ongoing implementation and integration work on `develop`; do not create or manage release branches/PRs as part of a package task. Any separate release workflow requires an explicit user request.
- Do not claim a phase complete merely because a PR is open or CI has started.

Historical references to `migration/binance-native-ws` and its phase PRs above describe where earlier work was developed. They do not authorize new work on that retired long-lived branch.

---

## 10. Synchronization with the shared development branch

### Task branch synchronization

1. Before starting and before finalizing a task, fetch the latest `develop` and inspect changes affecting broker contracts, consumers, runtime, dependencies, tests, or documentation.
2. Merge the latest `develop` into the short-lived task branch. Preserve merge history; do not rebase or force-push shared history.
3. Resolve conflicts by reconciling complete files and preserving both domains' valid changes. Never blindly choose ours/theirs.
4. Re-run relevant broker tests, workspace checks, syntax checks, and dependency audit.
5. Verify required CI on the exact final PR head and confirm that the PR is up to date with `develop`.

### Shared develop branch policy

- `develop` is the only shared integration branch for ongoing implementation work in this repository.
- Create every task branch from the latest `develop`, keep it synchronized with `develop`, and target every implementation PR at `develop`.
- Do not independently update, synchronize against, or open task PRs targeting another branch.
- Release planning is a separate user-directed activity and is outside this package roadmap.
- Do not claim continuous background monitoring. Recheck branch state at task start, before opening a PR, and before reporting completion.

## 11. Official protocol and runtime references

Re-check these official sources during implementation because Binance protocol details and limits can change:

- [Binance Spot WebSocket API — Account](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/account)
- [Binance Spot WebSocket API — Trade](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/trade)
- [Binance Spot WebSocket API — General](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/general)
- [Binance Spot WebSocket API — Market](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/market)
- [Binance Spot WebSocket API — User Data Stream](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/user-data-stream) — includes `session.subscriptions`, signature subscription, and subscription-scoped unsubscribe request/response schemas.
- [Binance Spot API changelog](https://github.com/binance/binance-spot-api-docs/blob/master/CHANGELOG.md) — 2025-08-12 documents one subscription per account per WebSocket API connection, HMAC signature subscription without Ed25519 login, and `session.subscriptions` listing.
- [Binance Spot WebSocket Streams — General](https://developers.binance.com/en/docs/products/spot/web-socket-streams)
- [Node.js v22 Global WebSocket documentation](https://nodejs.org/download/release/v22.23.4/docs/api/globals.html#class-websocket)
- [Node.js v22.23.4 release notes](https://nodejs.org/en/blog/release/v22.23.4) — includes Undici 6.29.1.
- [Binance Spot WebSocket API — protocol, responses, HMAC signing](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-api.md) — request IDs are echoed, responses use `status` plus `result` or `error`, and HMAC-SHA-256 signs alphabetically sorted UTF-8 `key=value` parameters.

The [Phase 0 broker contract audit](../../docs/brokers-websocket-contract.md) records the sources reviewed and the findings at that audit date. Official docs remain authoritative if they change.

## 12. Cross-domain contract adoption

### Exact account balances (request #310)

- [x] Additive `getBalances()` API returns canonical Entities `Balance` values with exact free/locked `Quantity` amounts and a derived total (PR #312).
- [x] Preserve legacy `getAssets()` and its `Coin` result shape for compatibility; do not use its Number-based values for financial reconciliation.
- [x] Keep raw Binance asset codes intact when constructing canonical Asset identities; do not rewrite prefixed codes into another asset.
- [x] Include zero balances in the canonical snapshot so consumers can distinguish a confirmed zero from an omitted/unreported asset.

### Timestamped reconciliation snapshot ports (request #316)

- [x] Add `getServerTime()` using Binance `time` and `getAccountSnapshot()` exposing canonical balances with account `updateTime`.
- [x] Add validated `fromId` pagination to `getMyTrades()` and canonical `getFills()`, plus time-window filters to `getOrderHistory()` while preserving existing result shapes.
- [x] Validate response-side trade, fill, and order cursor IDs before exposing them; reject values outside JavaScript's safe-integer range ([PR #322](https://github.com/45s/coinzilla/pull/322)).
- [x] Keep full pages potentially incomplete by returning unchanged array results without a false `complete` claim; tests prove inclusive cursors can continue from the last returned ID + 1 without duplicates.

### Canonical order-history records (request #321)

- [x] Add additive `getCanonicalOrderHistory()` returning immutable Entities `CanonicalOrder[]` while preserving the raw `getOrderHistory()` compatibility contract. Broker implementation and deterministic adapter/broker tests are complete on `develop`; consumer adoption remains a separate domain-owned task.
- [x] Extend `getOrder()` to accept exactly one of `orderId` or `clientOrderId`; only Binance `order.status` error `-2013` maps to a successful `data: null`. Implemented and verified in PR #573, merged into `develop` at `c146309ac7edf1d525670b5cb7f8bda751d4b9a5`; 387/387 broker tests and the coverage gate passed.
- Use exact `exchangeInfo` metadata for Market/Asset identity, preserve decimal strings and source timestamps, and map unsupported lifecycle states to canonical `UNKNOWN` without leaking Binance field names.
- Reject unsupported order types, malformed records, and unsafe numeric IDs; do not convert financial values through JavaScript `Number`.

## 13. Shared Entities contract adoption

### Canonical fills and commissions

- [x] Additive `getFills({ symbol, orderId?, fromId?, startTime?, endTime?, limit? })` returns immutable Entities `Fill` values backed by canonical `Market`, exact `Money`/`Quantity`, and `Commission` values. Broker API and deterministic adapter/broker tests are complete on `develop`; consumer adoption remains a separate domain-owned task.
- [x] Add `getExchangeMarkets()` to return canonical `Market` values for every symbol in the current unfiltered Binance `exchangeInfo` catalog and prime the broker's canonical market cache; delisted symbols remain outside this catalog.
- Preserve `getMyTrades()` and its existing plain-object result shape for current consumers; do not silently migrate application consumers in this Brokers-owned change.
- Derive base/quote Asset identity only from the exact Binance `exchangeInfo` response for the requested symbol. Do not parse or split venue symbols.
- Preserve exact exchange decimal strings. Unknown commission denomination remains `UNKNOWN`; a confirmed zero commission is `COMPLETE` with an empty collection.
- Canonical fill API implementation is present on `develop`; consumer migration remains separately owned by the consuming application domains.

## Accepted cross-domain capability — Harvester book ticker (#506)

- [x] Expose Binance `bookTicker` through the additive `subscribeForBookTicker({ symbol, onBookTicker })` broker method while preserving the aggregate-trade `subscribeForPrices` contract. Broker API, immutable exact-string adapter, deterministic adapter/subscription tests, and README documentation merged in PRs #507 and #510; Harvester's fresh best-bid/best-ask POST-ONLY crossing validation and shutdown coverage merged in PRs #508 and #509.

## 14. Mandatory autonomous DDD refactoring execution

**Architecture source of truth:** [Brokers Package Architecture](./ARCHITECTURE.md). It defines the proposed target tree, dependency rules, responsibility map, TDD method, and phase exit criteria. This section tracks execution status; update both documents together when evidence changes.

### DDD documentation and audit status

- [x] Target architecture, dependency rules, and proposed tree documented in [ARCHITECTURE.md](./ARCHITECTURE.md).
- [x] Existing user-data recovery vertical slice and current import direction documented.
- [x] Package-wide responsibility/import and consumer audit is complete: production module imports, dependency direction, state ownership, test/coverage baseline, and both workspace consumers are recorded in ARCHITECTURE.md.
- [x] Confirmed that the user-data infrastructure adapter slice is merged (PR #605); do not repeat it.
- [x] Phase 9 slices 1–10 are merged, including complete Binance Infrastructure placement (PR #697) and executable dependency/public API enforcement (PR #704).

**Single implementation tracker:** use [Phase 9 — DDD/TDD architecture refactor](./ROADMAP.md) below for implementation slices, status, and next action. The architecture document defines the target and current baseline; this section must not become a second phase tracker.

**Current next action:** Phase 9 is complete. Phase 8 remains open because read-only TESTNET account reads and recovery assertions have not passed. PR #720 merged into `develop` at `39f6ab666523cdee937f3003944dbc291f62a52e`; diagnostic PR #721 merged at `07cb9d3caef5232cfaa9c51954de91b3bc1ccd59`. The credential-free GitHub Actions probe confirms that the hosted runner's Spot TESTNET API upgrade is denied with HTTP 451 and Binance's restricted-location eligibility response, while the TESTNET Streams endpoint upgrades successfully with HTTP 101. Do not retry the manual read-only account/recovery workflow on that runner. Do not ask the operator to change location. The hosted Spot TESTNET account API path is paused because the runner receives HTTP 451 with Binance's restricted-location eligibility response. Keep Phase 8 UNVERIFIED/PAUSED until an eligible, authorized environment is independently available. Do not retry the same blocked runner. Continue offline DDD/TDD work, deterministic tests, and CI. Any later read-only account/recovery validation and controlled soak still require separate authorization and must keep both safety flags preserved. Keep order mutation and externally generated user-data events disabled; preserve fail-closed reconciliation.

**Important distinction:** WebSocket protocol/lifecycle hardening and DDD architecture migration are separate tracks. Preserve completed reliability work and its coverage. The goal is the correct Domain → Application/Ports → Infrastructure ownership, not adding more WebSocket layers.

The DDD modernization is an internal refactor of a working package. **Do not rebuild or replace the working broker.** Preserve public contracts, runtime behavior, exchange integrations, result/event semantics, exact decimal handling, and consumer compatibility while improving internal boundaries.

- Work only in `packages/brokers/**` unless a separately authorized repository-level metadata change or cross-domain request requires otherwise.
- Characterize existing behavior first. Follow strict RED → GREEN → REFACTOR in small vertical slices; run deterministic tests after each change and maintain the package coverage gates. Do not weaken or delete existing tests to make a refactor pass.
- Create as many focused PRs as necessary. Each task branch is short-lived, starts from the latest `develop`, and targets `develop`. Multiple coherent commits per task branch are encouraged.
- The agent owns the full delivery loop: implement, test, document, synchronize, open PR, inspect CI, merge when safe, clean up, update this roadmap, and start the next task. **Do not stop to request routine user approval or wait for the user to ask you to continue.**
- Merge a task PR into `develop` once its exact head is current with `develop`, all required CI checks are green, broker package tests and applicable coverage pass, the diff is focused, and existing broker behavior/compatibility has been verified. No routine human approval is required for task PRs into `develop`. Never bypass branch protection or merge with pending/failed/missing required checks.
- After merge, verify the merge, update task status here, delete the source branch when no longer needed, and start the next incomplete DDD slice from the latest `develop`. Repeat until the refactor scope is complete.
- A task is not complete merely because code or a PR exists. Every slice must be well tested, documented, CI-verified, and merged. A green CI badge does not excuse a behavior or compatibility regression.
- If a genuine blocker prevents safe merge, state the exact blocker and evidence; fix it where possible and continue with independent safe tasks. Never claim tests were run when they were not.

### Phase 9 implementation slice 10 — executable dependency-direction enforcement (PR #704)

**Scope:** architecture enforcement and public API contract characterization only. No Binance WebSocket internals, runtime behavior, consumer adapter, or public export was changed.

- [x] Add the architecture contract test before its scanner implementation (RED stage). The RED-stage commit was `b5410b217fac6ab20b272dec87b1e980e603422e`; GitHub Actions reported the Brokers unit-test and coverage jobs failed on that intentionally incomplete test commit. The TESTNET job was skipped.
- [x] Add the Node-built-in scanner in `src/test-helpers/architecture-boundaries.js`; no dependency was added.
- [x] Enforce Domain → no Application/Infrastructure/Bootstrap; Application → no Infrastructure/Bootstrap; Infrastructure → no Bootstrap. Bootstrap composition and Infrastructure → Application/Domain remain allowed.
- [x] Add synthetic negative/control cases proving forbidden imports are detected and inward/composition imports are accepted.
- [x] Add `src/index.contract.test.js` for the exact four root exports and public Binance broker construction/method availability without connecting.
- [x] Verify the real source graph and all package/consumer checks on the final PR head. Verified source/test commit `be7e0a9ec3f5d09533cc6446cc5c4177e83b79d0` passed: Brokers unit tests 411/411; Brokers coverage 98.73% lines / 93.62% branches / 94.94% functions against 90/80/80 thresholds; all workspace unit-test and coverage jobs; Harvester targeted regressions; JavaScript syntax; actionlint; production dependency audit. TESTNET integration was skipped. The documentation-only follow-up `43caec1a636b289e97e7ac1ee1b93b019af744fa` was included in final PR head `f611175838f99cf1861ab7a0a9b0e9fee849723c`; all required checks passed on that exact head and PR #704 was merged.

**Exact contract coverage:** `src/architecture-boundaries.test.js`; `src/index.contract.test.js`; existing `src/infrastructure/binance/broker-websocket/broker.test.js` and operation suites under `src/infrastructure/binance/broker-websocket/tests/`; `src/infrastructure/binance/adapters/*.test.js`; `src/infrastructure/binance/user-data-client-adapter.test.js`; `src/infrastructure/binance/broker-websocket/helpers/adapters/user.test.js`. Harvester compatibility passed in the repository's `harvester-targeted-tests.yml` workflow on the verified source/test commit.

**Closeout:** PR #704 merged into `develop` at `216f7c8397d83837c4e6d3202778469c2a4e85bf`. Its final head `f611175838f99cf1861ab7a0a9b0e9fee849723c` passed Brokers unit tests (411/411), Brokers coverage (98.73% lines / 93.62% branches / 94.94% functions), workspace tests and coverage, Harvester targeted regressions, JavaScript syntax, actionlint, and production dependency audit. TESTNET was intentionally skipped. GitHub automatically removed the merged task branch (verified absent from branch search). Phase 9 is complete; Phase 8 remains pending its manual read-only TESTNET run and controlled soak validation.

## 2026-11-08 — read-only TESTNET handshake failure

- Workflow: [Unit Tests run #42483880274](https://github.com/45s/coinzilla/actions/runs/42483880274), manual dispatch on `develop`.
- Exact tested commit: `6236f49dca53a2938b016b52802f907c90611b44`.
- Result: all nine package unit-test matrix jobs passed; the opt-in `Run read-only Binance TESTNET integration` job failed.
- Failure point: `BinanceWebSocketBroker.connect()` during the native WebSocket handshake. The captured error is a blank-message `TypeError` whose stack enters Node.js bundled Undici at `failHandshake` / `processResponse` / `#onSocketClose`. The broker setup failed before account reads or user-data recovery assertions could run; downstream “test did not finish” cancellations follow from setup failure.
- Environment: workflow used Node.js 24.x and TESTNET-only endpoints asserted by the integration tests (`wss://ws-api.testnet.binance.vision/ws-api/v3` and `wss://stream.testnet.binance.vision/ws`). The owner confirms the configured credentials are Binance Spot TESTNET credentials with trading permissions. Secret values were not inspected or recorded.
- Safety: `BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS=0` and `BINANCE_TESTNET_EXPECT_USER_DATA_EVENT=0`; order placement/cancellation and externally generated user-data event tests remained skipped. Do not enable either flag as a diagnostic shortcut.
- Interpretation: this run does not establish that credentials or account permissions are invalid. The observable failure is at WebSocket handshake time, before read-only broker operations. The missing `.env.development` message is informational in CI; the workflow injects credentials through GitHub Actions secrets.
- Next: inspect safe handshake diagnostics (HTTP upgrade status when available, close code/reason, and underlying error cause) without logging credentials or signing material; verify TESTNET endpoint reachability and Node.js 24/Undici behavior from the runner; add a deterministic transport regression for the observed failure shape if reproducible. Re-run only the read-only workflow after a focused fix. Keep reconciliation fail-closed and order mutation disabled. A successful read-only run is still required before controlled live recovery/soak.

## 2026-11-08 — native WebSocket handshake diagnostics (PR #721)

- PR #720's documentation-only checkpoint merged into `develop` at `39f6ab666523cdee937f3003944dbc291f62a52e`; its exact head `b913a1c3024d476441a8c5844ac9e62c12d71997` had six successful CI workflows (JavaScript Syntax, Dependency Audit, Test Coverage, Utils Unit Tests, Unit Tests, and Harvester Targeted Tests).
- The failed run #42483880274 used Node.js `v24.22.2`. The failure reached `NativeWebSocketTransport.connect()` and Node's bundled Undici `failHandshake`; the old transport forwarded only `event.error`, losing the ErrorEvent message and the subsequent close code/reason. The runtime guard had allowed transport construction, so the runtime met the guard's supported Node/Undici floor; the original run did not print the exact bundled Undici version.
- The WHATWG WebSocket error event does not guarantee an HTTP upgrade status. The transport now records an HTTP status/statusCode only when the runtime exposes a valid numeric value; otherwise it explicitly reports it unavailable. It retains a sanitized underlying error name/message/stack, close code, close reason, and clean-close state. Sensitive-looking credential fields and URLs are redacted; endpoint URLs, headers, credentials, signatures, and RPC payloads are never included.
- Exact-head GitHub Actions evidence: Node.js `v24.22.2`, bundled Undici `7.30.1`, runtime guard passed. A raw unauthenticated HTTP WebSocket upgrade to the Spot TESTNET API returned HTTP `451` with Binance's response `Service unavailable from a restricted location according to 'b. Eligibility'`; the API's native WebSocket failed with Undici `TypeError` and close `1006`. The raw Spot TESTNET Streams upgrade returned `101` with a valid `Sec-WebSocket-Accept`, and Node's native WebSocket opened. Thus runtime/protocol compatibility are verified; the API failure is the runner's location eligibility restriction, before authentication. The response does not identify the intermediary enforcing the restriction.
- The diagnostic step reports the API restriction but is non-blocking, so the broker package tests and CI remain green. No account request or recovery assertion was run: the manual read-only integration job is skipped in PR CI and must not be retried on the same restricted runner.
- Added deterministic transport tests for an Undici-style blank-message `TypeError`, optional HTTP status metadata, abnormal close code/reason, underlying cause retention, and redaction. The transport waits for close (bounded by the existing close timeout) before rejecting a failed handshake so close diagnostics are attached to the error delivered to the broker. Established-connection error classification remains separate.
- Added a credential-free TESTNET probe to the manual read-only workflow and the `@coinzilla/brokers` pull-request matrix job. It sends raw unauthenticated WebSocket upgrade requests to the configured Spot TESTNET API and Streams endpoints, captures the HTTP upgrade status/body when rejected, validates the WebSocket accept hash on HTTP 101, and separately exercises Node's native WebSocket implementation. It prints Node.js and bundled Undici versions and checks the existing runtime guard. It sends no credentials, RPC messages, signatures, or order operations. Both workflow invocations are non-blocking; the manual job still runs the original read-only integration and reports its own result.
- PR #721: [diagnose native TESTNET WebSocket handshake failures](https://github.com/45s/coinzilla/pull/721), merged to `develop` as `07cb9d3caef5232cfaa9c51954de91b3bc1ccd59`. Exact head `ad48ae4bb71d81d0318a031f101f582a67cca083` passed JavaScript Syntax/actionlint, Dependency Audit, Utils Unit Tests, Harvester Targeted Tests, all nine workspace package-test jobs, and all package plus workspace coverage jobs. Brokers: 414/414 tests passed; coverage 98.72% statements, 93.39% branches, 94.98% functions. The read-only TESTNET integration job was skipped because the PR event is not the manual workflow dispatch.
- Safety remains unchanged: `BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS=0`, `BINANCE_TESTNET_EXPECT_USER_DATA_EVENT=0`, and no changes to order safety, reconciliation, or recovery acknowledgement gates. Phase 8 remains incomplete pending successful read-only account/recovery validation and a controlled live recovery/soak.

## 2026-11-08 — established-socket Undici diagnostic correlation characterization

Cross-domain request [#680](https://github.com/45s/coinzilla/issues/680) asks whether the native Node.js WebSocket runtime exposes an underlying socket error that can be safely attributed to the affected WebSocket client.

- Undici documents `undici:websocket:socket_error` as publishing the underlying `Error` object only. The separate `undici:websocket:open` and `undici:websocket:close` channels include a `websocket` instance, but the socket-error channel does not include that instance or another documented connection identifier.
- A process-wide subscriber cannot safely assign an uncorrelated socket error to the Binance WebSocket API socket versus the public Streams socket when both are active. Timing-based or last-opened-socket attribution would risk false diagnosis.
- Added `utils/undici-socket-error-diagnostics.test.js`, an offline local-WebSocket characterization test. It opens a real Node native WebSocket against a loopback HTTP upgrade server and forces a post-connect peer reset without a WebSocket close frame. On Node 24.x the connection closes with code 1006, the `open` and `close` diagnostics identify the WebSocket instance, but `undici:websocket:socket_error` emits no event for this reset. Thus the channel is not guaranteed to provide an underlying error for every abnormal close; when it does publish, its documented payload is only an Error and has no documented WebSocket identity.
- The first exact-head CI attempt on `14641d2d5e08a4e0fb6a51adb28cbe74c7bb013c` ran 415 Brokers tests: 414 passed and the new characterization failed because it expected one socket-error event but observed zero. That failure is the runtime evidence; the test was corrected to assert the observed silent-channel behavior for this close path.
- This is characterization only: no global diagnostics subscriber, socket monkey-patch, timing heuristic, production transport behavior, public broker contract, or dependency was added.
- **Verified and merged:** PR #725 merged into `develop` as `bf9e51e298535cf14f113343a5216f4b8a1ec80f`; exact tested head `b50d453d8846e82a2918b5d4752dfc8d81412ceb`. Brokers tests passed 415/415, Brokers coverage passed, and all six required offline CI workflows passed. The corrected test confirms the silent `socket_error` channel on the reproduced post-connect 1006 reset.
- **Disposition:** established-socket diagnostic characterization is complete as a documented Node/Undici limitation for this failure shape. No safe per-client error correlation is exposed by the tested runtime. Do not add timing-based attribution or a global monkey-patch. Cross-domain issue #680 may be closed as investigated/documented; revisit only if a supported runtime exposes a reliable per-WebSocket socket-error correlation.

## 2026-11-08 — multi-subscriber terminal recovery notification count

Cross-domain request [#702](https://github.com/45s/coinzilla/issues/702) includes a broker-owned proof requirement that is independent of the still-open public acknowledgement-result contract.

- Added exact per-subscriber assertions to the existing two-subscriber reconnect/recovery regression: the first local acknowledgement remains recorded-but-globally-pending (legacy boolean `false`), the final acknowledgement completes recovery, each still-active subscriber receives exactly one `reconciled` status for subscription `110`, and a repeated acknowledgement cannot publish another terminal status.
- Asserted the acknowledgement reminder timer is cleared at global completion and the existing order-mutation gate remains blocked until that point.
- Added a second regression proving that when the first subscriber has acknowledged and the second disconnects, the remaining active subscriber receives exactly one terminal `reconciled` status while the removed subscriber receives none.
- No broker source, public API, Harvester consumer, or acknowledgement return semantics changed. The additive result-shape proposal remains pending owner agreement.
- Exact-head CI verification is pending; do not mark the cross-domain contract issue complete until the agreed public acknowledgement semantics and consumer compatibility work are resolved.

## 2026-11-11 — Binance account filter coverage / Harvester #957

The Binance `getSymbolFilters` path now retrieves authenticated `myFilters` alongside public `exchangeInfo` and passes account symbol, exchange and asset filters to the adapter. Retrieval failure or incomplete response shape is fail-closed. Applicable constraints not yet evaluated by the trading domain are surfaced as exchange-neutral metadata for the Harvester readiness gate.

This work is in an open task PR targeting `develop`; do not mark it complete until exact-head broker tests, workspace CI and the linked Harvester readiness regressions pass. See [Harvester exchange trading constraints](../../apps/harvester/docs/exchange-trading-constraints.md) for the cross-domain contract.

## 2026-11-16 — Bitunix Spot broker foundation

**Status: In progress — read-only adapter foundation; not Harvester-ready.**

- Added a separate `infrastructure/bitunix/` REST integration, validated live-only configuration, Bitunix REST signing/client, canonical market and balance adapters, and legacy order mapping. No canonical fill adapter is enabled because the matching-order contract is incomplete.
- Added `BitunixSpotBroker` behind the existing `CoreBroker` compatibility base and exported it from the package entry point. Supported reads cover market catalog/metadata, balances, per-symbol pending orders/history, order detail, and latest-price lookup. `getFills()` remains explicitly unsupported and sends no request. Order-history reads support canonical status/side/type filters, mapped to Bitunix API codes within infrastructure.
- Order quantity adaptation uses shared exact decimal subtraction and retains exact original/executed/remaining strings. Active market discovery now fails closed for missing or unknown `isOpen` values, exposing only explicitly open pairs. No Binance protocol code is reused.
- Order placement and cancellation are explicitly disabled. Bitunix Spot has no documented client-order ID; a lost placement response therefore cannot be reliably reconciled. Private Spot WebSocket docs do not define continuous order/execution events, and public market WS methods are request/response rather than subscriptions.
- `getAccountSnapshot()` fails closed because the account response has no source timestamp. Open orders and order history require a symbol. Canonical order methods fail closed because Bitunix does not provide the required client-order identity. The documented `order/deal/list` response is a single matching-order object with no pagination contract; completeness for orders with multiple executions remains unverified.
- Bitunix's official API repository confirms that no TESTNET environment is currently provided and that there is no clear plan for one ([BitunixOfficial/open-api#4, maintainer response](https://github.com/BitunixOfficial/open-api/issues/4#issuecomment-3434841476)). The single-order REST endpoint says limit `volume` is quote quantity and market `volume` is base quantity, while the REST batch-order and WebSocket order docs say the inverse. No order submission or quantity conversion is attempted until clarified.
- Offline tests cover signing, REST transport, lossless account-balance parsing, config, adapters, supported reads, unsupported operations, and exact quantity arithmetic. The first PR CI run exposed four export/assertion expectation mismatches; those were corrected and the suite was expanded. PR #1182 was merged as the read-only foundation; PR [#1183](https://github.com/45s/coinzilla/pull/1183) added canonical order-history filters and fail-closed active-market discovery. On exact PR #1183 head `f7ac16d08a00cfdec7b3b54dec8bfc554254f0fa`, broker/workspace tests and coverage thresholds, syntax/changed-file lint, external documentation links, dependency audit, actionlint, and Harvester regression checks passed. Binance TESTNET integration was skipped; no Bitunix live API calls or order mutations were performed.
- The 2026-11-16 read-side re-audit found no newly documented capability that safely changes the supported surface: order-history pagination/completion semantics, matching-order identity/completeness, depth precision selection, OHLCV volume, source timestamps, and continuous Spot subscriptions remain unresolved. The JKorf Spot `GetUserTradesAsync` implementation also currently targets `order/pending/list` despite its interface documenting `order/deal/list`; it is not valid evidence for fill retrieval. Detailed source findings are tracked in [issue #1185](https://github.com/45s/coinzilla/issues/1185).
- See the [Bitunix capability contract](../../docs/brokers-websocket-contract.md#bitunix-spot-capability-contract) and [package README](./README.md#bitunix-spot-integration).

**Remaining work before any trading use:** obtain written Bitunix clarification of the single-order versus batch-order quantity units; establish a stable exchange-supported client order identity or authoritative race-safe reconciliation; prove complete per-execution history semantics; establish a documented Spot private order/execution stream or source-timestamp-preserving polling/recovery contract; verify Spot TESTNET or another isolated mutation environment; and add canonical order/account lifecycle support only after the exchange supplies the required facts. Other read-only mappings remain blocked where the API omits canonical facts (OHLCV volume) or leaves required parameters undefined (depth precision selection).

## Bitunix Spot — Binance broker parity audit (2026-11-16)

**Audit baseline:** `develop` at `65cec77b9f0c182c5f506654a7e33df2909b6a67`, after PRs [#1182](https://github.com/45s/coinzilla/pull/1182), [#1183](https://github.com/45s/coinzilla/pull/1183), [#1188](https://github.com/45s/coinzilla/pull/1188), [#1195](https://github.com/45s/coinzilla/pull/1195), and repository workflow PR #1200. The latter changed agent handoff documentation only; the broker source baseline is unchanged. This is a source/API parity inventory, not a claim that every Binance capability is appropriate or available on Bitunix.

### Implemented Bitunix surface

| Capability / method | Current status | Implementation / limitation |
|---|---|---|
| `connect()` / `disconnect()` | Implemented | Stateless REST adapter readiness flag; no persistent socket lifecycle. |
| `getBalances()` | Implemented, read-only | `GET /api/spot/v1/user/account`; raw balance numeric tokens are preserved as decimal strings. |
| `getAssets()` | Implemented, read-only compatibility | Uses the same account response; combines free and locked amounts exactly before converting to legacy `Coin.value` Numbers and omits exact zero balances. Use `getBalances()` for exact financial values. |
| `getExchangeMarkets()` | Implemented, read-only | `GET /api/spot/v1/common/coin_pair/list`; only explicitly open pairs are returned; symbol is derived from base + quote. |
| `getSymbolFilters({ symbol })` | Partial | Returns raw Bitunix pair metadata. The pure Harvester mapping in [PR #1209](https://github.com/45s/coinzilla/pull/1209) maps documented `minPrice`/`minVolume` to canonical `MIN_NOTIONAL`/`MIN_QUANTITY`; precision increments, depth precision, and undocumented maximum fields remain unresolved. |
| `getOpenOrders({ symbol })` | Implemented, read-only | `POST /api/spot/v1/order/pending/list`; symbol is mandatory. Accepts documented object/array rows and explicit empty arrays; missing or `null` data is rejected. No account-wide request or complete cross-symbol enumeration is documented. |
| `getOrderHistory({ symbol, ...filters })` | Implemented, read-only | `POST /api/spot/v1/order/history/page`; canonical status/side/type filters mapped to Bitunix codes; symbol mandatory; no exact order-ID filter. |
| `getOrder({ symbol, orderId })` | Implemented, read-only | `GET /api/spot/v1/order/detail`; validates returned order ID and symbol. String IDs are canonical; safe-integer numeric compatibility IDs are accepted and unsafe numeric IDs are rejected. No client-order-ID lookup. |
| `getPrices({ symbol })` / `getPrice()` | Implemented, read-only | `GET /api/spot/v1/market/last_price`; requires a strictly positive decimal string and preserves it exactly; one-shot lookup with no source timestamp. |
| `getFills({ symbol, orderId })` | Blocked | Deliberately returns unsupported without making a request. The Spot matching-order response does not define whether `volume` is base or quote quantity, whether all partial executions are represented, or whether `id` is stable/unique for deduplication. |
| REST signing / transport | Implemented | Double-SHA256 signing, bounded request timeout, response/error validation, no automatic retry. No live exchange acceptance is claimed. |

### Binance public broker methods — parity inventory

The method names below are the concrete Binance broker surface compared with `BitunixSpotBroker`. “Blocked” means the method is present but deliberately returns an unsupported result or throws; do not remove that guard until the listed prerequisites are satisfied.

| Binance capability / method | Bitunix status | What is missing to reach equivalent behavior |
|---|---|---|
| `getAssets()` | Implemented, compatibility-only | Maps account `balance` + `balanceLocked` to non-zero legacy `Coin.value` values; exact addition precedes Number conversion. Do not use for financial reconciliation; use canonical `getBalances()`. |
| `getBalances()` | Implemented | No major read capability gap; retain exact decimal parsing and validate all asset rows. |
| `getAccountSnapshot()` | Blocked | Source timestamp/version and a coherent account snapshot contract. Balance response has no source timestamp. |
| `getServerTime()` | Blocked | Documented Spot server-time endpoint or another authoritative time source with defined precision/units. |
| `getOpenOrders({ symbol? })` | Partial / exchange-blocked | Official Spot contract requires `symbol`. No account-wide request is documented. Per-market enumeration is not proven exhaustive or atomic, including for delisted/closed markets and concurrent order changes. |
| `getOrder({ symbol, orderId })` | Partial | Existing broker-ID lookup works; add client-order-ID lookup only if Bitunix documents/supports that identifier. |
| `getCanonicalOrder({ symbol, orderId | clientOrderId })` | Blocked | Canonical identity requires a stable client order ID (or formally approved alternative) plus complete canonical order facts. |
| `getOrderHistory({ ... })` | Partial | Existing filters/page support; confirm pagination termination, ordering, maximum page size, time boundaries, and history completeness. Exact order-ID filtering is not documented. |
| `getCanonicalOrderHistory({ ... })` | Blocked | Stable client identity and a proven history query contract capable of resolving canonical orders. |
| `getMyTrades({ ... })` | Blocked | Account-wide trade history endpoint, documented pagination, stable per-execution IDs and time/cursor semantics. |
| `getFills({ symbol, orderId })` | Blocked | Prove the quantity denomination, complete partial-execution coverage, stable/unique execution identity, fee semantics and ordering before exposing canonical Fill values. |
| `createOrder()` | Blocked | Written clarification of single-order REST quantity units; client-supplied idempotency identity or authoritative unknown-outcome reconciliation; verified mutation environment. |
| `createCanonicalOrder()` | Blocked | All placement prerequisites plus canonical response facts and a stable client order ID. |
| `cancelOrder()` | Blocked | Documented cancellation semantics and a safe way to reconcile timeout/unknown outcomes; private lifecycle evidence or an approved polling contract. |
| `cancelAllOpenOrders()` | Blocked | Same cancellation guarantees plus complete account-wide open-order enumeration and safe partial-failure reporting. |
| `subscribeForPrices()` | Blocked | Continuous public Spot price push subscription with event identity/timestamp, subscription confirmation, heartbeat and reconnect/resubscribe contract. Existing public Spot WS methods are RPC request/response. |
| `subscribeForBookTicker()` | Blocked | Continuous Spot order-book push subscription and documented depth/precision semantics. Current depth RPC precision selection is unclear; no continuous subscription is documented. |
| `getCandles()` | Blocked | Historical Spot candle endpoint/response with all canonical OHLCV fields, including volume, timestamp units and interval boundaries. Documented Spot kline payload omits volume. |
| `subscribeForCandles()` | Blocked | Continuous public Spot candle push subscription with complete canonical OHLCV fields and lifecycle semantics. |
| `subscribeForUserData()` | Blocked | Documented Spot private push stream for order/execution/account events, authentication, subscription lifecycle, stable event/execution IDs, timestamps, reconnect and gap-recovery semantics. Spot user/order WS RPC methods are not push subscriptions. |

### Missing canonical fields, keys and guarantees

These are the concrete data/contract gaps to close—not a request to invent local substitutes.

| Missing field / guarantee | Why Binance/Harvester needs it | Required Bitunix evidence or decision |
|---|---|---|
| Client order ID (client-supplied, exchange-persisted, queryable) | Idempotent placement and resolving an unknown submission outcome | Official request/response/detail/history support and uniqueness/retention semantics; otherwise an explicitly approved safe alternative. |
| Stable per-execution ID and complete execution list | Fill deduplication, accounting, replay and recovery | Prove `order/deal/list` returns every execution; define pagination, ordering and uniqueness. Existing `trade.id` mapping alone does not prove completeness. |
| Account snapshot source timestamp/version | Establish freshness and compare snapshots safely | Exchange-provided source timestamp or approved snapshot consistency contract; never substitute local receipt time as source time. |
| Order/event source timestamps and ordering/cursor | Detect stale updates, order events and recover gaps | Document timestamp units, precision, monotonicity, event sequence/cursor and replay semantics. |
| Account-wide open-order snapshot | Startup/reconnect reconciliation and cancel-all safety | Endpoint or documented exhaustive per-symbol enumeration with catalog coverage, pagination and race handling. |
| Order quantity semantics | Exact placement and canonical original/executed quantities | Written resolution of the contradictory single-order REST versus batch/WS `volume` units for LIMIT and MARKET. |
| Complete order identity/status fields | Canonical order adaptation and lifecycle transitions | Confirm broker order ID, symbol, side, type, status, original/executed quantity, price, create/update time and their units/semantics on every relevant endpoint. |
| Fill fee semantics | Correct base/quote/third-asset commission accounting | Confirm `fee` denomination, `feeCoin`, sign, precision and whether fee is final/per execution. The current adapter does not default to quote asset: missing `fee` yields `UNKNOWN`; zero fee yields `COMPLETE`; non-zero fee requires `feeCoin`. Official docs mark both fields required but do not define per-execution/finality semantics. |
| Market trading constraints | Safe order preflight and quantity/price rounding | Map only documented `minVolume` to `MIN_QUANTITY` and `minPrice` to `MIN_NOTIONAL`; define price/quantity increments, maximum bounds, and any dynamic/account filters. `basePrecision`, `quotePrecision`, and `precisions` do not yet prove tick/step semantics. |
| Depth precision selector | Correct book snapshot and market depth | Explain how pair `precisions` maps to the depth endpoint's numeric `precision` parameter and what each value means. |
| Candle volume | Existing canonical OHLCV contract | A Spot candle source that provides real base/quote volume; never synthesize volume. |
| Server time | Timestamp validation and freshness calculations | Documented Spot server clock or approved authoritative alternative. |
| Isolated mutation environment | Safe place/cancel and lifecycle integration tests | Bitunix currently confirms no TESTNET. No live mutation tests are authorized; a separately isolated environment or explicit future safety decision is required. |

### Phase 1 evidence — symbol-scoped order response identity

- Both official [pending-order](https://www.bitunix.com/api-docs/spots/en_us/order/#6-query-current-orders) and [order-history](https://www.bitunix.com/api-docs/spots/en_us/order/#5-query-order-history) contracts require a `symbol` request parameter, and both response row schemas include `symbol`.
- The broker validates every returned pending/history row against the requested symbol before adapting it. A response containing another market is rejected rather than leaking a foreign order into a symbol-scoped result.
- This is request/response correlation validation only. It does not establish account-wide coverage, history completeness, or a coherent cross-market snapshot.

### Phase 3 evidence — Spot WebSocket methods are RPC, not streams

- **Official public Spot WebSocket protocol:** [Public WS documentation](https://www.bitunix.com/api-docs/spots/en_us/public-ws/) documents `market.last_price`, `market.depth`, `market.kline`, and common catalog/rate/token lookups as request messages carrying an `id`, `method`, and `params`, followed by one response carrying the same `id` and a `data` result. It does not document market stream channel names, subscribe/unsubscribe methods, subscription acknowledgements, push event payloads, sequence IDs, or replay semantics. These are one-shot RPCs over a WebSocket transport, not continuous market-data subscriptions.
- **Official private Spot WebSocket protocol:** [User WS documentation](https://www.bitunix.com/api-docs/spots/en_us/user-ws/) exposes `user.account` and `user.info` as request/response calls. [Order WS documentation](https://www.bitunix.com/api-docs/spots/en_us/order-ws/) similarly exposes order placement/cancellation, matching-order lookup, order history, pending orders and order detail as RPC calls. No continuous Spot order, execution, balance, or account event subscription is documented.
- **Primary .NET Spot socket reference:** [`BitunixSocketClientSpotApi`](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Clients/SpotApi/Socket/BitunixSocketClientSpotApi.cs) implements request/response order methods via `QueryAsync`. [`IBitunixSocketClientSpotApi`](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Interfaces/Clients/SpotApi/IBitunixSocketClientSpotApi.cs) exposes PlaceOrder, CancelOrder and CancelOrders only. The [Spot shared socket interface](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Interfaces/Clients/SpotApi/IBitunixSocketClientSpotSharedApi.cs) contains only place/cancel contracts; no market-data or private-event subscription surface was found. The [Spot message handler](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Clients/MessageHandlers/BitunixSocketSpotMessageHandler.cs) correlates response messages by `id`, consistent with RPC.
- **Secondary TypeScript reference:** the [MCP repository tree](https://github.com/samanzamani/bitunix-mcp) contains its Spot REST tool but no WebSocket client or subscription implementation. It provides no Spot streaming behavior to port.
- **Official Open API repository check:** the current [BitunixOfficial/open-api tree](https://github.com/BitunixOfficial/open-api) contains no Spot-specific source paths; its available demo request/response models must not be treated as Spot WebSocket evidence.
- **Decision:** do not implement `subscribeForPrices()`, `subscribeForBookTicker()`, `subscribeForCandles()`, or `subscribeForUserData()` on top of these RPC methods. Do not simulate a subscription by repeatedly polling over a persistent socket and call it a push stream. A future polling adapter would need its own explicitly named capability and a documented freshness/rate-limit/reconciliation contract; current last-price responses still lack source timestamps.
- **Phase 3 status:** audit complete; no documented Spot push capability found. Continue with independently safe read/reconciliation work and request written Bitunix clarification before revisiting streams.

### Phase 1 evidence — account-wide open-order coverage

- **Official Spot contract:** [Query current orders](https://www.bitunix.com/api-docs/spots/en_us/order/#6-query-current-orders) documents `POST /api/spot/v1/order/pending/list` with `symbol` marked required. It returns the pending-order array for that trading pair; no page, cursor, total count, account-wide mode, or cross-symbol snapshot token is documented.
- **Primary .NET reference:** [`GetOpenOrdersAsync`](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Clients/SpotApi/Rest/BitunixRestClientSpotApiTrading.cs) requires a non-optional `string symbol` and always adds it to the request. The interface has the same required parameter. No account-wide overload or enumeration helper was found.
- **Secondary TypeScript reference:** [`spot_get_pending_orders`](https://github.com/samanzamani/bitunix-mcp/blob/main/src/tools/spot.ts) marks `symbol` optional and sends an empty body when omitted. This is only client behavior; it provides no response fixture, documented exchange guarantee, or evidence that Bitunix accepts the request or returns all account orders. Do not treat the optional tool schema as protocol evidence.
- **Current Coinzilla implementation:** `BitunixSpotBroker.getOpenOrders()` calls `requireSymbol()` and sends exactly `{ symbol }`; its regression test verifies that missing symbol fails before any REST call. Keep this behavior.
- **Enumeration assessment:** `getExchangeMarkets()` exposes currently open pairs, but iterating that list cannot prove complete account coverage: orders could exist for a market no longer returned as open, the catalog is not documented as an exhaustive historical set of markets with pending orders, and sequential per-symbol requests do not represent one atomic snapshot while orders may be created, filled, or canceled between calls. There is no documented pagination or snapshot/version token to close these gaps.
- **Decision:** account-wide `getOpenOrders()` remains unsupported. Do not omit `symbol`, silently fan out over current markets, or advertise the result as a complete account snapshot. The existing symbol-scoped read remains supported.
- **Evidence references:** [official Spot order API](https://www.bitunix.com/api-docs/spots/en_us/order/#6-query-current-orders); [JKorf Spot trading implementation](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Clients/SpotApi/Rest/BitunixRestClientSpotApiTrading.cs) and [interface](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Interfaces/Clients/SpotApi/IBitunixRestClientSpotApiTrading.cs); [TypeScript MCP Spot tools](https://github.com/samanzamani/bitunix-mcp/blob/main/src/tools/spot.ts).

### Phase 1 evidence — execution and order history

The following comparison resolves what the references actually implement; it does not upgrade undocumented exchange guarantees into supported behavior.

- **Official Spot contract:** [Query matching orders](https://www.bitunix.com/api-docs/spots/en_us/order/#4-query-matching-orders) accepts `orderId` and `symbol`, and documents one `data` object with `volume`, `price`, `fee`, `feeCoin`, `role`, `ctime`, and `id` (“Matching Order id”). It documents no page, cursor, total count, or array of executions. The docs do not state whether this object aggregates every match for a partially filled order, whether one order can produce multiple returned records, or whether `id` is guaranteed unique/stable across time. Treat per-execution completeness and identity as **unproven**.
- **Fill-history contract and decision:** official `order/deal/list` requires `orderId` and `symbol` and documents one `data` object with `volume`, `price`, `fee`, `feeCoin`, `role`, `ctime`, and `id`. It does not define whether `volume` is base or quote quantity, whether the object aggregates every partial execution, whether `id` is stable/unique for deduplication, or any pagination/completeness semantics. JKorf's `BitunixUserTrade.Quantity` model does not specify the asset denomination and its inspected Spot user-trades method has an endpoint mismatch; the TypeScript MCP has no fill-history tool. [PR #1205](https://github.com/45s/coinzilla/pull/1205) added a temporary `dealVolume`/response-presence guard, and [PR #1220](https://github.com/45s/coinzilla/pull/1220) rejected undocumented array responses. Those guards did not resolve the missing facts needed to construct a canonical `Fill`. [PR #1225](https://github.com/45s/coinzilla/pull/1225) therefore disables `getFills()` without issuing a request until Bitunix documents quantity denomination, complete partial-execution coverage, and stable/unique execution identity. No canonical fill is emitted.
- **Fee mapping:** the adapter preserves the denomination from `feeCoin`; it does not assume quote asset. Missing `fee` is represented as commission status `UNKNOWN`; a zero fee is `COMPLETE` with no commission; a non-zero fee requires `feeCoin` and rejects negative amounts. The official endpoint marks `fee` and `feeCoin` required, but does not specify fee sign conventions, precision/finality, or whether fees are per execution versus aggregated.
- **Official order-history contract:** [Query order history](https://www.bitunix.com/api-docs/spots/en_us/order/#5-query-order-history) accepts `page`, `pageSize`, ISO-8601 `startTime`/`endTime`, `status`, `side`, `type`, and required `symbol`. The response documents `total`, `pageNum`, `pageSize`, and `data[]`. Order rows expose status 3 for partially filled orders and cumulative `dealVolume` (base quantity), but the docs do not define result ordering, page-snapshot consistency, a cursor, a maximum page size, or inclusive/exclusive time boundaries. The REST schema types `pageNum` as a string and `pageSize` as an object; the official [Spot WebSocket order-history example](https://www.bitunix.com/api-docs/spots/en_us/order-ws/) shows both as numbers. The .NET page model also uses integers. Coinzilla accepts a positive safe-integer `pageNum` in either string or number form and leaves response `pageSize` unvalidated until the REST/WS schema conflict is clarified. A process can issue the same symbol/time/page query after restart, but retention and exhaustive recovery semantics are not guaranteed.
- **Current Coinzilla history mapping:** `getOrderHistory()` sends one requested page and maps `response.data.data` to orders. [PR #1202](https://github.com/45s/coinzilla/pull/1202) validates non-negative safe-integer `total`, positive safe-integer `pageNum` (string or number) matching the requested page, and the `data[]` shape; omitted `data` is normalized to `[]` only when `total === 0`. It discards pagination metadata after validation and preserves the legacy one-page `Order[]` result. It still does not automatically paginate or sort; ordering, snapshot consistency, maximum page size, time-bound inclusivity, and completion semantics remain undocumented.
- **Primary .NET reference:** [Spot trading implementation](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Clients/SpotApi/Rest/BitunixRestClientSpotApiTrading.cs) calls `/order/history/page` for history, but its `GetUserTradesAsync` implementation calls `/order/pending/list` even though [the interface](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Interfaces/Clients/SpotApi/IBitunixRestClientSpotApiTrading.cs) documents `/order/deal/list`. Do not copy this implementation defect. Its [BitunixPage model](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Objects/Models/BitunixPage.cs) types `pageNum` and `pageSize` as integers, while the current official docs describe `pageNum` as a string and `pageSize` as an object. The inspected [history fixture](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net.UnitTests/Endpoints/Spot/Trading/GetOrderHistory.txt) contains only `data: {}`, not a representative paginated response; no matching `GetUserTrades` fixture/test was found. Its [BitunixUserTrade model](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Objects/Models/BitunixUserTrade.cs) contains `id`, `price`, `volume`, `ctime`, `fee`, `feeCoin`, and `role`, but no broker `orderId`.
- **Secondary TypeScript reference:** [bitunix-mcp Spot tools](https://github.com/samanzamani/bitunix-mcp/blob/main/src/tools/spot.ts) sends one `spot_get_order_history` request with page/pageSize defaults of 1/20 and a local maximum of 100. It does not iterate pages and exposes no per-order fill-history tool. Its local page-size limit is not an official Bitunix guarantee.

### Phase 1 evidence — market filters and depth precision

- **Official Spot pair metadata:** the public pair catalog documents `minPrice` as minimum trading amount/value and `minVolume` as minimum trading volume; the Spot WebSocket market example labels them minimum trading value and minimum trading quantity. The order documentation distinguishes quote-asset value (`amount`) from base-asset quantity (`volume`). The supported mapping is therefore `minPrice` → canonical `MIN_NOTIONAL` (quote asset) and `minVolume` → `MIN_QUANTITY` (base asset).
- **Precision fields:** `basePrecision` and `quotePrecision` are token precision metadata; `precisions` is a list of trading precision values. The official depth request separately accepts a numeric `precision` described only as token precision, while the Spot WebSocket example uses `precision: 5`. No official source defines how the pair `precisions` list maps to the depth request parameter or proves that token precision equals a tick/step increment.
- **Primary .NET reference:** `BitunixSymbol` maps `minVolume` to minimum order quantity, `minPrice` to minimum order value, and base/quote precision to decimal-count properties. Its old fixture includes `maxAmount`, `maxLimitOrderAmount`, and `maxMarketOrderAmount`; the shared parser maps `maxAmount` to maximum quantity, but these fields are absent from the official Spot catalog documentation. Do not promote them into supported canonical maximum constraints without official evidence. Its Spot `GetOrderBookAsync` omits the documented precision parameter; do not port that omission.
- **Secondary TypeScript reference:** the MCP `spot_get_order_book` tool accepts an optional string described as price-aggregation precision and passes it through; it does not validate the value against the pair metadata. This is a third-party interpretation, not an exchange guarantee.
- **Order types:** the official Spot order API documents `LIMIT` and `MARKET`; no Spot `LIMIT_MAKER` or post-only flag is documented. An explicitly open market may advertise only these two types.
- **References:** [official Bitunix Spot API documentation](https://www.bitunix.com/api-docs/spots/en_us/); [JKorf BitunixSymbol model](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Objects/Models/BitunixSymbol.cs), [Spot symbol parser](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Clients/SpotApi/Rest/SharedApi/BitunixRestClientSpotSharedApi.SpotSymbols.cs), and [Spot order-book method](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Clients/SpotApi/Rest/BitunixRestClientSpotApiExchangeData.cs); [TypeScript MCP Spot tools](https://github.com/samanzamani/bitunix-mcp/blob/main/src/tools/spot.ts).
- **Decision:** map the two minimum constraints only; keep price/quantity increments and all undocumented maximum constraints UNKNOWN; record precision/depth and reference-only maximum field names as unvalidated diagnostics. Do not derive tick size, step size, or depth precision. The pure Harvester helper is implemented in [PR #1209](https://github.com/45s/coinzilla/pull/1209) and remains disconnected from runtime bootstrap.

**First safe implementation slice:** order-history response-envelope and requested-page validation is implemented in [PR #1202](https://github.com/45s/coinzilla/pull/1202), preserving the existing one-page result contract. Documented minimum market constraints are mapped by the pure Harvester helper in [PR #1209](https://github.com/45s/coinzilla/pull/1209). Account-wide open-order coverage remains unsupported after the audit in [PR #1222](https://github.com/45s/coinzilla/pull/1222). Symbol correlation is validated for pending/history rows by [PR #1223](https://github.com/45s/coinzilla/pull/1223). Matching-order response shape was hardened in PR #1220, but the complete fill contract remains unproven; [PR #1225](https://github.com/45s/coinzilla/pull/1225) disables canonical fill retrieval until Bitunix clarifies quantity denomination, multi-execution completeness, and stable identity.

### Phase 1 implementation progress

- [x] Validate the order-history response envelope and returned page identity, accepting the documented REST string and official Spot WebSocket numeric `pageNum` forms — [PR #1202](https://github.com/45s/coinzilla/pull/1202).
- [ ] Establish ordering, snapshot consistency, maximum page size, time-bound inclusivity, and reliable completion semantics before adding automatic pagination.
- [x] Audit account-wide open-order coverage: the official endpoint and .NET reference require a symbol; per-market fan-out cannot prove exhaustive, atomic account coverage. Keep account-wide retrieval unsupported.
- [x] Audit `dealVolume` versus matching-order response presence — [PR #1205](https://github.com/45s/coinzilla/pull/1205) added a temporary consistency guard. Subsequent audit found that quantity denomination, multi-execution completeness and stable identity remain unproven; [PR #1225](https://github.com/45s/coinzilla/pull/1225) keeps `getFills()` unsupported until those facts are documented.
- [x] Map documented Bitunix `minVolume`/`minPrice` into canonical Harvester `MIN_QUANTITY`/`MIN_NOTIONAL`; leave all unresolved increments/maxima UNKNOWN — [PR #1209](https://github.com/45s/coinzilla/pull/1209).
- [x] Reject ambiguous duplicate market metadata in `getSymbolFilters()` instead of silently selecting the first matching catalog row; exactly one matching canonical symbol is required — [PR #1271](https://github.com/45s/coinzilla/pull/1271).
- [x] Implement Binance-compatible legacy `getAssets()` from the existing Spot account endpoint: add free + locked balances exactly, omit exact zero assets, and return the legacy Number-based `Coin.value` shape while retaining `getBalances()` as the exact-decimal API — [PR #1274](https://github.com/45s/coinzilla/pull/1274).
- [x] Validate Spot latest-price values as strictly positive after exact decimal parsing; preserve the original decimal string without Number conversion — [PR #1279](https://github.com/45s/coinzilla/pull/1279).
- [x] Reject missing or `null` symbol-scoped pending-order response data instead of reporting an unsupported empty result; preserve explicit empty arrays and documented object/array row forms — [PR #1280](https://github.com/45s/coinzilla/pull/1280).
- [x] Reject unsafe numeric Bitunix broker order IDs at both response adaptation and order-detail request boundaries while retaining string IDs and safe-integer compatibility — [PR #1290](https://github.com/45s/coinzilla/pull/1290), merged as `56097e527f44cfd9bddfd10f8078346695092607`.
- [x] Reject unsafe numeric order-history `page` and `limit` values before REST I/O while preserving the existing one-page contract; no maximum page size is inferred — [PR #1299](https://github.com/45s/coinzilla/pull/1299), merged as `0c801593efac9adc27fe2669c239209a663b50bf`.
- [x] Require any optional Bitunix pair `symbol` to match the canonical concatenation of documented `base` and `quote` fields; reject contradictory market identity metadata instead of preferring an inconsistent symbol field — [PR #1304](https://github.com/45s/coinzilla/pull/1304), merged as `27d75d28124844ff23f7ca2812308edfda53b91a`.
- [ ] Resolve per-order fill completeness, execution-ID guarantees, and the unit of deal `volume`; only add fail-closed checks where the exchange contract makes the inconsistency unambiguous.

### Recommended implementation order

1. **Close safe read-contract gaps first:** order-history page-envelope and requested-page validation is implemented in PR #1202; the fail-closed `dealVolume`/matching-order presence guard is implemented in PR #1205; the documented Bitunix `minPrice`/`minVolume` fields are mapped by PR #1209; strict matching-order response-shape validation is implemented in PR #1220; ambiguous duplicate symbol metadata is rejected in PR #1271; and legacy `getAssets()` compatibility is implemented in PR #1274. Account-wide open-order coverage was audited and remains unsupported because the endpoint requires a symbol and no exhaustive atomic enumeration is documented. Depth precision and full history/fill completeness remain exchange-blocked. Continue with independently verifiable read-side contract improvements.
2. **Complete canonical read/reconciliation primitives:** add canonical order mapping by broker ID, account-wide open-order coverage, account snapshot freshness and account-wide trade history only when the API supplies the required facts.
3. **Implement public WebSocket market data:** currently blocked. The Phase 3 audit found only one-shot public RPC methods in official Spot docs and no Spot market subscription surface in the .NET reference. Revisit only if Bitunix documents real push channels and lifecycle semantics; do not poll over a socket and label it a stream.
4. **Resolve order lifecycle contracts externally:** quantity units, client identity, execution completeness, cancellation/unknown-outcome recovery and isolated mutation environment. Keep placement/cancellation disabled until all are resolved.
5. **Implement private user-data lifecycle and Harvester integration:** only after a real Spot private event stream or a rigorously specified timestamped polling/reconciliation alternative exists. Match Binance's recovery safety, not merely its method names.
6. **Parity acceptance:** add a shared broker contract suite for every capability Bitunix claims to support; compare result shapes, exact decimal strings, errors, unsupported behavior and cleanup against Binance without weakening Binance contracts.

**Hard safety boundary:** Bitunix Spot remains read-only and not Harvester-ready. No order placement, cancellation, private user-data subscription, or live trading may be enabled while [issue #1185](https://github.com/45s/coinzilla/issues/1185) remains unresolved. A method being present on `CoreBroker` or on the Bitunix class is not evidence that the exchange supports it.

---

## Bitunix Spot reference-driven development rule

**Status: mandatory for every future Bitunix Spot capability task.** Before implementing a requested feature, agents must first audit the matching implementation and tests in [JKorf/Bitunix.Net](https://github.com/JKorf/Bitunix.Net) (primary C# Spot reference), cross-check the available JavaScript/TypeScript implementation in [samanzamani/bitunix-mcp](https://github.com/samanzamani/bitunix-mcp), and verify the wire contract against the [official Bitunix Spot API documentation](https://www.bitunix.com/api-docs/spots/en_us/) and [official Open API repository](https://github.com/BitunixOfficial/open-api).

The detailed, mandatory procedure and direct source/test links live in [packages/brokers/AGENTS.md — Bitunix Spot development](./AGENTS.md#bitunix-spot-development--mandatory-reference-audit). This roadmap is the work/status view; it does not duplicate that engineering rule.

The purpose is to translate an already implemented and tested Spot behavior into Coinzilla's JavaScript architecture rather than inventing protocol behavior. The .NET implementation is a reference, not infallible authority: inspect source and fixtures, audit endpoint/parameter/response behavior, compare with official docs, and do not copy defects or Futures-only capabilities. Keep all unresolved guarantees in [issue #1185](https://github.com/45s/coinzilla/issues/1185); reference-project coverage does not itself resolve an exchange-contract blocker or authorize order mutations.
