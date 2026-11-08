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


## Conservative trailing-BUY replacement safety

The following flow is the implemented replacement lifecycle, including the preflight boundary and failure handling after the old order is canceled.

```mermaid
flowchart TD
    A[Market-price event enters serialized transition] --> B{Acknowledged active BUY and no active position?}
    B -- No --> Z[Continue normal Conservative evaluation]
    B -- Yes --> C{Trailing repricing trigger reached and engine not stopping?}
    C -- No --> Z
    C -- Yes --> D[Fetch current Binance symbol filters]
    D --> E{Refresh complete and same active market?}
    E -- No --> P[Pause pair; leave existing BUY untouched]
    E -- Yes --> F[Evaluate Conservative at current price; exclude old BUY from commitments]
    F --> G[Allocate commitments and build executable actions]
    G --> H{Executable replacement BUY exists?}
    H -- No --> K[Keep existing BUY; skip or defer replacement]
    H -- Yes --> I[Build canonical preflight order]
    I --> J[Validate exchange filters and submission readiness]
    J --> L{Preflight admissible?}
    L -- Invalid --> P
    L -- Not ready --> K
    L -- Yes --> M[Check cancellation eligibility and durably record cancel intent]
    M --> N{Cancellation may proceed?}
    N -- No --> P
    N -- Yes --> O[Cancel existing BUY and request canonical confirmation]
    O --> Q{Canonical cancellation result received?}
    Q -- No or unknown --> R[Mark old order UNKNOWN; pause and reconcile]
    Q -- Yes --> S[Update registry; fetch fills; verify identity and executed quantity; apply actual fills]
    S --> T{Order is CANCELED with zero reconciled fills?}
    T -- No --> U[Pause; do not replace after fill race or reconciliation failure]
    T -- Yes --> V{Still trading-ready and not stopping?}
    V -- No --> W[Leave old BUY canceled; defer until readiness returns]
    V -- Yes --> X[Re-evaluate with refreshed rules and current-price reference]
    X --> Y[Rebuild and revalidate actual order; register PENDING and durably record submission intent]
    Y --> AA{Broker submission outcome?}
    AA -- Acknowledged --> AB[Register acknowledgement; continue trading]
    AA -- Definite POST_ONLY would-take --> AC[Remove pending; clear book; defer until fresh book]
    AA -- Other rejection or unknown outcome --> AD[Mark replacement UNKNOWN; pause; reconcile by clientOrderId before retry]
    Y -. Journal intent cannot be persisted .-> AE[Remove pending; pause; do not call broker]
```

### Why preflight happens before cancellation

The engine runs this work inside its serialized market-price transition. It first confirms that an acknowledged BUY is eligible for repricing and that no active strategy position blocks the operation. It then fetches fresh Binance filters, validates the refreshed market metadata, evaluates the Conservative policy using the current market price as the replacement reference, and allocates commitments while excluding only the BUY that would be canceled. That exclusion models the quote commitment that cancellation will release; it does **not** cancel the order or remove it from the live registry.

The resulting executable action is converted into a canonical preflight order and checked against the refreshed exchange rules (including quantity/price increments and minimum notional) and the submission-readiness gate. For `LIMIT_MAKER`, readiness also requires a fresh same-symbol book and a price that does not cross the opposite best quote. If filters are missing, incomplete, mismatched, or the candidate fails exchange validation, the pair is paused and the existing BUY remains untouched. If market/book readiness is temporarily unavailable or no executable replacement BUY exists, replacement is deferred and the old BUY is retained. This ordering prevents a failed candidate from removing the only standing BUY and leaving the pair without its intended order.

### Cancellation and post-cancellation failure handling

Only an admissible preflight proceeds to cancellation. The engine verifies cancellation eligibility and durably records the cancellation intent before calling the broker. An unconfirmed cancellation is represented as UNKNOWN and pauses the pair. After a canonical cancellation result, the engine updates the order registry, retrieves canonical fills, validates fill/order identity, applies actual fills, and checks that reconciled fill quantity matches the broker's cumulative executed quantity. A fill racing with cancellation, a non-CANCELED terminal result, incomplete history, or any mismatch pauses the pair; no replacement is submitted.

After a confirmed CANCELED order with zero reconciled fills, the engine stores the current market price as the new reference and re-evaluates using the refreshed filters. It validates the actual order again, registers it as PENDING, and durably records the submission intent before broker I/O. If that intent cannot be persisted, the pending record is removed, the pair is paused, and the broker is not called. A generic rejection, transport error, or uncertain acknowledgement leaves the replacement explicitly UNKNOWN and pauses the pair; reconcile it by canonical `clientOrderId` before any retry. Binance's definite `POST_ONLY_WOULD_TAKE` rejection is handled separately: the pending record is removed, the cached book is discarded, and evaluation is deferred until fresh book data arrives.

## Startup paths and important distinctions

- **Market filters:** bootstrap loads `getSymbolFilters({ symbol })` for every enabled symbol before it starts market subscriptions. The adapter fetches current exchange metadata on every request; it does not retain a process-lifetime filter cache.
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
