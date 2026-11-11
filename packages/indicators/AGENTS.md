# Indicators — Agent Instructions

- Status: Initial calculation capability merged in [PR #1018](https://github.com/45s/coinzilla/pull/1018); active package.
- Owner: Indicators domain under `packages/indicators/`.
- First consumer: Harvester's per-market ATR/NATR measurement service in [PR #1021](https://github.com/45s/coinzilla/pull/1021), under issue #1016. That PR collects measurements only; the protection policy remains Harvester-owned and is not active yet. Adaptive price-step planning, PR #1013, is a separate later consumer.

## Scope

- Own only pure, deterministic, exchange-neutral indicator calculations over caller-supplied normalized market data.
- Keep calculations parameterized. Harvester initially selects 1-minute completed candles, ATR period 14 with Wilder smoothing, NATR and a 60-observation reference; never hard-code those policy choices as package-wide defaults.
- Keep candle retrieval, WebSocket subscriptions, exchange DTOs and protocol handling in Brokers.
- Keep trading thresholds, warning/pause/resume policy, configuration, order gates, cancellation and recovery SELL rules in Harvester.
- Reuse `@coinzilla/utils` exact decimal primitives. Do not move indicator or trading concepts into Utils.
- Do not import Harvester, Brokers, Binance SDKs or exchange-specific modules from this package.
- Do not add dependencies unless a concrete calculation requires them and their precision, maintenance and security impact are documented.

## Required engineering approach

- Follow root `AGENTS.md`, `ENGINEERING_STANDARDS.md` and `AI_AGENT_WORKFLOW.md`.
- Use test-first development with independently checked reference examples.
- Test normal, boundary, insufficient-history, malformed, unsorted, duplicate, discontinuous and unfinished-candle inputs; test invalid periods/scales and zero/invalid close/reference values.
- Define and document input precision, output precision, warm-up behavior, rounding, error semantics and public exports.
- Keep functions cohesive and object-input/object-output.
- Update this README and ROADMAP.md in every implementation PR. Keep package map, domain ownership and documentation inventory synchronized with package lifecycle changes.
- Run `pnpm --filter @coinzilla/indicators test` and `pnpm --filter @coinzilla/indicators run test:coverage`; the latter enforces 90% line and 85% branch coverage. Then rely on exact-head required workspace CI.

## Safety

- Indicator outputs are analytical measurements, not financial accounting values or exchange-valid order prices/quantities.
- This package must never submit, cancel or reprice orders.
- No TESTNET/LIVE operations are part of indicator implementation.
- Do not claim a capability complete until source, exports, tests, documentation and exact-head CI pass and the PR is merged into `develop`.
