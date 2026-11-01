# Market Simulator

**Package:** `@coinzilla/market-simulator`  
**Path:** `apps/market-simulator`  
**Status:** Initial scaffold — implementation roadmap follows below.

## Mission

Provide a deterministic, controllable market environment for developing and testing Coinzilla trading strategies without depending on a live exchange or manually changing hardcoded prices.

The simulator will replay historical price fixtures and, later, generate configurable synthetic market scenarios. It must feed the strategy through the same broker contracts and normalized messages used by real broker implementations.

## Non-negotiable compatibility rule

The simulator is a test implementation of the existing Coinzilla broker contract, not a second broker API.

- Reuse `CoreBroker` and the existing broker/domain entities, event shapes, result conventions, and method signatures.
- Before implementing an operation, inspect the current broker interface, Binance implementation, and contract tests. Do not invent parallel message types, event names, order models, statuses, or payload formats.
- Keep exchange-specific protocol details out of the market engine and strategy-facing contract.
- A strategy under test should receive the same normalized data and observable broker behavior whether it is connected to a real broker or the simulator.
- Do not modify `packages/brokers` contracts just to make the simulator easier to implement. Any required contract change belongs to the Brokers domain and must follow the repository cross-domain workflow.

## Initial use case

The first fixture is intended to be DOGE price history previously associated with Free-Roll. The fixture should be owned by this application so it can be reused by any strategy test without importing data from another app.

**Fixture migration is currently blocked:** `apps/bot-free-roll/doge-history.json` exists on `develop`, but its committed contents are empty. No price records were available to move during scaffold initialization. Do not replace the missing data with fabricated prices. Recover the original fixture from its authoritative source before implementing replay against it.

## Goals

1. Run fully offline and deterministically by default.
2. Load validated historical price fixtures without changing their original price precision or timestamp meaning.
3. Replay prices for a configured market/pair with explicit start, stop, pause, resume, and playback-speed controls.
4. Make simulated market observations arrive through the existing broker-facing contract.
5. Support repeatable strategy tests: same fixture and settings produce the same event sequence.
6. Keep simulation time and wall-clock time distinct and injectable.
7. Provide diagnostics for malformed fixtures, exhausted history, invalid configuration, and lifecycle failures.
8. Add synthetic scenarios only after fixture replay is reliable and testable.

## Target boundaries

- **Fixture storage and validation:** historical source data and its schema.
- **Market engine:** deterministic stepping, replay position, simulation clock, and scenario generation. It must not know about Binance payloads or strategy rules.
- **Broker adapter:** implements the existing `CoreBroker` contract and translates engine observations into the exact established Coinzilla broker messages/events.
- **Transport (later phase):** optional WebSocket interface for external test clients. It must not introduce a competing strategy-facing contract. A Binance wire-protocol emulator is a separate compatibility concern and must not be confused with the internal broker contract.

See [ROADMAP.md](./ROADMAP.md) for the implementation sequence and acceptance gates.
