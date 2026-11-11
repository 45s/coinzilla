# Broker–Harvester Trading Flow (Text Version)

This is the Mermaid-free companion to [Broker–Harvester Trading Flow](./BROKER_HARVESTER_TRADING_FLOW.md). It documents the same current Conservative trading path using ordinary Markdown, so the flow remains readable in tools that do not render Mermaid.

## Responsibilities

### Broker and Binance adapter

The broker boundary owns exchange communication and translates exchange-specific responses into application-facing values.

| Capability | Method | What it does |
| --- | --- | --- |
| Live market price | `subscribeForPrices({ symbol, onPrice })` | Streams normalized market-price events to Harvester. |
| Startup price snapshot | `getPrices({ symbol })` | Requests a ticker snapshot when no fresh stream price arrived during startup. |
| Historical candles | `getCandles({ symbol, interval, limit, startTime?, endTime? })` | Exposes normalized candle history through the port; bootstrap does not yet call it. |
| Live candle updates | `subscribeForCandles({ symbol, interval, onCandle })` | Exposes normalized Kline updates and unsubscribe lifecycle; bootstrap does not yet subscribe. |
| Market constraints | `getSymbolFilters({ symbol })` | Loads and normalizes the enabled symbol's trading filters. |
| Best bid / ask | `subscribeForBookTicker({ symbol, onBookTicker })` | Streams order-book top-of-book data for LIMIT_MAKER safety checks. |
| Submit an order | Harvester port: `placeOrder({ order })` | Submits an application order through the adapter. |
| Binance order creation | `createCanonicalOrder(order)` or `createOrder(order)` | Adapter prefers canonical submission when supported; otherwise uses the regular Binance client method. |
| User-data events | `subscribeForUserData({ onEvent })` | Streams normalized order lifecycle and execution events. |
| Execution history | `getFills({ symbol, orderId })` | Retrieves canonical fills for immediate reconciliation when submission already reports FILLED. |

`createCanonicalOrder()` and `createOrder()` belong to the shared Binance client, not the Harvester application port. Harvester submits only through `broker.placeOrder({ order })`.

The historical/live candle methods are required by the Harvester port and forwarded by its Binance adapter ([PR #1019](https://github.com/45s/coinzilla/pull/1019)). They are available capabilities only; the startup sequence below remains the current runtime and does not fetch candle history or subscribe to Kline streams yet.

### Harvester

| Component / method | Responsibility |
| --- | --- |
| Bootstrap | Composes the broker, engine, strategy policy, and accounting workflow; loads market filters and establishes subscriptions. |
| `processMarketPrice()` | Passes an incoming price event into the trading engine. |
| `makeConservativeTradingEngine()` | Coordinates serialized market and user-data transitions, strategy evaluation, safety checks, order submission, and fill processing. |
| Conservative strategy policy | Chooses BUY, SELL, or NO_ACTION from the current price, configuration, Portfolio, RecoveryLedger, and active-order state. It does not call the broker. |
| `updateTradingAccounting({ fill })` | Applies an actual canonical fill to Portfolio and RecoveryLedger. |

## End-to-end flow

### 1. Startup and market preparation

1. Bootstrap creates the Binance broker adapter and the Conservative Trading Engine.
2. For every enabled symbol, bootstrap calls `getSymbolFilters({ symbol })`.
3. The adapter requests exchange trading information and returns normalized market metadata.
4. Bootstrap establishes `subscribeForUserData({ onEvent })` before market intake begins.
5. When TESTNET trading is enabled, bootstrap also establishes `subscribeForBookTicker({ symbol, onBookTicker })`. The engine caches the best bid / ask for fresh LIMIT_MAKER crossing checks. This is a safety input, not the strategy's market-price input.
6. Bootstrap establishes `subscribeForPrices({ symbol, onPrice })` for each enabled symbol.
7. After subscriptions are established, bootstrap calls `getPrices({ symbol })` to obtain an initial ticker snapshot. It seeds the engine only if no fresh WebSocket price was received for that symbol. The current Binance implementation uses a `ticker.price` request/response over its WebSocket API; it is not an HTTP REST request.

### 2. Market price to strategy decision

1. Binance sends a market-price update.
2. The adapter normalizes it and invokes the supplied `onPrice` callback.
3. Bootstrap forwards the event to `processMarketPrice()` on the engine.
4. The engine invokes the Conservative strategy policy with the current market price and relevant trading state: pair configuration, settings, Portfolio, RecoveryLedger, and active orders.
5. The strategy returns one of:
   - **BUY** — request a buy order.
   - **SELL** — request a recovery sell order.
   - **NO_ACTION** — do not submit an order.
6. The strategy returns a decision; it does not communicate with Binance or submit the order itself.

### 3. Order submission and acknowledgement

1. For a BUY or SELL action, the engine creates/submits the application order through `broker.placeOrder({ order })`.
2. The adapter selects `createCanonicalOrder(order)` when the Binance client supports it; otherwise it calls `createOrder(order)`.
3. Binance responds with an order acknowledgement.
4. The adapter returns a normalized acknowledged order to the engine.
5. The engine updates its order lifecycle / registry state.

**Important:** an acknowledgement is not a fill. It confirms the submission response; it does not prove that any quantity traded and does not update Portfolio or RecoveryLedger holdings.

### 4. Actual execution and accounting

1. When an order executes, Binance sends a user-data `executionReport`.
2. The broker normalizes the order update. For `executionType: "TRADE"`, it also normalizes the actual execution into a canonical Fill.
3. The adapter forwards the normalized event through `onEvent`.
4. Bootstrap passes the event to the engine's user-data event handler.
5. The engine validates the registered order and canonical Fill identity.
6. For a TRADE event, the engine calls `updateTradingAccounting({ fill })`.
7. Accounting applies that fill to both Portfolio and RecoveryLedger, including the actual execution and commission facts.
8. For a status-only order update with no trade, the engine updates order lifecycle state but does not change Portfolio or RecoveryLedger holdings.

### 5. Immediate-FILLED reconciliation

Sometimes the submission acknowledgement already reports the order as FILLED. In that case, the engine calls `getFills({ symbol, orderId })`, retrieves canonical execution history, and applies the returned fills through the accounting workflow before completing that serialized transition.

## Rules to keep clear

- **Market prices trigger strategy evaluation; they are not fills.**
- **The strategy decides; the engine coordinates and submits.**
- **Harvester submits through `placeOrder({ order })`; Binance method names stay inside the adapter boundary.**
- **An order acknowledgement is not proof of execution.**
- **Only canonical actual fills update Portfolio and RecoveryLedger.**
- **Book ticker data is used for LIMIT_MAKER safety checks, not as the Conservative strategy's price-decision input.**

## Source references

- [Harvester broker port](../../src/application/ports/broker.port.js)
- [Binance broker adapter](../../src/infrastructure/brokers/binance-broker-adapter.js)
- [Bootstrap composition and subscriptions](../../src/bootstrap/start-harvester.js)
- [Conservative Trading Engine](../../src/use-cases/conservative-trading-engine.js)
- [Market-price use case](../../src/use-cases/process-market-price.js)
- [Trading accounting use case](../../src/use-cases/update-trading-accounting.js)
- [Harvester Broker Port and Adapter](../infrastructure/broker-port-and-adapter.md)
