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

The historical/live candle methods are required by the Harvester port and forwarded by its Binance adapter ([PR #1019](https://github.com/45s/coinzilla/pull/1019)). The startup sequence composes the candle-history service ([PR #1021](https://github.com/45s/coinzilla/pull/1021)). The service remains a data producer separate from strategy decisions; bootstrap forwards its snapshots to the engine's separate protection state machine and central submission gate ([PR #1041](https://github.com/45s/coinzilla/pull/1041)). See [Volatility Protection](../volatility-protection.md) for the canonical policy.

### Harvester

| Component / method | Responsibility |
| --- | --- |
| Bootstrap | Composes the broker, engine, strategy policy, and accounting workflow; loads market filters and establishes subscriptions. |
| `processMarketPrice()` | Passes an incoming price event into the trading engine. |
| `makeConservativeTradingEngine()` | Coordinates serialized market and user-data transitions, strategy evaluation, safety checks, order submission, and fill processing. |
| Conservative strategy policy | Chooses BUY, SELL, or NO_ACTION from the current price, configuration, Portfolio, RecoveryLedger, and active-order state. It does not call the broker. |
| `updateTradingAccounting({ fill })` | Applies an actual canonical fill to Portfolio and RecoveryLedger. |
| Volatility protection state machine and submission gate | `processVolatilitySnapshot()` and the central `canSubmit` gate | Maintains per-market protection state, cancels eligible owned BUYs, blocks ordinary submissions while data is unavailable or protection is active, and permits only explicitly marked recovery SELLs through the volatility gate. |

## End-to-end flow

### 1. Startup and market preparation

1. Bootstrap creates the Binance broker adapter and the Conservative Trading Engine.
2. For every enabled symbol, bootstrap calls `getSymbolFilters({ symbol })`.
3. The adapter requests exchange trading information and returns normalized market metadata.
4. Bootstrap establishes `subscribeForUserData({ onEvent })` before market intake begins.
5. When TESTNET trading is enabled, bootstrap also establishes `subscribeForBookTicker({ symbol, onBookTicker })`. The engine caches the best bid / ask for fresh LIMIT_MAKER crossing checks. This is a safety input, not the strategy's market-price input.
6. Bootstrap establishes `subscribeForPrices({ symbol, onPrice })` for each enabled symbol.
7. After subscriptions are established, bootstrap calls `getPrices({ symbol })` to obtain an initial ticker snapshot. It seeds the engine only if no fresh WebSocket price was received for that symbol. The current Binance implementation uses a `ticker.price` request/response over its WebSocket API; it is not an HTTP REST request.
8. Bootstrap then subscribes to one-minute Kline streams for every enabled market before requesting candle history.
9. It requests 101 historical candles, filters the forming final bar, retains up to 100 completed candles, and merges live events buffered during warm-up.
10. On a detected gap, the service immediately marks that market unavailable while it requests the exact missing time range. Readiness returns only after the full contiguous range is restored; a forming candle can reveal a gap but is never appended to indicator history.
11. It calculates ATR(14), NATR and the ratio against the previous 60 NATR observations. Only valid current Kline events refresh stream freshness; delayed events older than the retained history are ignored. Unsubscribe drains accepted candle/backfill work before shutdown continues, while preserving any unsubscribe error. The per-market data/readiness snapshot is exposed through runtime `getVolatilityData({ symbol })`; bootstrap forwards each snapshot to `tradingEngine.processVolatilitySnapshot()` so the engine can update its per-market protection state and central submission gate.

### 1a. Volatility protection and central order gate

The candle-history service reports data readiness and metrics; the Trading Engine owns the trading policy. Bootstrap forwards each snapshot to `processVolatilitySnapshot()`, which updates the per-market state machine. The engine starts fail-closed while history is unavailable. A ratio at or above the protection threshold enters `PROTECTED` and triggers cancellation only for acknowledged, Harvester-owned active BUYs (OPEN or PARTIALLY_FILLED). The cancellation path reconciles the canonical terminal order and any fills that raced with cancellation; an unresolved order remains active and prevents recovery.

The central submission gate blocks ordinary strategy orders when candle data is not ready, the market is `PROTECTED` or `RECOVERING`, or the latest ratio is at or above the protection threshold. Only an explicitly marked `RECOVERY_SELL` may pass the volatility-specific gate; a SELL side alone is not sufficient. Existing recovery SELLs are not canceled or repriced by volatility protection. Recovery to `NORMAL` requires three distinct completed candles at or below the recovery threshold, ready/fresh data, and resolution of owned-BUY cancellation/fill reconciliation. The warning threshold is diagnostic and does not independently activate protection. All provisional thresholds and exact transition rules are defined in [Volatility Protection](../volatility-protection.md); historical calibration remains open.

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

1. Before broker I/O, the central submission gate evaluates pause state, unowned orders, trading readiness, fresh market price, volatility readiness/protection and the remaining order-safety conditions. Only an explicitly marked recovery SELL may pass the volatility-specific exception.
2. A denied intent returns `deferred: true` with a stable reason and safe context; no broker call is made. For a multi-action decision, any earlier acknowledged orders remain in `submittedOrders`.
3. For an action admitted by the gate, the engine registers a local PENDING order and durably publishes the submission intent.
4. The engine repeats the submission gate after the durable-intent barrier. If readiness changed, it removes the local PENDING order and returns the exact deferral reason without calling the broker.
5. Only an action that passes both checks reaches `broker.placeOrder({ order })`.
6. The adapter selects `createCanonicalOrder(order)` when the Binance client supports it; otherwise it calls `createOrder(order)`.
7. Binance responds with an order acknowledgement.
8. The adapter returns a normalized acknowledged order to the engine, which updates its order lifecycle / registry state.

A successful deferral is not a broker rejection or acknowledgement. `ok: true` means the use case completed without an execution error; inspect `deferred`, `reason`, `deferralDetails`, and `submittedOrders` to determine whether an order reached the broker. See [Submission deferrals and missing-order diagnostics](../operations/submission-deferrals.md) for the complete reason catalogue.

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
- [Volatility protection state machine](../../src/domain/market/volatility-protection-state.js)
- [Volatility protection state-machine tests](../../src/domain/market/volatility-protection-state.test.js)
- [Harvester Broker Port and Adapter](../infrastructure/broker-port-and-adapter.md)
