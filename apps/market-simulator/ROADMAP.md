# Market Simulator Engineering Roadmap

**Application:** `apps/market-simulator`  
**Package:** `@coinzilla/market-simulator`  
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
- Read the actual DOGE fixture in place; do not copy or fabricate history.
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
- [x] Load the actual 10,080-candle DOGEUSDT fixture.
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
- [x] Return reproducible balances/orders/fills report.
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

## Quality gates

- Run package tests and coverage plus repository CI.
- Verify Node 22 and Node 24.
- Keep the default test suite offline.
- Do not mark a phase delivered until the corresponding checks pass on the branch and the change is merged into `develop`.
