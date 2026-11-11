# Indicators — proposed shared package

- Status: Proposal only; not yet a workspace package
- Proposed package name: `@coinzilla/indicators`
- Proposed path: `packages/indicators/`
- Initial consumer: Harvester adaptive price-step planning ([PR #1013](https://github.com/45s/coinzilla/pull/1013))
- Delivery plan: [ROADMAP.md](./ROADMAP.md)

## Purpose

Create a reusable, exchange-neutral library of technical indicators and market-analysis calculations. The long-term idea is a small, well-tested collection of trading indicators/tools that multiple applications can use without copying formulas or depending on exchange SDKs.

This directory currently contains planning documents only. There is no package manifest, source code, public API, dependency or runtime behavior yet. The package name and exact scope remain proposals until the design discussion is complete.

## Ownership boundary

The proposed package owns:

- Deterministic indicator calculations over normalized, caller-supplied market data.
- Clearly documented calculation definitions, input validation, warm-up requirements, precision and result/error semantics.
- Unit tests for normal, boundary, insufficient-history, malformed and discontinuous inputs.
- Historical-series calculations where they are useful for backtesting and analysis, as well as current-value calculations for live consumers.

The proposed package does **not** own:

- Exchange API calls, WebSocket subscriptions, broker DTOs or exchange-specific candle retrieval.
- Trading strategies, BUY/SELL decisions, order planning or repricing policy.
- Harvester configuration, portfolio/accounting state, risk limits or order lifecycle.
- Backtest execution engines or application-specific market-data storage.

Consumers provide normalized candles and decide how indicator outputs affect their own behavior. Brokers or application adapters may retrieve and normalize exchange data, but the indicator library must remain independent of those integrations.

## Initial capability proposal

The first concrete use case is volatility measurement for Harvester's adaptive `priceStepPercent`.

Candidate calculations:

1. **ATR (Average True Range):** a measure of absolute true-range movement over a configured period.
2. **NATR / normalized ATR:** ATR expressed relative to close price, making volatility more comparable across different price levels.
3. **Volatility ratio/coefficient:** current normalized volatility divided by a same-market reference volatility.

Illustrative model:

`ATR% = ATR / Close × 100`

`VolatilityCoefficient = CurrentATR% / ReferenceATR%`

`EffectivePriceStepPercent = ConfiguredPriceStepPercent × VolatilityCoefficient`

Example: if configured `priceStepPercent = 0.5`, current normalized volatility is 1.5 times its reference, and the illustrative coefficient is 1.5, the derived step is `0.75%`.

This is a design example only. ATR period/smoothing, candle timeframe, reference window, coefficient bounds, smoothing, fallback and low-volatility behavior are not decided. Do not treat this formula or example as an approved public API.

## Candidate future catalogue

These are ideas, not a commitment to implement every indicator:

- **Volatility:** ATR, NATR, historical volatility, volatility ratio.
- **Trend:** EMA, SMA, MACD and trend-strength measures.
- **Momentum:** RSI, stochastic oscillator and rate of change.
- **Price levels:** Fibonacci retracements/extensions, percentage distances and price ranges.
- **Derived tools:** adaptive thresholds and reusable indicator combinations, only where a concrete consumer requires them.

Add capabilities based on real use cases and an agreed public contract, not because an indicator appears on a generic checklist.

## Design principles

- Pure, deterministic functions; no hidden network, filesystem, clock, environment or mutable-global dependencies.
- Exchange-neutral normalized candle inputs; no Binance/Bybit/other venue SDK dependencies.
- Explicit timestamp, interval, ordering, gap, warm-up and insufficient-history semantics.
- Preserve exact decimal-string inputs where source data is decimal text; document any numerical method/precision constraints rather than silently converting financial values through binary floating point.
- Support both a single latest result and a historical result series when justified by the same coherent contract.
- Small cohesive modules and explicit public exports; no generic `common` dumping ground.
- No strategy policy: the consumer decides how an indicator result affects orders.
- Tests and documentation are part of every delivered capability.

## Related documents

- [Indicators roadmap](./ROADMAP.md)
- [Harvester adaptive price-step proposal](../../apps/harvester/ROADMAP.md)
- [Domain ownership](../../docs/engineering/DOMAIN_OWNERSHIP.md)
- [Workspace package map](../../docs/workspace-package-map.md)
- [Shared-utilities policy](../../docs/engineering/SHARED_UTILITIES_POLICY.md)
