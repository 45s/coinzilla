# Broker–Harvester Trading Flow

This document describes the current Conservative trading path at the application/infrastructure boundary. Method names and responsibilities below were checked against the Harvester broker port, Binance adapter, bootstrap, Trading Engine, and shared Binance broker implementation. A [Mermaid-free text version](./BROKER_HARVESTER_TRADING_FLOW_TEXT.md) is also available.

## Responsibilities

### Broker and infrastructure adapter — exchange communication

The Binance broker and Harvester adapter perform exchange I/O and translate exchange data into normalized application-facing values.

| Capability | Current method / boundary | Responsibility |
| --- | --- | --- |
| Live market prices | `subscribeForPrices({ symbol, onPrice })` | Subscribes to the aggregate-trade price stream and invokes `onPrice` with a normalized price event. |
| Initial ticker price | `getPrices({ symbol })` | Requests a ticker snapshot when startup has not received a fresh stream price. |
| Trading constraints | `getSymbolFilters({ symbol })` | Loads symbol filters and converts them into Harvester market metadata. |
| Best bid/ask | `subscribeForBookTicker({ symbol, onBookTicker })` | Delivers normalized best-bid/best-ask updates used by the trading engine's LIMIT_MAKER safety checks. |
| Submit an order | Harvester port: `placeOrder({ order })`; Binance client: `createCanonicalOrder(order)` or `createOrder(order)` | The adapter prefers canonical submission when the client supports it; otherwise it uses the regular order method. |
| User-data events | `subscribeForUserData({ onEvent })` | Delivers order updates. For execution reports, the Binance broker normalizes the order and, for TRADE events, the execution into canonical values before forwarding the event. |

The adapter is `src/infrastructure/brokers/binance-broker-adapter.js`; the application-owned contract is `src/application/ports/broker.port.js`. Binance-specific API operations, stream names, and payload mappings stay behind this boundary.

**Naming clarification:** `createCanonicalOrder()` and `createOrder()` are methods on the shared Binance broker client, not Harvester's application port. Harvester submits through `broker.placeOrder({ order })`. Likewise, `subscribeForBookTicker()` is an available broker-port capability; it supplies order-book safety data and is not the Conservative price-decision input.

### Harvester — trading decisions and accounting

| Method / component | Responsibility |
| --- | --- |
| `processMarketPrice()` | Validates and processes an incoming market-price event in the Trading Engine. |
| `makeConservativeTradingEngine()` | Coordinates serialized market/order transitions, strategy evaluation, shared safety checks, order submission, order ownership, and execution processing. |
| Conservative strategy policy | Decides whether to BUY, SELL, or take NO_ACTION from market, configuration, Portfolio, RecoveryLedger, and active-order facts. It does not communicate with the exchange or submit orders. |
| `updateTradingAccounting({ fill })` | Applies one canonical actual fill to Portfolio and RecoveryLedger as one accounting transition. |

Bootstrap composes the broker adapter, engine, strategy policy, and accounting workflow. The engine uses the injected broker port; the strategy policy remains exchange-independent.

## Interaction diagram

The sequence below separates the order acknowledgement from the later execution report. Acknowledgement confirms the broker's response to submission; it does **not** by itself mean the order has filled or change Portfolio holdings.

```mermaid
sequenceDiagram
participant Binance as Binance
participant Broker as Binance broker + Harvester adapter
participant Bootstrap as Harvester bootstrap / intake
participant Engine as Conservative Trading Engine
participant Strategy as Conservative strategy
participant Accounting as updateTradingAccounting
participant Portfolio
participant Ledger as RecoveryLedger

Note over Bootstrap,Broker: Startup setup for each enabled symbol
Bootstrap->>Broker: getSymbolFilters({ symbol })
Broker->>Binance: exchangeInfo request
Binance-->>Broker: Exchange trading filters
Broker-->>Bootstrap: normalized market metadata

Note over Bootstrap,Broker: User-data subscription is established before market intake
Bootstrap->>Broker: subscribeForUserData({ onEvent })

opt TESTNET trading — order-book safety input
    Bootstrap->>Broker: subscribeForBookTicker({ symbol, onBookTicker })
    Binance-->>Broker: best bid / ask stream update
    Broker-->>Bootstrap: normalized bookTicker
    Bootstrap->>Engine: processBookTicker({ symbol, bookTicker })
    Note over Engine: Cached for fresh LIMIT_MAKER crossing checks; not a strategy price decision
end

Bootstrap->>Broker: subscribeForPrices({ symbol, onPrice })
Binance-->>Broker: aggregate-trade market price
Broker-->>Bootstrap: onPrice(priceEvent)
Bootstrap->>Engine: processMarketPrice({ symbol, priceEvent, pairConfig, settings })
Engine->>Strategy: evaluate(current price, Portfolio, RecoveryLedger, active orders)
Strategy-->>Engine: BUY / SELL decision or NO_ACTION

alt NO_ACTION
    Note over Engine,Strategy: No order is submitted
else BUY or SELL action
    Engine->>Broker: placeOrder({ order })
    Note over Broker: Adapter selects createCanonicalOrder(order) when available; otherwise createOrder(order)
    Broker->>Binance: order.place
    Binance-->>Broker: order acknowledgement
    Broker-->>Engine: normalized acknowledged order
    Note over Engine: Register/update order state; acknowledgement is not a fill
end

opt No fresh stream price arrived during startup
    Bootstrap->>Broker: getPrices({ symbol })
    Broker->>Binance: ticker.price request/response
    Binance-->>Broker: initial ticker snapshot
    Broker-->>Bootstrap: ticker price
    Bootstrap->>Engine: processMarketPrice({ symbol, priceEvent })
    Note over Bootstrap: Seed only if no fresh WebSocket price was received
end

Note over Binance,Broker: Actual execution is reported separately from submission acknowledgement
Binance-->>Broker: user-data executionReport
Note over Broker: Normalize executed order; for executionType=TRADE, normalize canonical Fill
Broker-->>Bootstrap: onEvent({ event: normalized execution report })
Bootstrap->>Engine: processUserDataEvent({ event })

alt executionType = TRADE
    Engine->>Engine: Validate registered order and canonical Fill identity
    Engine->>Accounting: updateTradingAccounting({ fill })
    Accounting->>Portfolio: applyFill({ fill })
    Accounting->>Ledger: applyFill({ fill })
    Accounting-->>Engine: updated Portfolio + RecoveryLedger
    Note over Portfolio,Ledger: Actual fill facts and commissions update both accounting projections
    Engine-->>Bootstrap: execution processed
else order status update without a trade
    Engine->>Engine: Update order lifecycle / registry
    Note over Engine,Portfolio: No fill means no Portfolio or RecoveryLedger accounting change
end

opt Submission acknowledgement already reports FILLED
    Engine->>Broker: getFills({ symbol, orderId })
    Broker-->>Engine: canonical execution history
    Engine->>Accounting: Apply reconciled canonical fills
end
```

## Startup paths and important distinctions

- **Market filters:** bootstrap loads `getSymbolFilters({ symbol })` for every enabled symbol before it starts market subscriptions. The Harvester's process-local `marketMetadata` map retains the startup snapshot for strategy use. The Binance adapter itself does not cache exchange filters: each `getSymbolFilters` request fetches current exchange metadata and normalizes it. Current bootstrap loads the map once; no background refresh is claimed.
- **Initial price fallback:** bootstrap first establishes every enabled market-price subscription. It then calls `getPrices({ symbol })` and seeds the engine only when no fresh WebSocket price was received for that symbol. The current Binance implementation sends `ticker.price` as a request/response operation over its WebSocket API; it is **not an HTTP REST call**.
- **Book ticker:** when TESTNET trading is enabled, bootstrap subscribes to best bid/ask updates and forwards them to `processBookTicker()`. The engine uses fresh same-symbol book data to reject a crossing `LIMIT_MAKER` order before submission.
- **Acknowledgement versus execution:** `placeOrder()` returns an order acknowledgement/status. It is not evidence that any quantity traded. A later `executionReport` with `executionType: "TRADE"` carries the actual execution. If the submission acknowledgement itself is already `FILLED`, the engine retrieves canonical fills with `getFills()` and reconciles/applies them before completing that serialized transition.
- **Accounting authority:** only canonical actual fills update Portfolio and RecoveryLedger. Status-only reports, market prices, order requests, and acknowledgements do not change holdings.

## Source references

- [Harvester broker port](../../src/application/ports/broker.port.js)
- [Binance broker adapter](../../src/infrastructure/brokers/binance-broker-adapter.js)
- [Bootstrap composition and subscriptions](../../src/bootstrap/start-harvester.js)
- [Conservative Trading Engine](../../src/use-cases/conservative-trading-engine.js)
- [Market-price use case](../../src/use-cases/process-market-price.js)
- [Trading accounting use case](../../src/use-cases/update-trading-accounting.js)
- [Harvester Broker Port and Adapter](../infrastructure/broker-port-and-adapter.md)
- [Harvester Architecture](../architecture.md)
