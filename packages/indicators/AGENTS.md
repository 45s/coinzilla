# Indicators — Agent Instructions

- Status: proposed domain only; no workspace package, package manifest, source implementation or runtime API exists yet.
- Owner: proposed Indicators domain under packages/indicators/.
- First consumer: Harvester volatility protection, issue #1016. Adaptive price-step planning, PR #1013, is a later consumer.

## Scope

When implementing this domain after the proposal is accepted:

- Own only pure, deterministic, exchange-neutral indicator calculations over caller-supplied normalized market data.
- Keep calculations parameterized. Harvester's initial consumer uses 1-minute completed candles, ATR period 14 with Wilder smoothing, NATR and a 60-observation reference; do not hard-code those policy choices as package-wide defaults.
- Keep candle retrieval, WebSocket subscriptions, exchange DTOs and protocol handling in Brokers.
- Keep trading thresholds, warning/pause/resume policy, configuration, order gates, cancellation and recovery SELL rules in Harvester.
- Do not move indicator or trading concepts into Utils. Reuse existing shared primitives where their contracts genuinely fit.
- Do not import Harvester, Brokers, Binance SDKs or exchange-specific modules from this package.
- Do not introduce a dependency unless a concrete calculation requires it and its precision, maintenance and security impact are documented.

## Required engineering approach

- Follow the repository root AGENTS.md and AI_AGENT_WORKFLOW.md. Inspect the current package map, domain ownership, engineering standards and this roadmap before changing files.
- Use test-first development. Add independently checked reference examples before implementation.
- Test normal, boundary, insufficient-history, malformed, unsorted, duplicate and discontinuous inputs; test invalid periods and zero/invalid close values.
- Define and document input precision, output precision, warm-up behavior, result/error semantics and public exports.
- Keep functions cohesive and object-input/object-output where consistent with repository conventions.
- Update this README and ROADMAP.md in every implementation PR. Update repository ownership, package map and documentation inventory when the package becomes a real workspace package.
- Run focused tests, package tests and coverage, then required workspace CI on the exact PR head.

## Safety

- Indicator outputs are analytical measurements, not financial accounting values or exchange-valid order prices/quantities.
- This package must never submit, cancel or reprice orders.
- No TESTNET/LIVE operations are part of indicator implementation.
- Do not claim the package or any indicator is implemented until source, exports, tests and workspace metadata exist and exact-head CI passes.
