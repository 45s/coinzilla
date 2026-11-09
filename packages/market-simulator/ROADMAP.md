# Market Simulator Engineering Roadmap

---
status: active
type: roadmap
owner: market-simulator
---

## Priority execution plan — current develop direction (2026-11-10)

### LOW PRIORITY — deferred until a real consumer exists

**Current usage:** no application or production workflow currently consumes this package. The simulator is retained as an available offline tool, but there is no demonstrated operational need to invest in additional correctness, realism, determinism or coverage work now. Do not schedule these items ahead of active application/package work. Revisit this section only when a concrete consumer and validation use case are identified.

The following items are intentionally deferred; they are not current release blockers.

1. **Propagate failed broker snapshot results instead of producing partial reports.**
   - **Why:** the simulation finalization path currently reads balances, order history and fills without consistently checking each result's `ok` state. A failed query can therefore be represented as an empty section and make an incomplete simulation look valid.
   - **Do:** validate every final broker read, preserve the original failure code/context and return an explicit failed/incomplete simulation result. Do not substitute empty arrays or balances for failed reads.
   - **Verify:** add regressions for each final read failing independently and in combination; assert the report is not marked successful and the original error remains visible.

2. **Guarantee broker disconnect even when unsubscribe fails.**
   - **Why:** cleanup currently awaits unsubscribe and then disconnect in the same `finally` path. If unsubscribe rejects, disconnect may never run, leaking sockets/listeners and contaminating later simulations.
   - **Do:** attempt unsubscribe and disconnect independently, preserve the primary simulation failure, and aggregate or report cleanup failures without skipping later cleanup.
   - **Verify:** test unsubscribe failure, disconnect failure, both failures, and success; assert disconnect is always attempted exactly once.

3. **Make simulation time deterministic.**
   - **Why:** simulated order/fill timestamps currently use wall-clock time. Re-running the same market history and strategy can produce different output, undermining reproducible comparisons and debugging.
   - **Do:** inject a clock or derive simulated execution timestamps from the supplied market event/simulation timeline. Keep wall-clock time out of domain matching and result generation.
   - **Verify:** run identical input twice and assert byte-for-byte equivalent economic results and timestamps; test out-of-order/duplicate market events explicitly.

4. **Add a package-owned coverage gate focused on failure branches.**
   - **Why:** audited source coverage showed weak branch coverage in the simulation runner and matching/execution adapters, and the package had no enforceable package-specific threshold. Workspace coverage can conceal these gaps.
   - **Do:** add a scoped coverage command and negative CI self-check after the above regressions; set a measured baseline and enforce at least 90% lines / 80% branches / 80% functions, raising thresholds only with evidence.
   - **Verify:** CI must fail when a deliberately insufficient threshold is configured and pass on the exact PR head. Prioritize error/cleanup/time/partial-fill branches over percentage-only tests.

### FUTURE — only after a consumer and execution model are agreed

5. **Improve matching realism only against a documented execution model.**
   - **Why:** fees, partial fills, queue priority, spread and liquidity assumptions can materially change strategy conclusions. Adding realism without a stated model creates false confidence.
   - **Do:** document each simulation assumption and introduce one behavior at a time with source fixtures and an explicit model version.
   - **Verify:** compare deterministic fixtures and clearly label unsupported market microstructure behavior in every report.

- **Package path:** `packages/market-simulator`
- **Package:** `@coinzilla/market-simulator`
**Target branch:** `develop`

## Mission

Provide a deterministic, offline simulation environment that lets strategy code consume historical prices and a controlled simulated spot-order lifecycle through Coinzilla's existing `CoreBroker` contract.

## Architecture

```text
Strategy
   |
Application use cases / simulation runner
   |
Ports (history repository, scheduler)
   |
Domain (history, decimals, matching rules)
   ^
Infrastructure adapters (JSON, timers)
   ^
Broker adapters (CoreBroker-compatible historical and execution brokers)
```

Dependencies point inward. Domain/application code must not depend on CoreBroker, Node.js I/O, timers, or exchange implementations. The composition boundary wires concrete adapters.

## Engineering constraints

- Reuse the existing `CoreBroker` contract; do not fork or modify it.
- Never instantiate a Binance broker or send exchange requests.
- Accept historical data explicitly through the configured history source; do not fabricate or silently assume a bundled fixture.
- Preserve source decimal strings and timestamps.
- Use string-based exact decimal arithmetic for simulated balances, prices, quantities and fees.
- Keep tests offline, deterministic, credential-free and based on injected timers.
- Do not add manual price-playback step/pause/resume/reset controls.
- Clearly document all execution assumptions and unsupported exchange behavior.
- Do not claim simulation output represents live-market profitability or exchange execution.

## Phases

### MS-001 — Workspace scaffold
- [x] Private ESM workspace package, local instructions, README and roadmap.
- [x] Workspace package map and lockfile registration.

### MS-002 — Historical market-data broker
- [x] Load and validate caller-supplied historical market data. No bundled 10,080-candle fixture is present in the current package; tests must supply deterministic data explicitly.
- [x] Validate candle structure and ascending timestamps.
- [x] Implement CoreBroker-compatible connect/disconnect, getPrice(s), and subscribeForPrices.
- [x] Preserve decimal strings, timestamps and OHLCV.
- [x] Configurable playback speed and automatic timer cleanup.

### MS-003 — Clean Architecture foundation
- [x] Extract pure domain validation.
- [x] Introduce application use cases for history loading and price streaming.
- [x] Define repository and scheduler ports through application-facing contracts.
- [x] Implement JSON repository and timer scheduler adapters.
- [x] Keep CoreBroker dependency at the outbound adapter boundary.
- [x] Add independent domain/application/infrastructure tests.

### MS-004 — Strategy simulation harness
- [x] Add lifecycle-based strategy runner with onStart/onPrice/onStop hooks.
- [x] Serialize asynchronous strategy callbacks.
- [x] Support deterministic max-candle termination.
- [x] Return final balances/orders/fills report; lifecycle timestamps remain wall-clock-dependent until the deferred simulation-time task is implemented.
- [x] Test runner without real time or exchange access.

### MS-005 — Simulated spot execution
- [x] Implement in-memory MARKET, LIMIT and LIMIT_MAKER orders.
- [x] Match resting limits against candle high/low using documented deterministic rules.
- [x] Track open orders, order history, fills and balances.
- [x] Reserve and release funds on order placement/cancellation.
- [x] Charge configurable quote-asset fees.
- [x] Use BigInt-backed exact decimal arithmetic.
- [x] Cover order matching, maker rejection, insufficient funds, cancellation and accounting.

## Explicit limitations of MS-005

- Full fills only; no partial fills or queue priority.
- Market orders use the latest candle close.
- Limit fills occur at limit price; no price improvement.
- No spread, slippage, market impact, intrabar path, latency or exchange-specific filters.
- No exchange user-data stream, leverage, margin, funding, liquidation, or derivatives simulation.
- Market metadata and initial balances must be supplied by the test configuration.

These limitations are intentional. Extend the model only with explicit semantics and tests.

## Quality gates (when the package becomes actively used)

- Run package tests and coverage plus repository CI.
- Verify Node 22 and Node 24.
- Keep the default test suite offline.
- Do not mark a phase delivered until the corresponding checks pass on the branch and the change is merged into `develop`.

## Shared utility reuse

- [x] Remove the app-local decimal arithmetic implementation.
- [x] Use shared decimal operations from `@coinzilla/utils` for order matching and the app's public arithmetic exports.
- [x] Keep market-history schema validation and simulator-specific matching semantics in this application.
