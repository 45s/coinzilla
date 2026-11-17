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

## Multi-provider target architecture — issue #1339

The runtime now constructs named provider instances through a Harvester-owned bootstrap registry. Each instance has a stable non-secret ID, provider type, account ID, and provider-specific credential environment-variable references. The initial deployment preserves the existing Binance credential names and uses one process-wide TRADING_MODE; per-instance environment selection and independent routing remain deferred. The current runtime selects one Binance instance for execution, account state, and market data; it does not yet enable multi-provider execution. The accepted target permits multiple named provider instances in one Harvester process. Harvester bootstrap constructs each configured instance and assembles an application-owned registry/router; the Brokers package supplies exchange clients and verified capabilities but does not own strategy/market routing. The source-verified current-state assessment, provenance gaps and ordered implementation prerequisites are maintained in the [multi-provider migration audit and implementation plan](../../../../docs/architecture/multi-provider-migration-plan.md).

Execution and market-data resolution are separate:

```text
Strategy policy (strategyId + symbol; no provider knowledge)
        |
        v
Trading Engine / application workflow
        |
        +---- execution route: (strategyId, symbol) -> providerInstanceId
        |                          |
        |                          v
        |                  provider registry
        |                          |
        |                          v
        |                 Harvester BrokerPort
        |
        +---- market-data route: symbol -> providerInstanceId
                                   |
                                   v
                           provider registry
                                   |
                                   v
                          Harvester BrokerPort
```

Example target configuration (illustrative; not accepted by today's validator):

```js
const executionRoutes = [
  { strategyId: "RS_recoverySeller", symbol: "STRKUSDT", providerInstanceId: "bitunixSpotPrimary" },
  { strategyId: "CG_coinGrabber", symbol: "LINKUSDT", providerInstanceId: "binanceTestnet" },
]

const marketDataRoutes = [
  { symbol: "STRKUSDT", providerInstanceId: "binanceTestnet" },
  { symbol: "LINKUSDT", providerInstanceId: "binanceTestnet" },
]
```

The route table is exact: no implicit default, wildcard, priority list, or failover. Every enabled executable strategy/market pair resolves to exactly one provider. The market-data source is configured independently and is never inferred from the execution route. Duplicate or missing routes and unsupported provider capabilities fail closed.

Provider construction and lifecycle are owned by the bootstrap registry. The registry exposes lookup by stable instance ID and a BrokerPort facade; the current runtime explicitly selects the same instance for execution, account state, and market data. Independent route resolution remains deferred until provider/account isolation and durable order provenance are implemented. Strategy/domain policies never receive provider IDs or concrete broker clients.

### Immutable order provenance

Before a state-changing order request, retain the selected `providerInstanceId`, provider type, stable non-secret account identity, strategy ID, and symbol with the order's client identity. Once submitted, the order remains pinned to that provider/account for acknowledgement, cancellation, lookup, fills, user-data events, reconciliation and recovery. A later route-table change affects new intents only.

A provider/account identity must not be inferred from the current route when processing an existing order. Equal exchange-native IDs from different providers are distinct and must be namespaced. Do not persist or log credentials.

### Account and lifecycle isolation

Account snapshots, balances, open orders, reservations, readiness, user-data recovery and process locks must be scoped by provider instance/account/environment. Different exchange accounts are not one spendable wallet. A disconnect or failed recovery for one provider must not silently transfer orders to another provider or mark unrelated providers unavailable.

A state-changing timeout remains an unknown outcome. Never retry it on another provider. Cross-provider fallback could duplicate an order.

### Current capability boundary

Bitunix Spot remains read-only and is not a valid Harvester execution provider today. Its existing metadata helper is not a full broker adapter. Do not enable Bitunix order placement, cancellation or runtime integration until [issue #1185](https://github.com/45s/coinzilla/issues/1185) and the capability gates in [issue #1339](https://github.com/45s/coinzilla/issues/1339) are resolved. RS is also not executable merely because a future route can name its strategy ID.

The durable target contract is [ADR-0003](../../../../docs/architecture/decisions/ADR-0003-multi-provider-routing.md); this file remains the Harvester-specific port/adapter guide.

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
| Read open orders | `getOpenOrders({ symbol? } = {})`; omit `symbol` for an account-wide snapshot |
| Read fills | `getFills(input)` |
| Read canonical order history | `getCanonicalOrderHistory({ symbol, orderId })` |
| Account snapshot | `getAccountSnapshot()` |
| Symbol filters | `getSymbolFilters({ symbol })` |
| Price subscription | `subscribeForPrices({ symbol, onPrice })` |
| Historical candles | `getCandles({ symbol, interval, limit, startTime?, endTime? })` |
| Live candle subscription | `subscribeForCandles({ symbol, interval, onCandle })` |
| User-data subscription | `subscribeForUserData({ onEvent, onStatus })` |

Query/order methods generally return `{ ok, data }` or `{ ok: false, errors }` using the shared result convention. Connection lifecycle methods throw on failure. Consult the package source/tests for exact input/output contracts.

`getOpenOrders({ symbol? } = {})` returns the shared legacy `Order[]` shape, not `CanonicalOrder[]`. An omitted options object and an explicit empty object both mean account-wide; a supplied `symbol` scopes the query to that market. The Harvester adapter must default its optional options argument to `{}` because bootstrap and read-only operator queries intentionally call `getOpenOrders()` for account-wide visibility. Its numeric `quantity` and `price` fields are not suitable for exact financial comparisons. Reconciliation uses only its string broker `id`, symbol/side/type, and the exact string `originalQuantity` / `executedQuantity` metadata preserved by the broker adapter; canonical status and financial execution facts come from `getCanonicalOrderHistory()` and `getFills()`.

## Candle market-data capability — issue #1016

Harvester's application-owned broker port now requires both candle capabilities, and the Binance infrastructure adapter validates and forwards them to the concrete @coinzilla/brokers client. This integration is delivered in [PR #1019](https://github.com/45s/coinzilla/pull/1019), following the shared broker implementation in [PR #1017](https://github.com/45s/coinzilla/pull/1017).

- **getCandles({ symbol, interval, limit, startTime?, endTime? })** returns the broker package's normalized historical candle result unchanged.
- **subscribeForCandles({ symbol, interval, onCandle })** forwards normalized live candle callbacks and preserves the broker subscription result and unsubscribe handle.

The normalized candle contains symbol, interval, millisecond open/close timestamps, exact decimal-string OHLCV values and an `isClosed` flag. Domain policies and use cases consume only this Harvester-owned contract; they must not import Binance DTOs or use the concrete broker directly.

Bootstrap now composes `createCandleHistoryService` after the existing price intake. For each enabled market it establishes the live Kline subscription first, requests 101 one-minute candles, filters the still-forming final bar, and retains up to 100 completed candles. Live updates are buffered during warm-up. A valid current Kline event refreshes freshness; delayed events older than the retained history do not. A forming candle can reveal a gap: the service immediately marks the market unavailable and backfills the exact missing completed range, restoring readiness only after continuity is complete. The forming candle is never added to indicator history. The service calculates ATR(14), NATR and the ratio against the previous 60 NATR observations, then exposes a per-market snapshot through runtime `getVolatilityData({ symbol })`. Its unsubscribe handle drains accepted backfill work even when the broker unsubscribe reports an error.

The candle-history service itself collects market data and exposes readiness/metric snapshots; it does not make trading decisions. Bootstrap forwards each snapshot to `tradingEngine.processVolatilitySnapshot()`. The engine owns the per-market protection state machine, cancels only acknowledged Harvester-owned active BUYs when required, and enforces the central submission gate: while candle data is not ready, protection is not `NORMAL`, or the latest ratio is at or above the protection threshold, ordinary strategy orders are blocked and only explicitly identified recovery SELLs may pass the volatility-specific gate. Existing recovery SELLs are not canceled or repriced by volatility protection. This policy/gate integration was delivered in [PR #1041](https://github.com/45s/coinzilla/pull/1041); the candle-stream freshness correction was delivered in [PR #1049](https://github.com/45s/coinzilla/pull/1049). See the canonical [Volatility Protection](../volatility-protection.md) contract and [issue #1016](https://github.com/45s/coinzilla/issues/1016).

## Implemented infrastructure adapter

The implementation lives in `src/infrastructure/brokers/binance-broker-adapter.js`. It constructs `BinanceWebSocketBroker`, validates the concrete broker methods, and returns the application-owned port. Its `placeOrder({ order })` method maps to the package's `createOrder(order)` method. The adapter preserves the broker's result objects and error behavior.

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
    getOpenOrders: (options = {}) => client.getOpenOrders(options),
    getFills: ({ symbol, ...query }) => client.getFills({ symbol, ...query }),
    getCanonicalOrderHistory: ({ symbol, orderId }) => client.getCanonicalOrderHistory({ symbol, orderId }),
    getAccountSnapshot: () => client.getAccountSnapshot(),
    getSymbolFilters: ({ symbol }) => client.getSymbolFilters({ symbol }),
    getExchangeMarkets: () => client.getExchangeMarkets(),
    getCandles: (input) => client.getCandles(input),
    subscribeForPrices: ({ symbol, onPrice }) => client.subscribeForPrices({ symbol, onPrice }),
    subscribeForCandles: (input) => client.subscribeForCandles(input),
    subscribeForUserData: ({ onEvent, onStatus }) => client.subscribeForUserData({ onEvent, onStatus }),
  })
}
```

The package-specific `createOrder` name stays inside the adapter. A simulator or another exchange adapter can implement the same Harvester-facing port without changing use cases. Do not invent request-field transformations; use the canonical shared contracts.

**Trading-rule freshness and completeness:** each Harvester `getSymbolFilters({ symbol })` call fetches public Binance `exchangeInfo` and authenticated, symbol-scoped `myFilters`; the adapter does not retain a process-lifetime filter cache. It returns supported static canonical rules plus an explicit `unvalidatedConstraints` inventory. Harvester locally validates the required price/quantity/notional rules, the configured order type, market identity, and pair sizing inputs. Additional dynamic, account-level, exchange-wide, and unknown constraints remain immutable diagnostics; their presence alone does not block an enabled market. Binance remains authoritative for those constraints and may definitively reject a submitted order. Such a definite filter rejection is classified as `DEFINITE_EXCHANGE_FILTER_REJECTED`, not an ambiguous/UNKNOWN outcome, and must not create a phantom reservation. Missing or malformed private filter data is still a metadata failure, not an empty constraint set. Before replacing a standing Conservative trailing BUY, the engine fetches fresh rules again, checks that they still identify the active market, and uses the refreshed metadata for both preflight validation and replacement submission. A failed/incomplete/mismatched refresh or a failure of the required supported-rule checks pauses the pair before cancellation, leaving the standing BUY untouched. See [Exchange trading constraints](../exchange-trading-constraints.md) for the full contract and current Binance mapping.

## Implemented application use case

The application workflow is implemented in `src/use-cases/place-order.js`. It receives an order request and calls only the Harvester broker port. It does not construct a broker, apply strategy policy, or convert a thrown state-changing transport error into a definite failure result.

```js
import { toResult } from "@coinzilla/utils"

export function makePlaceOrder({ broker } = {}) {
  if (broker === null || typeof broker?.placeOrder !== "function") {
    throw new TypeError("makePlaceOrder requires a broker port with placeOrder()")
  }

  return async function placeOrder({ order } = {}) {
    if (order === null || typeof order !== "object" || Array.isArray(order)) {
      return toResult({
        error: new TypeError("placeOrder requires an order object"),
      })
    }

    return broker.placeOrder({ order })
  }
}
```

The use case is composed by bootstrap and returned as `runtime.placeOrder` when the Binance broker is explicitly enabled. The broker result is preserved. A thrown timeout/disconnect error propagates because a state-changing request may have an unknown exchange outcome; callers must reconcile before retrying.

This is the execution boundary only. The strategy/engine must still construct and approve a valid order request after applying domain rules and safety checks. The CLI does not automatically submit orders.

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

Bootstrap always selects Binance, requires `TRADING_MODE` to be exactly `testnet` or `live`, and requires `BINANCE_API_KEY` and `BINANCE_API_SECRET_KEY`. `testnet` selects Binance Spot TESTNET; `live` selects Binance Spot LIVE and permits real order execution. Trading is enabled in either mode; missing or invalid mode fails startup. `.env.development` supplies `TRADING_MODE=testnet`, while production `.env` supplies `TRADING_MODE=live`. `NODE_ENV` does not select the exchange. Host-shared process locks are scoped by provider and trading mode, allowing Testnet and LIVE to coexist while preserving one writer per environment. Bootstrap connects once and exposes an idempotent `stop()` used by the CLI SIGINT/SIGTERM handlers. The `@coinzilla/brokers` workspace dependency is declared in Harvester and the lockfile.

## Reliability rules

Preserve the behavior documented in `packages/brokers/README.md`:

1. A `recovered` status means the remote user-data subscription is restored; it is not application readiness. While `recoveryRequired: true`, Harvester keeps trading blocked while it reconciles the in-memory owned-order registry against canonical `getOpenOrders()`, `getCanonicalOrderHistory()`, and `getFills()`, drains queued events in recovery mode, captures fresh account balances and account-wide open orders, and durably flushes both RECOVERY audit records. It acknowledges the exact broker generation only after those checks succeed, then waits for the matching global `reconciled` status before reopening trading. Incomplete, conflicting, stale-generation, or non-durable state remains blocked. Durable restart state remains outside this same-process workflow.
   - A broker `rpcError` with explicit `recoveryRequired: false` and no contradictory reconciliation flag is diagnostic-only: it preserves the current application readiness and generation state. Missing or malformed recovery metadata remains fail-closed. An actual `connectionClosed` status (including close code `1006`) invalidates the generation and starts the full recovery gate; the close code itself is not a diagnosis of the underlying transport cause.
2. A timeout or disconnect during place/cancel can mean the exchange accepted the operation but its response was lost. Treat the outcome as unknown; reconcile by client order ID, order status, open orders, and available history before retrying. Never blindly resubmit.
3. Public market-stream reconnect is not user-data event replay.
4. Only actual fills (including partial fills and actual commission assets) change Portfolio holdings. Acknowledgements, cancellations, rejections, expirations, and prices do not.
5. Do not claim exactly-once processing or restart recovery until durable deduplication, reconciliation, and tests exist.

A user-data subscription exposes recovery acknowledgement through its returned subscription data. Acknowledge only after reconciliation succeeds.

Engine failures are classified as `OWNERSHIP_INTEGRITY`, `ACCOUNTING_INTEGRITY`,
`ORDER_TRANSITION`, `REST_RECONCILIATION`, or `DURABILITY`. Only the first two
are terminal process-lifetime accounting failures. Retryable categories keep
readiness closed and may retry only through a new full authoritative
reconciliation; they never bypass the broker-generation acknowledgement or
durable RECOVERY audit barriers.

The `REST_RECONCILIATION` identifier is retained for compatibility; current
canonical order/fill reads use Binance WebSocket API request/response RPC, not
HTTP REST.

## Testing

- Test domain decisions without broker mocks.
- Test use cases with a fake implementation of the Harvester broker port.
- Test adapter mapping and error/result behavior without network access.
- Keep live Binance tests opt-in and TESTNET-only.
- Test unknown outcomes, partial fills, recovery-required status, and cancellation races at the boundary where implemented.

## Implementation status

Implemented: application broker port and Binance adapter, Conservative Trading Engine, in-memory owned-order registry, canonical fill accounting, serialized user-data processing, and reconnect-time WebSocket API request/response reconciliation for tracked orders/fills. The reconciliation is process-local and fail-closed; it does not restore state after restart, reconcile account balances, or adopt external orders. Do not treat a connected broker or stream-level recovery acknowledgement alone as application trading readiness.

### Book ticker broker-port contract

The Harvester broker port exposes `subscribeForBookTicker({ symbol, onBookTicker })` alongside aggregate-trade price subscriptions. The callback receives normalized decimal strings for best bid/ask prices and quantities plus a local receipt timestamp in milliseconds. Bootstrap subscribes to this stream only when TESTNET trading is enabled, requires a successful unsubscribe handle, and removes the subscription during startup rollback and shutdown.

For Conservative, order-type selection, POST-ONLY crossing constraints, and fail-closed behavior are defined exclusively in [CONSERVATIVE_DOMAIN_SPECIFICATION.md](../domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). The engine requires fresh same-symbol book data before a LIMIT_MAKER submission; this document records the adapter boundary and implementation only. The Binance adapter only classifies the exact Spot `-2010` POST-ONLY matching-engine response as definite when the response is not marked `outcomeUnknown`; all uncertain outcomes retain the existing fail-closed pause behavior.

## Bitunix Spot metadata boundary

The current application broker port and runtime composition remain Binance-only. The Bitunix Spot market-metadata helper (`src/infrastructure/brokers/bitunix-market-metadata.js`) is a pure read-side transformation; it is not a broker adapter, does not satisfy the full Harvester broker port, and is not wired into bootstrap. It maps only `minVolume` and `minPrice` into canonical minimum constraints; precision increments remain UNKNOWN. Do not use it to enable Bitunix trading while issue #1185 remains open.
