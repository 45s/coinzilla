# @coinzilla/indicators

Reusable, deterministic, exchange-neutral technical indicator calculations over caller-supplied completed market candles.

- Owner: Indicators domain
- First consumer: Harvester high-volatility protection ([issue #1016](https://github.com/45s/coinzilla/issues/1016)); per-market ATR/NATR measurements are consumed by Harvester in merged [PR #1037](https://github.com/45s/coinzilla/pull/1037). Harvester's protection policy is implemented separately in [PR #1038](https://github.com/45s/coinzilla/pull/1038); thresholds still require offline historical validation.
- Later consumer: Harvester adaptive price-step planning ([PR #1013](https://github.com/45s/coinzilla/pull/1013))
- Runtime dependencies: `@coinzilla/utils` for exact decimal-string arithmetic; no exchange SDK or network dependency

## Public API

Import supported functions from the package entry point:

```js
import {
  calculateAtrSeries,
  calculateNatrSeries,
  calculateVolatilityRatio,
} from "@coinzilla/indicators"
```

### Candle input

ATR and NATR accept an array of completed candles with this minimum shape:

```js
{
  openTime: 1_700_000_000_000, // Unix milliseconds
  high: "12.50",
  low: "12.00",
  close: "12.25",
  isClosed: true,
}
```

Each call must contain candles from one market and one timeframe; the caller owns that grouping. The caller supplies `intervalMs` so the package can reject duplicate, unordered or missing bars. Candle timestamps must be non-negative safe integers and consecutive candles must be exactly one interval apart. `high`, `low` and `close` must be exact positive decimal strings; close must lie within the high-low range. Forming candles are rejected.

### ATR

`calculateAtrSeries({ candles, intervalMs, period, outputScale = 18, rounding = "half-up" })` returns an immutable series of `{ openTime, value }` observations.

- True Range is the maximum of high-low, absolute high-to-previous-close and absolute low-to-previous-close.
- The first candle's True Range is high-low because no previous close exists.
- The first ATR is the simple average of the first `period` True Ranges.
- Later observations use Wilder smoothing: `((previous ATR × (period - 1)) + current TR) / period`.
- The first result is timestamped at candle `period - 1`; later results are timestamped at their corresponding candle.

Example with period 2:

```js
const atr = calculateAtrSeries({
  candles,
  intervalMs: 60_000,
  period: 2,
  outputScale: 8,
})
// [{ openTime: 60000, value: "2.5" }, { openTime: 120000, value: "2.75" }]
```

### NATR and volatility ratio

`calculateNatrSeries(options)` uses the matching candle close for each ATR observation and returns `ATR / Close × 100` as a percentage.

`calculateVolatilityRatio({ current, reference, outputScale = 8, rounding = "half-up" })` returns the exact decimal-string ratio `current / reference`. Current volatility may be zero; the reference must be positive. Selecting a reference window or averaging its observations is consumer policy, not part of this calculation.

## Precision and errors

- Price inputs and all returned measurements are decimal strings; JavaScript Number inputs are rejected.
- Division uses `@coinzilla/utils` exact decimal arithmetic with an explicit output scale (0–100) and rounding mode: `toward-zero`, `away-from-zero` or `half-up`.
- ATR and NATR default to 18 fractional digits and half-up rounding. The volatility ratio defaults to 8 fractional digits and half-up rounding.
- Wilder's recursive ATR calculation rounds each division to the requested output scale; later values use that rounded prior ATR.
- Invalid options, malformed OHLC values, unfinished candles, non-contiguous history and insufficient history throw `TypeError` or `RangeError`. No missing candle is fabricated or interpolated.
- Returned arrays and observations are frozen.

## Ownership and non-goals

Indicators owns mathematical calculations only. Brokers owns exchange data retrieval and normalization. Harvester owns candle-history lifecycle, reference-window selection, thresholds, hysteresis, fallbacks, configuration, order gates and recovery SELL policy.

This package does not fetch market data, persist history, generate trading signals, place/cancel/reprice orders, or define strategy defaults. Harvester's initial use of 1-minute candles, ATR period 14 and a 60-observation reference is caller policy, not a package-wide default.

## Development

```sh
pnpm --filter @coinzilla/indicators test
pnpm --filter @coinzilla/indicators run test:coverage
```

The package coverage command enforces at least 90% line and 85% branch coverage. Tests are deterministic, offline and credential-free.
