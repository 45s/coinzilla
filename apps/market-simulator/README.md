# Market Simulator

**Package:** `@coinzilla/market-simulator`  
**Path:** `apps/market-simulator`

## Purpose

A mock implementation of Coinzilla's existing `CoreBroker` contract. It supplies historical market prices from the repository's real DOGEUSDT fixture and makes no exchange connections.

## Data source

By default, the broker reads `apps/bot-free-roll/doge-history.json` directly. The file contains **10,080 DOGEUSDT one-minute candles across seven days**. The source is not copied, changed, or fabricated.

## Broker behavior

`HistoricalMarketBroker` extends `CoreBroker`:

- `connect()` loads and validates the configured history.
- `subscribeForPrices({ symbol, onPrice })` emits each candle close through the existing callback contract, preserving source timestamps and OHLCV fields.
- `getPrices({ symbol })` and `getPrice({ symbol })` return the latest emitted close.
- `disconnect()` clears active subscriptions.

Default speed is 60x (one source minute per real second). Each subscription begins at the first candle and ends at the end of the file. There are no manual step, pause, resume, or reset APIs.

**Scope:** market data only. Order placement, balances, fills, account methods, and user-data events are not simulated; inherited `CoreBroker` methods fail explicitly. No real exchange requests or orders are made.

## Usage

~~~js
import { HistoricalMarketBroker } from "@coinzilla/market-simulator"

const broker = new HistoricalMarketBroker({ speed: 60 })
await broker.connect()

const result = await broker.subscribeForPrices({
  symbol: "DOGEUSDT",
  onPrice: (tick) => console.log(tick.timestamp, tick.price),
})

if (!result.ok) throw result.errors[0]

// Unsubscribe when the consumer is finished.
await result.data.unsubscribe()
await broker.disconnect()
~~~

A different compatible history can be supplied with `historyFile`; `speed` controls how quickly source candle intervals are emitted.

## Tests

~~~sh
pnpm --filter @coinzilla/market-simulator test
pnpm --filter @coinzilla/market-simulator test:coverage
~~~
