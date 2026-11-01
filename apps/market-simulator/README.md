# Market Simulator

**Package:** `@coinzilla/market-simulator`  
**Path:** `apps/market-simulator`

## Purpose

A deterministic, offline market simulator that exposes the existing Coinzilla `CoreBroker` contract. It can replay the repository's real DOGEUSDT history and simulate a deliberately documented subset of spot order execution. It never connects to an exchange.

## Clean Architecture

Dependencies point inward:

- **Domain:** immutable market-history validation, exact decimal arithmetic, and pure candle/order matching rules.
- **Application:** load-history and price-stream use cases, plus the strategy simulation runner.
- **Ports:** repository and scheduler contracts are expressed as the methods required by application use cases.
- **Infrastructure:** JSON history repository and replaceable timer scheduler.
- **Adapters:** `HistoricalMarketBroker` maps the existing `CoreBroker` interface to application use cases; `SimulatedExecutionBroker` adds an in-memory execution adapter.

Domain and application modules do not import `CoreBroker`, Binance SDKs, filesystem APIs, or Node timers. Concrete dependencies are wired at the adapter/composition boundary.

## Historical market data

The default source is `apps/bot-free-roll/doge-history.json`, read in place. It contains 10,080 DOGEUSDT one-minute candles. The fixture is not copied or modified.

`HistoricalMarketBroker`:

- loads and validates the history on `connect()`;
- streams candle close prices through `subscribeForPrices({ symbol, onPrice })`;
- preserves source decimal strings, timestamps and OHLCV fields;
- exposes latest prices through `getPrice(s)()`;
- defaults to 60x playback speed;
- automatically cleans up timers on completion, unsubscribe, and disconnect.

No manual stepping, pause, resume, or reset controls are provided.

## Simulated order execution

Use `SimulatedExecutionBroker` when the strategy needs order/account behavior as well as historical prices.

~~~js
import { SimulatedExecutionBroker, runStrategySimulation } from "@coinzilla/market-simulator"

const broker = new SimulatedExecutionBroker({
  markets: {
    DOGEUSDT: { baseAsset: "DOGE", quoteAsset: "USDT", pricePrecision: 5, quantityPrecision: 0 },
  },
  initialBalances: { USDT: "1000", DOGE: "0" },
  feeRate: "0.00075",
})

const report = await runStrategySimulation({
  broker,
  symbol: "DOGEUSDT",
  strategy: {
    async onStart({ broker }) {
      // Place initial orders here.
    },
    async onPrice(candle, { broker }) {
      // React to each historical candle and manage orders.
    },
    async onStop() {},
  },
})
~~~

### Explicit fill model

- `MARKET` orders fill immediately at the latest emitted candle close.
- `LIMIT` and `LIMIT_MAKER` orders rest until a candle low (BUY) or high (SELL) touches the limit price.
- Resting limit orders fill completely at their limit price. No price improvement is assumed.
- `LIMIT_MAKER` orders that would immediately take liquidity are rejected.
- Fees are a decimal fraction (for example `"0.00075"`) and are charged in the quote asset.
- BUY orders reserve quote funds including the fee; SELL orders reserve base quantity. Cancellation releases the reservation.
- Decimal calculations use string inputs and BigInt-backed fixed-point arithmetic.

This is a deterministic test model, not an exchange emulator. It does **not** model partial fills, queue priority, spread, slippage, market impact, intrabar price path, exchange latency, or exchange-specific filters beyond supplied market metadata. Do not use its results as a profitability guarantee or production execution estimate.

## Strategy runner

`runStrategySimulation({ broker, symbol, strategy, maxCandles })` runs optional `onStart`, serialized `onPrice` callbacks, then `onStop`, and returns a report containing processed candle count, balances, orders and fills. The strategy receives the same broker instance used by the runner and can call its normal broker methods.

## Tests

~~~sh
pnpm --filter @coinzilla/market-simulator test
pnpm --filter @coinzilla/market-simulator test:coverage
~~~

All unit tests are offline. Timer behavior is injected; no exchange credentials or network calls are required.
