# Market Simulator

**Package:** `@coinzilla/market-simulator`  
**Path:** `apps/market-simulator`

A deterministic, offline market simulator for testing Coinzilla strategies against historical candles. It implements the existing `CoreBroker` contract and can simulate a documented subset of spot order execution. It never connects to an exchange.

## What it provides

- Replay the bundled 10,080 one-minute DOGEUSDT candles.
- Stream candle close prices through a `CoreBroker`-compatible broker.
- Run a strategy with `onStart`, `onPrice`, and `onStop` lifecycle hooks.
- Simulate MARKET, LIMIT, and LIMIT_MAKER spot orders.
- Track balances, locked funds, orders, fills, and quote-asset fees.
- Run offline and deterministically without exchange credentials.

## Requirements and setup

- Node.js `>=22.23.4`
- pnpm (use the version declared by the repository)

This is a private workspace package, not a published npm package. From the repository root, install workspace dependencies using the repository's normal setup:

```sh
pnpm install
```

Import it from another workspace package:

```js
import {
  HistoricalMarketBroker,
  SimulatedExecutionBroker,
  runStrategySimulation,
} from "@coinzilla/market-simulator"
```

## Usage examples

The examples below are written as ES modules and assume they run inside the Coinzilla pnpm workspace. All monetary values, prices, quantities, and fee rates passed to the simulator must be decimal **strings**.

### 1. Replay historical prices

Use `HistoricalMarketBroker` when you only need market data and do not need to place simulated orders.

```js
import { HistoricalMarketBroker } from "@coinzilla/market-simulator"

const broker = new HistoricalMarketBroker({
  speed: 60, // 60x real-time; one-minute candles are emitted about once per second
})

try {
  await broker.connect()

  const result = await broker.subscribeForPrices({
    symbol: "DOGEUSDT",
    onPrice(candle) {
      console.log({
        time: new Date(candle.eventTime).toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      })
    },
  })

  if (!result.ok) throw result.errors[0]

  // Resolves when playback finishes or the subscription is stopped.
  await result.data.done
} finally {
  // Safe to call even when playback has already completed.
  await broker.disconnect()
}
```

The default history file is `apps/bot-free-roll/doge-history.json`. It is read in place; the simulator does not copy or modify it. The bundled history contains only `DOGEUSDT`, so that is the symbol to subscribe to unless you supply another history source.

### 2. Run a strategy with simulated MARKET orders

Use `SimulatedExecutionBroker` when the strategy needs balances and order execution as well as candle prices.

This example buys 100 DOGE on the first candle and sells 100 DOGE on the fourth candle. It then prints the final report.

```js
import {
  SimulatedExecutionBroker,
  runStrategySimulation,
} from "@coinzilla/market-simulator"

const symbol = "DOGEUSDT"

const broker = new SimulatedExecutionBroker({
  markets: {
    [symbol]: {
      baseAsset: "DOGE",
      quoteAsset: "USDT",
      pricePrecision: 5,
      quantityPrecision: 0,
    },
  },
  initialBalances: {
    USDT: "1000",
    DOGE: "0",
  },
  feeRate: "0.00075", // 0.075%, charged in USDT
  onExecution({ type, fill }) {
    console.log(type, fill)
  },
})

let candlesSeen = 0

const report = await runStrategySimulation({
  broker,
  symbol,
  maxCandles: 20,
  strategy: {
    async onStart({ symbol }) {
      console.log("Starting simulation:", symbol)
    },

    async onPrice(candle, { broker }) {
      candlesSeen += 1

      if (candlesSeen === 1) {
        const result = await broker.createOrder({
          symbol,
          side: "BUY",
          type: "MARKET",
          quantity: "100",
        })

        if (!result.ok) throw result.errors[0]
        console.log("BUY order:", result.data)
      }

      if (candlesSeen === 4) {
        const result = await broker.createOrder({
          symbol,
          side: "SELL",
          type: "MARKET",
          quantity: "100",
        })

        if (!result.ok) throw result.errors[0]
        console.log("SELL order:", result.data)
      }

      console.log("Candle close:", candle.close)
    },

    async onStop({ symbol }) {
      console.log("Finished simulation:", symbol)
    },
  },
})

console.log("Processed candles:", report.candlesProcessed)
console.log("Final balances:", report.balances)
console.log("Order history:", report.orders)
console.log("Fills:", report.fills)
```

Important details:

- `runStrategySimulation()` connects the broker if it is not already connected, subscribes to prices, waits for the stream and all queued asynchronous `onPrice` callbacks, then calls `onStop`.
- `maxCandles` is optional; when omitted, the runner processes the complete history.
- The runner disconnects the broker only if it connected it. It always unsubscribes its own price subscription.
- The runner does **not** cancel outstanding orders automatically. Open orders remain visible in the returned order history with status `NEW`.
- A strategy callback should check `result.ok` for broker operations and throw or handle `result.errors` explicitly.

### 3. Place and inspect a resting LIMIT order

A LIMIT order reserves the required funds immediately and remains open until a later candle touches its price. For a BUY, the candle low must be at or below the limit; for a SELL, the candle high must be at or above it.

Place an order from `onStart`:

```js
const strategy = {
  async onStart({ broker, symbol }) {
    const result = await broker.createOrder({
      symbol,
      side: "BUY",
      type: "LIMIT",
      quantity: "100",
      price: "0.10",
    })

    if (!result.ok) throw result.errors[0]
    console.log("Placed limit order:", result.data)
  },

  async onPrice(candle, { broker }) {
    const result = await broker.getOpenOrders({ symbol: candle.symbol })
    if (!result.ok) throw result.errors[0]

    console.log("Still-open orders:", result.data)
  },
}
```

The example price `0.10` is illustrative, not a promise that the bundled history will reach it. Choose a limit price appropriate to the history being replayed.

Cancel an unfilled order using its returned order ID:

```js
const result = await broker.cancelOrder({
  symbol: "DOGEUSDT",
  orderId: "1",
})

if (!result.ok) throw result.errors[0]
console.log("Canceled order:", result.data)
```

Cancellation releases the funds reserved for that order.

### 4. Read balances, orders, and fills

The simulated broker exposes account and order information using result objects:

```js
const [balances, openOrders, orderHistory, fills] = await Promise.all([
  broker.getBalances(),
  broker.getOpenOrders({ symbol: "DOGEUSDT" }),
  broker.getOrderHistory({ symbol: "DOGEUSDT" }),
  broker.getFills({ symbol: "DOGEUSDT" }),
])

for (const result of [balances, openOrders, orderHistory, fills]) {
  if (!result.ok) throw result.errors[0]
}

console.log("Balances:", balances.data)
console.log("Open orders:", openOrders.data)
console.log("All orders:", orderHistory.data)
console.log("Fills:", fills.data)
```

A balance contains `asset`, `free`, `locked`, and `total`. Order history includes open, filled, and canceled orders. A fill includes the execution price, quantity, quote quantity, commission, commission asset, and timestamp.

## Configuration

### HistoricalMarketBroker

| Option | Description | Default |
|---|---|---|
| `historyFile` | JSON candle history file path | Bundled DOGEUSDT fixture |
| `history` | In-memory history object; when supplied, it is used instead of `historyFile` | Not set |
| `speed` | Playback speed multiplier; must be a positive finite number | `60` |
| `scheduler` | Injected scheduler implementation for playback | Internal timeout scheduler |
| `setTimeoutFn` / `clearTimeoutFn` | Timer functions used when no scheduler is supplied | Node.js timers |
| `logger` | Optional logger passed to `CoreBroker` | Broker default |

### SimulatedExecutionBroker

It accepts all `HistoricalMarketBroker` options, plus:

| Option | Description | Default |
|---|---|---|
| `markets` | Required symbol metadata map containing `baseAsset`, `quoteAsset`, `pricePrecision`, and `quantityPrecision` | Required |
| `initialBalances` | Initial free balances keyed by asset; amounts must be non-negative decimal strings | `{}` |
| `feeRate` | Non-negative fee fraction charged in the quote asset (for example, `"0.00075"` = 0.075%) | `"0.00075"` |
| `onExecution` | Optional callback invoked when an order fills | Not set |

For example, a fee rate of `"0.001"` means 0.1%, not 0.001%.

## Order execution model

| Order type | Behavior |
|---|---|
| `MARKET` | Fills immediately at the latest emitted candle close. |
| `LIMIT` BUY | Rests until a candle low is at or below the limit price; fills fully at the limit price. |
| `LIMIT` SELL | Rests until a candle high is at or above the limit price; fills fully at the limit price. |
| `LIMIT_MAKER` | Uses the same resting fill rules, but is rejected if it would immediately take liquidity at submission time. |

Additional accounting rules:

- BUY orders reserve quote funds for quantity × limit/market price plus the fee.
- SELL orders reserve the base quantity.
- Filled BUY orders credit the base asset and debit quote funds plus the fee.
- Filled SELL orders debit the base asset and credit quote proceeds minus the fee.
- Canceling an open order releases its remaining reservation.
- Price, quantity, balance, and fee arithmetic uses string inputs and BigInt-backed fixed-point decimal operations. Do not convert trading amounts to JavaScript `Number` before passing them to the broker.

## Public API overview

| Export | Purpose |
|---|---|
| `HistoricalMarketBroker` | Historical candle playback through the `CoreBroker` interface. |
| `SimulatedExecutionBroker` | Historical playback plus in-memory spot order execution and account state. |
| `runStrategySimulation(options)` | Runs a strategy lifecycle against a broker and returns a final report. |
| `JsonMarketHistoryRepository` | Reads JSON history from a file or supplied in-memory history. |
| `TimeoutScheduler` | Default timer-based playback scheduler. |
| `validateMarketHistory(history)` | Validates a market-history object. |
| `loadMarketHistory(options)` / `createPriceStream(options)` | Application use cases for loading and streaming history. |
| Decimal and order-matching functions | Pure domain functions exported for focused use and testing. |

### Strategy lifecycle contract

`runStrategySimulation({ broker, symbol, strategy, maxCandles })` expects:

- `strategy.onStart({ broker, symbol })` — optional; called once before subscribing.
- `strategy.onPrice(candle, { broker })` — required; called for each candle. Async callbacks are serialized, so the next strategy callback waits for the previous one to finish.
- `strategy.onStop({ broker, symbol })` — optional; called after playback and queued price callbacks finish successfully.

The runner returns:

```js
{
  symbol,
  candlesProcessed,
  balances, // array of balance records
  orders,   // order history for the symbol
  fills,    // fills for the symbol
}
```

The runner is strategy-agnostic. An existing bot is **not** automatically instantiated or adapted by this package; its lifecycle and broker dependencies must be integrated explicitly.

## Architecture

Dependencies point inward:

- **Domain:** market-history validation, exact decimal arithmetic, and pure candle/order matching rules.
- **Application:** history loading, price streaming, and strategy simulation orchestration.
- **Ports:** repository and scheduler contracts are expressed by the methods required by application use cases.
- **Infrastructure:** JSON history repository and replaceable timer scheduler.
- **Adapters:** `HistoricalMarketBroker` maps the existing `CoreBroker` interface to application use cases; `SimulatedExecutionBroker` adds in-memory execution behavior.

Domain and application modules do not import `CoreBroker`, Binance SDKs, filesystem APIs, or Node timers. Concrete dependencies are wired at the adapter/composition boundary.

## Limitations and interpretation

This is a deterministic test model, not an exchange emulator or a profitability estimator. It does **not** model:

- Partial fills, order-book queue priority, or price improvement.
- Bid/ask spread, slippage, market impact, or exchange latency.
- The order in which high and low were reached inside a candle.
- Exchange-specific filters beyond the market metadata supplied by the caller.
- User-data streams, leverage, margin, funding, liquidation, or derivatives.

A limit order that is touched by a candle is assumed to fill completely at its limit price. A market order is filled at the latest candle close. Results therefore cannot establish how a strategy would perform in a live market.

## Tests

From the repository root:

```sh
pnpm --filter @coinzilla/market-simulator test
pnpm --filter @coinzilla/market-simulator test:coverage
```

All package unit tests are offline. Timer behavior is injected; no exchange credentials or network calls are required.
