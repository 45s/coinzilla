# Coinzilla — develop engineering roadmap

**Scope:** the active shared development branch `develop`. This roadmap deliberately does not track release-branch synchronization or work on the old `main` snapshot.

**Goal:** make every application and shared package safe, deterministic, observable and maintainable. Prioritize demonstrated correctness and operational risks over refactoring volume or checklist completion.

## Priority order across the workspace

### CRITICAL — Harvester trading safety and recovery

1. **Conservative trailing-BUY replacement safety** — validate replacement intent before canceling the standing order, and define fail-closed behavior for exchange-filter rejection or unknown outcomes. This addresses the observed `MIN_NOTIONAL` failure path and prevents a rejected replacement from silently removing the strategy's standing order. Add RED/GREEN tests for stale market data, min-notional, cancel/submit failures, partial fills and duplicate ticks.
   - Owner and implementation plan: [Harvester roadmap](apps/harvester/ROADMAP.md).

2. **User-data recovery acceptance (#626)** — transport reconnect must not reopen trading until the matching recovery generation has authoritative order/fill reconciliation and required durable audit barriers. Keep TESTNET **PAUSED / UNVERIFIED** after the regional HTTP 451 restriction; do not claim acceptance or repeat the same blocked hosted attempt.
   - Owner and evidence matrix: [Harvester](apps/harvester/ROADMAP.md), [Brokers](packages/brokers/ROADMAP.md).

3. **Process-restart reconciliation (#654)** — current trading ownership/accounting state is process-local. Before unattended restarts, persist order/fill identity, reservations, Portfolio/Position and strategy-control state, then reconcile persisted state with exchange balances/open orders/history before READY. Fail closed on incomplete or conflicting history.
   - Owner: [Harvester](apps/harvester/ROADMAP.md).

### IMPORTANT — persistence and operational contracts

4. **Journal persistence boundary** — finish the internal filesystem adapter (J-3), explicit orchestration state ownership (J-4), and conformance/operational docs (J-5). Preserve required Harvester PREFLIGHT/CLOSING and pre-side-effect durability barriers; optional diagnostic evidence must not add trading gates.
   - J-1 and J-2 are complete in PRs #746 and #747.
   - Owner: [Journal](packages/journal/ROADMAP.md).

5. **Package-owned test quality** — add scoped coverage and negative self-checks where the audit found gaps in actively used packages. Workspace aggregate coverage alone can hide a weak package. Prioritize meaningful error, cleanup, concurrency, duplicate-event and partial-failure branches; never add tests just to inflate percentages.
   - Owners: [Entities](packages/entities/ROADMAP.md), [Harvester](apps/harvester/ROADMAP.md).

6. **Broker protocol acceptance** — resolve the native WebSocket read-only TESTNET handshake gap in an authorized environment and record exact runtime/commit/evidence. Preserve recovery generation fencing and keep mutation tests disabled unless separately authorized.
   - Owner: [Brokers](packages/brokers/ROADMAP.md).

### IMPORTANT — architecture and package ownership

7. **Decompose oversized Harvester/Brokers modules only after behavior is protected by tests.** Extract cohesive workflows, preserve public contracts, and add executable dependency-boundary tests. Avoid broad speculative rewrites.
8. **Keep shared Entities and Utils contracts pure and stable.** Use exact decimal strings, explicit unknown/incomplete states, narrow imports and architecture tests. Do not move business rules into generic utilities.
9. **Use DB only for a real domain-owned persistence requirement.** Define repository ports in the owning context, keep SQL in adapters, and test transactions, locking, migration and backup/restore before deployment.
10. **Keep Event Bus and Notifiers bounded and optional by contract.** Preserve explicit delivery, failure and shutdown semantics. Do not add retries, dead-letter queues, new transports or durable notification outboxes without a concrete consumer requirement.

## Application and package execution map

- [Harvester](apps/harvester/ROADMAP.md) — trading safety, recovery, restart reconciliation, evidence and session statistics.
- [Brokers](packages/brokers/ROADMAP.md) — native WebSocket protocol, user-data lifecycle, recovery and integration acceptance.
- [Database](packages/db/ROADMAP.md) — first domain-owned persistence consumer and operational procedures.
- [Entities](packages/entities/ROADMAP.md) — exact financial contracts, dependency boundaries and package coverage.
- [Event Bus](packages/event-bus/ROADMAP.md) — bounded delivery, failure semantics and lifecycle guarantees.
- [Journal](packages/journal/ROADMAP.md) — record contract, filesystem adapter, orchestration and durability documentation.
- [Market Simulator](packages/market-simulator/ROADMAP.md) — currently unused; low-priority maintenance only, deferred until a real consumer exists.
- [Notifiers](packages/notifiers/ROADMAP.md) — safe optional delivery and operator-controlled live smoke test.
- [Utils](packages/utils/ROADMAP.md) — shared exact arithmetic, logger API and generic helper reuse.

### LOW PRIORITY — unused package maintenance

11. **Market Simulator correctness and determinism** — defer all simulator correctness, deterministic-time, cleanup and coverage work until an application or workflow actually consumes this package. There is currently no demonstrated production use, so it must not compete with active trading, recovery or persistence work. Keep the existing package and its tests intact; do not expand it proactively.
   - Owner and deferred notes: [Market Simulator](packages/market-simulator/ROADMAP.md).

## Delivery and verification rules

1. Work one meaningful behavior at a time. For bug fixes, add a focused regression test first and demonstrate RED before implementation.
2. Read the owning package's `AGENTS.md`, roadmap, implementation, tests and consumer contracts before editing.
3. Keep domain rules in their owning bounded context; use shared packages only for demonstrated generic contracts.
4. Preserve exact decimal financial values, idempotent fill accounting, fail-closed order/recovery gates and explicit unknown outcomes.
5. Run focused tests, package tests/coverage, then relevant workspace CI. Report exact head SHA and results; never infer success from a previous commit.
6. Treat network/exchange/Telegram checks as separate integration acceptance. A skipped test is not a pass.
7. Update the owning roadmap in the same PR as verified implementation. Mark an item complete only after merge to `develop` and required checks pass.
8. Keep PRs small, based on current `develop`, and delete task branches after merge when repository settings permit.
9. Never weaken tests, coverage thresholds, safety gates or CI to make a PR green.

## Current verification checkpoint

- Audited branch: `develop`.
- Baseline before this roadmap update: `7d2d8b05a5dcc223a3f434b1f6a4357e87126eae`.
- PRs #746 and #747 are merged; Journal record vocabulary and the lightweight record contract are implemented.
- Offline required CI passed on the exact PR #747 head. Binance TESTNET integration was skipped; exchange acceptance remains unverified.
- Existing open Harvester tracker correction PR #738 is accounted for in this roadmap update; do not duplicate its completed status corrections.
