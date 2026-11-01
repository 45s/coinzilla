# Harvester Broker Port and Adapter

## Decision

Harvester owns the application-facing broker port. The concrete `@coinzilla/brokers` package is used only by an infrastructure adapter.

```text
Strategy (domain policy)
        |
        v
Trading Engine / use case (application)
        |
        v
Harvester broker port (application-owned contract)
        ^
        |
Binance broker adapter (Harvester infrastructure)
        |
        v
@coinzilla/brokers / BinanceWebSocketBroker
        |
        v
Binance WebSocket API and Streams
```

The port belongs to Harvester because it describes the capabilities this application needs. The adapter belongs to infrastructure because it knows how to satisfy those needs with a concrete broker. Domain policies, Portfolio, and use cases must not import `@coinzilla/brokers`, `CoreBroker`, Binance classes, exchange SDK types, or raw exchange payloads.

## Why not depend on CoreBroker directly?

`CoreBroker` is currently a base class whose methods throw when not implemented; it is not a formal, capability-checked application port. Depending on it couples Harvester to the broker package's class hierarchy instead of the small set of operations its use cases require.

There is also a current naming mismatch: `CoreBroker` declares `getPrice()`, while `BinanceWebSocketBroker` implements `getPrices({ symbol })`. Keep such package-specific differences inside the adapter and resolve the shared contract mismatch when formalizing the cross-broker contract.

Owning the port does not mean copying shared entities. Reuse canonical Order, Fill, Market, Quantity, Balance, BrokerResult, and utility contracts from `@coinzilla/entities` / `@coinzilla/utils` wherever they fit.

## Responsibilities

| Layer | Responsibility |
| --- | --- |
| Domain | Trading rules, Portfolio invariants, strategy decisions; no broker dependency |
| Application port | Minimum broker operations and normalized data required by Harvester workflows |
| Application use case | Coordinates domain behavior and calls the injected port |
| Infrastructure adapter | Constructs the concrete broker and maps port operations to package methods |
| Bootstrap | Loads config, creates adapters, injects dependencies, owns connection/shutdown lifecycle |
| `@coinzilla/brokers` | Exchange transport, protocol handling, broker-level normalization and recovery behavior |

Do not mirror every `CoreBroker` method automatically. Add a capability only when a Harvester use case needs it.

## Current `@coinzilla/brokers` methods

| Operation | Current method |
| --- | --- |
| Connect / disconnect | `connect()` / `disconnect()` |
| Place order | `createOrder(orderInput)` |
| Cancel order | `cancelOrder({ symbol, orderId })` |
| Read open orders | `getOpenOrders({ symbol })` |
| Read fills | `getFills(input)` |
| Account snapshot | `getAccountSnapshot()` |
| Symbol filters | `getSymbolFilters({ symbol })` |
| Price subscription | `subscribeForPrices({ symbol, onPrice })` |
| User-data subscription | `subscribeForUserData({ onEvent, onStatus })` |

Query/order methods generally return `{ ok, data }` or `{ ok: false, errors }` using the shared result convention. Connection lifecycle methods throw on failure. Consult the package source/tests for exact input/output contracts.

## Example: infrastructure adapter

Illustrative mapping only; this is not an implemented Harvester port. Final signatures must be agreed with the consuming use cases and canonical entity contracts.

```js
import { BinanceWebSocketBroker } from "@coinzilla/brokers"

export const createBinanceBrokerAdapter = ({ config, logger }) => {
  const client = new BinanceWebSocketBroker({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    logger,
  })

  return Object.freeze({
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    placeOrder: ({ order }) => client.createOrder(order),
    cancelOrder: ({ symbol, orderId }) => client.cancelOrder({ symbol, orderId }),
    getOpenOrders: ({ symbol }) => client.getOpenOrders({ symbol }),
    getFills: ({ symbol, ...query }) => client.getFills({ symbol, ...query }),
    getAccountSnapshot: () => client.getAccountSnapshot(),
    getSymbolFilters: ({ symbol }) => client.getSymbolFilters({ symbol }),
    subscribeForPrices: ({ symbol, onPrice }) => client.subscribeForPrices({ symbol, onPrice }),
    subscribeForUserData: ({ onEvent, onStatus }) => client.subscribeForUserData({ onEvent, onStatus }),
  })
}
```

The package-specific `createOrder` name stays inside the adapter. A simulator or another exchange adapter can implement the same Harvester-facing port without changing use cases. Do not invent request-field transformations; use the canonical shared contracts.

## Example: application use case

```js
import { toResult } from "@coinzilla/utils"

export const makePlaceOrder = ({ broker }) => {
  return async function placeOrder({ order }) {
    const result = await broker.placeOrder({ order })
    if (!result.ok) return result
    return toResult({ data: result.data })
  }
}
```

This illustrates dependency direction, not a completed use case. Add domain validation and shared safety checks only through agreed canonical contracts. The strategy returns a decision; the Trading Engine/application invokes the use case; the use case executes through the port. The strategy never submits orders directly.

## Example: bootstrap composition

```js
import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"
import { makePlaceOrder } from "../use-cases/place-order.js"

export const createHarvesterServices = ({ config, logger }) => {
  const broker = createBinanceBrokerAdapter({ config, logger })
  const placeOrder = makePlaceOrder({ broker })
  return { broker, placeOrder }
}
```

The process lifecycle connects once during startup and disconnects during graceful shutdown. Keep live order placement disabled until readiness, reconciliation, and safety workflows are implemented. Add `@coinzilla/brokers: workspace:*` to Harvester's package dependencies when the adapter is actually implemented; this documentation-only change does not add a runtime dependency.

## Reliability rules

Preserve the behavior documented in `packages/brokers/README.md`:

1. A `terminated` or `connectionClosed` user-data status means events may have been missed. On `recovered` with `reconciliationRequired: true`, reconcile durable Harvester state against account snapshot, open orders, and available trade/order history before acknowledging recovery.
2. A timeout or disconnect during place/cancel can mean the exchange accepted the operation but its response was lost. Treat the outcome as unknown; reconcile by client order ID, order status, open orders, and available history before retrying. Never blindly resubmit.
3. Public market-stream reconnect is not user-data event replay.
4. Only actual fills (including partial fills and actual commission assets) change Portfolio holdings. Acknowledgements, cancellations, rejections, expirations, and prices do not.
5. Do not claim exactly-once processing or restart recovery until durable deduplication, reconciliation, and tests exist.

A user-data subscription exposes recovery acknowledgement through its returned subscription data. Acknowledge only after reconciliation succeeds.

## Testing

- Test domain decisions without broker mocks.
- Test use cases with a fake implementation of the Harvester broker port.
- Test adapter mapping and error/result behavior without network access.
- Keep live Binance tests opt-in and TESTNET-only.
- Test unknown outcomes, partial fills, recovery-required status, and cancellation races at the boundary where implemented.

## Implementation status

This document records the selected architecture and examples only. The executable broker port, adapter, Trading Engine, Portfolio workflows, and strategy implementations remain roadmap work. Do not infer that they are implemented from these examples.
