# Indicators roadmap

- Status: Proposed; package not yet created as a workspace project
- Type: Proposed package roadmap
- Proposed owner: Indicators
- Proposed package: `@coinzilla/indicators`
- Scope authority: [README.md](./README.md)
- First consumer: [Harvester volatility protection, issue #1016](../../apps/harvester/docs/volatility-protection.md)\n- Later consumer: [Harvester adaptive price step, PR #1013](../../apps/harvester/ROADMAP.md)

## Current status

No package manifest, source implementation, dependencies, public exports, tests or runtime behavior exist yet. This roadmap records a proposal and discussion backlog only. Do not describe the Indicators package or any indicator as implemented until a dedicated implementation PR adds the workspace package and exact-head CI verifies it.

## Proposed mission

Provide reusable, deterministic, exchange-neutral technical indicators and market-analysis calculations over normalized caller-supplied data. Keep indicator mathematics in this package; keep strategy, risk, order and execution policy in consuming applications.

## Prioritized initial consumer — Harvester volatility protection (#1016)\n\nThe first release should support the volatility measurements required by Harvester protection. Keep the package reusable: Harvester selects 1-minute candles, ATR period 14, Wilder smoothing and a 60-observation reference window; those values must be caller-supplied options, not package-wide strategy defaults. The package does not implement thresholds, hysteresis, order blocking or recovery SELL policy.\n\n## Proposed phases

1. [ ] **Agree package boundary and API conventions.**
   - Confirm the package name/path and whether the package should support current-value and historical-series APIs.
   - Define normalized candle shape, timestamp/interval units, ordering, gaps, duplicate timestamps, invalid values and insufficient-history results.
   - Decide decimal/precision policy and whether calculations use decimal strings, integer-scaled values or a documented numeric representation.
   - Define error/result conventions, validation limits, JSDoc, public exports and compatibility policy.
   - Inspect existing packages and consumers before adding dependencies or abstractions.

2. [ ] **Implement parameterized ATR (first consumer uses period 14 and Wilder smoothing).**
   - Freeze the ATR definition, including True Range, period, smoothing method and warm-up behavior.
   - Add deterministic tests for known reference series, edge cases, malformed candles, gaps, unsorted input, insufficient history and precision boundaries.
   - Keep input exchange-neutral and supplied by the caller; do not add broker/network access.

3. [ ] **Add NATR and a reusable current/reference volatility ratio.**
   - Define normalized ATR (ATR relative to close price) and its zero/invalid-close behavior.
   - Define the current-versus-reference volatility ratio for one market and compatible timeframe.
   - Keep reference-window selection, coefficient bounds, smoothing/hysteresis and fallback policy with the consuming strategy unless a genuinely generic mathematical operation is identified.

4. [ ] **Validate historical-series use.**
   - Ensure deterministic historical outputs can be consumed by offline analysis/backtesting without importing a simulator or application.
   - Do not build a backtesting engine or market-data storage layer into this package.

5. [ ] **Integrate consumers separately.**
   - Harvester integration is a separate consumer-owned change: it selects candle timeframe/history, configuration, warning/pause/resume thresholds, hysteresis, data-quality fallback, strategy touchpoints, diagnostics and order lifecycle behavior. Issue #1016 is the first consumer; adaptive price-step planning in PR #1013 follows separately.
   - Future applications request and integrate the public API; they do not modify this package's internals.
   - Add consumer regression tests and keep existing behavior unchanged when the feature is disabled.

6. [ ] **Expand the catalogue only when demanded.**
   - Evaluate EMA/SMA, MACD, RSI, stochastic, Fibonacci and other tools only against a concrete consumer requirement and a stable, testable contract.
   - Avoid speculative indicator frameworks, plugin registries or large dependency bundles.

## Ownership and dependency rules

- This package owns indicator calculations, input contracts, tests, documentation and its roadmap.
- Applications own trading decisions, risk policy, configuration, order placement/replacement and operational fallbacks.
- Brokers own venue-specific data retrieval and DTO mapping.
- Entities own canonical financial/domain values and invariants.
- Utils remains the home for genuinely generic primitives; do not move indicator/strategy concepts into `@coinzilla/utils`.
- Consumers use public exports only; no imports from private package source paths.
- Keep runtime dependencies at zero unless a specific calculation justifies one and its precision, maintenance and security impact are reviewed.

## Acceptance gates for the first release

- [ ] Public API and normalized candle contract are agreed and documented.
- [ ] ATR outputs match independently verified reference examples.
- [ ] Invalid, insufficient, discontinuous and adversarial inputs fail deterministically and safely.
- [ ] Current-value and historical-series behavior is consistent, or one is explicitly deferred with a reason.
- [ ] Package tests and meaningful line/branch coverage pass in required CI.
- [ ] Public exports, package metadata, README, AGENTS and roadmap agree.
- [ ] No exchange SDK, broker, Harvester or other application dependency is introduced.
- [ ] Harvester consumer integration is separate and does not change existing behavior when disabled.
- [ ] Repository package map, domain ownership and documentation inventory are updated when the package is actually created.

## Explicit non-goals for the initial capability

- Trading signals, BUY/SELL decisions or recommendations.
- Automatic order placement, cancellation or repricing.
- Exchange candle fetching, subscriptions or broker adapters.
- Strategy-specific coefficient limits, timeframe selection or fallback policy.
- A complete technical-analysis framework or every commonly known indicator.
