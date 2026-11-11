# Indicators roadmap

- Status: In progress
- Owner: Indicators domain
- Package: `@coinzilla/indicators`
- First consumer: [Harvester volatility protection #1016](../../apps/harvester/docs/volatility-protection.md)
- Later consumer: [Harvester adaptive price step #1013](../../apps/harvester/ROADMAP.md)

## Current delivery

The first package capability is implemented in the open [PR #1018](https://github.com/45s/coinzilla/pull/1018). The package provides:

- Parameterized ATR series with standard initial simple-average seed and Wilder smoothing.
- NATR series, normalized against each matching candle close.
- A reusable exact current/reference volatility ratio.
- Strict completed-candle, OHLC, ordering, interval-continuity and precision validation.
- Immutable outputs, public exports, offline tests and enforced package coverage.

The implementation uses `@coinzilla/utils` exact decimal-string arithmetic. It does not use JavaScript Number for price/indicator values and introduces no exchange/network dependency.

## Remaining work

1. [~] **Finish first capability and merge PR #1018.** Keep exact reference examples, error-path tests, package metadata, README/AGENTS and workspace CI synchronized.
2. [ ] **Harvester candle lifecycle.** Add the normalized candle methods to Harvester's application-owned BrokerPort and adapter; load startup history, subscribe to live Kline events, retain completed candles, detect stale/gapped data and backfill after reconnect.
3. [ ] **Harvester protection policy.** Consume ATR/NATR/ratio per market; keep period/timeframe/reference-window choices, thresholds, hysteresis, fallback, Journal diagnostics, central BUY gate, owned-BUY cancellation and recovery-SELL exception in Harvester.
4. [ ] **Adaptive price step.** Treat PR #1013 as a separate strategy consumer. Keep baseline config unchanged; define coefficient bounds, floor behavior, affected strategies and order-replacement policy before implementation.
5. [ ] **Expand indicators only for concrete consumers.** EMA, SMA, RSI, MACD, Fibonacci and other candidates remain deferred until a consumer and calculation contract justify them.

## Calculation contract

- Inputs are caller-supplied completed candles with `openTime` in Unix milliseconds and exact decimal-string `high`, `low`, and `close` values.
- The caller supplies `intervalMs`; the package rejects duplicate, unordered or discontinuous candles rather than silently filling gaps.
- ATR's first True Range is high-low; the first ATR is the simple average of the first `period` True Ranges. Subsequent values use Wilder's recurrence.
- ATR/NATR output defaults to 18 fractional digits; volatility ratio defaults to 8. Both use half-up rounding unless the caller selects another supported mode.
- Division rounds to the configured scale at each operation. This is a deterministic decimal contract, not an exact rational-number representation.
- Insufficient history, invalid periods/scales, malformed OHLC, unfinished candles and invalid reference values fail with `TypeError` or `RangeError`.

## Ownership boundary

- Indicators owns pure calculations and their input/output contracts.
- Brokers owns venue-specific candle retrieval, stream lifecycle and DTO normalization.
- Harvester owns market-data history/freshness, trading policy, order lifecycle and operational fallbacks.
- Utils owns domain-neutral exact decimal arithmetic; it must not absorb indicator or strategy concepts.

No exchange operations are part of this package. It must never place, cancel or reprice orders.
