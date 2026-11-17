/**
 * @typedef {"supported" | "unsupported" | "unknown" | "environment-dependent"} BrokerCapabilityStatus
 */

/**
 * @typedef {Readonly<{
 *   status: BrokerCapabilityStatus,
 *   method?: string,
 *   guarantee?: string,
 *   limitation?: string,
 *   reason?: string,
 *   conditions?: readonly string[],
 * }>} BrokerCapabilityDeclaration
 */

const BINANCE_CAPABILITY_TEMPLATE = {
  contractVersion: 1,
  provider: "binance",
  product: "spot",
  environment: {
    status: "environment-dependent",
    selector: "tradingMode",
    supportedModes: ["testnet", "live"],
    endpointSelection: "The validated tradingMode selects the matching Binance Spot WebSocket API and Streams endpoint pair.",
    nodeEnvSelectsEndpoint: false,
    verification: "Offline configuration and fake-client tests do not prove TESTNET or LIVE endpoint connectivity, market availability, or account permissions.",
  },
  marketData: {
    oneShotPrice: {
      status: "supported",
      method: "getPrices",
      source: "ticker.price",
      guarantee: "Returns a one-shot price response for the requested symbol; this operation is not a subscription.",
    },
    priceStream: {
      status: "supported",
      method: "subscribeForPrices",
      source: "aggTrade",
      guarantee: "Streams aggregate trades and monitors logical delivery against the independent rolling-window ticker; the Streams client reconnects and resubscribes desired streams.",
      limitation: "Missed events are not replayed. The consumer remains responsible for freshness and reconciliation; the liveness detector cannot infer a data-plane outage when both market streams stop advancing.",
    },
    legacyPriceLookup: {
      status: "unsupported",
      method: "getPrice",
      reason: "Binance inherits CoreBroker.getPrice(), whose implementation throws. Use getPrices() for a one-shot price read.",
    },
    bookTickerStream: {
      status: "supported",
      method: "subscribeForBookTicker",
      source: "bookTicker",
      guarantee: "Subscribes to the public best-bid/best-ask update stream and returns an unsubscribe handle.",
    },
    candleHistory: {
      status: "supported",
      method: "getCandles",
      source: "klines",
      guarantee: "Returns one validated, ascending Binance kline response with exact OHLCV strings and server-time-based candle completion.",
      limitation: "The broker does not paginate automatically, fill gaps, or backfill missing candles.",
    },
    candleStream: {
      status: "supported",
      method: "subscribeForCandles",
      source: "kline",
      guarantee: "Streams validated Kline updates and preserves Binance's isClosed flag; returns an unsubscribe handle.",
    },
  },
  account: {
    balances: {
      status: "supported",
      method: "getBalances",
      guarantee: "Returns canonical balances, including zero balances, with exact decimal values.",
      limitation: "This balance read does not itself include a validated source timestamp.",
    },
    snapshot: {
      status: "supported",
      method: "getAccountSnapshot",
      guarantee: "Returns canonical balances with Binance account.status updateTime as sourceTime and fails closed when that timestamp is missing or invalid.",
      limitation: "The source timestamp is not a global user-data event cursor or a replay position.",
    },
  },
  orders: {
    openOrders: {
      status: "supported",
      method: "getOpenOrders",
      guarantee: "Returns normalized current open orders account-wide or for a requested symbol.",
    },
    statusLookup: {
      status: "supported",
      method: "getOrder",
      guarantee: "Performs a signed order.status lookup and returns the compatibility Order projection; this is a status observation, not canonical reconciliation.",
    },
    canonicalLookup: {
      status: "supported",
      method: "getCanonicalOrder",
      guarantee: "Looks up one order by broker order ID or client order ID and validates its identity and market metadata before returning a CanonicalOrder.",
      limitation: "A successful lookup is evidence for one order only and does not reconcile fills or account state.",
    },
    canonicalHistory: {
      status: "supported",
      method: "getCanonicalOrderHistory",
      guarantee: "Returns canonical orders from one bounded, symbol-scoped Binance allOrders query.",
      limitation: "The result is one caller-sized page; the broker does not automatically paginate or claim complete account-wide history.",
    },
    reconciliation: {
      status: "unsupported",
      reason: "The broker does not own an end-to-end canonical order reconciliation workflow. Lookups and history pages are evidence for a consumer-owned reconciliation process.",
    },
    placement: {
      status: "environment-dependent",
      method: "createCanonicalOrder / createOrder",
      conditions: [
        "The instance must use an explicitly validated tradingMode of testnet or live.",
        "The selected Binance account and API key must have Spot trading permission.",
        "The WebSocket API must be connected and user-data recovery must be acknowledged before state-changing calls.",
      ],
      limitation: "Offline tests verify request construction and safety gates, not exchange acceptance in TESTNET or LIVE. An uncertain mutation outcome is never blindly retried.",
    },
    cancellation: {
      status: "environment-dependent",
      method: "cancelOrder / cancelAllOpenOrders",
      conditions: [
        "The instance must use an explicitly validated tradingMode of testnet or live.",
        "The selected Binance account and API key must have Spot trading permission.",
        "The WebSocket API must be connected and user-data recovery must be acknowledged before state-changing calls.",
      ],
      limitation: "Cancellation outcomes remain conservative when the RPC result is uncertain; canonical status and fills still require consumer reconciliation.",
    },
  },
  fills: {
    canonicalHistory: {
      status: "supported",
      method: "getFills",
      source: "myTrades",
      guarantee: "Returns canonical Fill values for a requested symbol using Binance trade IDs, exact decimal strings, and validated trade metadata.",
      limitation: "Each call returns one bounded response of at most 1,000 trades. Cursor/time pagination is caller-managed; this is not a complete account-wide fill-history operation.",
    },
    completeHistory: {
      status: "unknown",
      reason: "The implementation does not automatically paginate every symbol or establish exhaustive coverage across Binance history-retention windows. Complete account-wide fill history is therefore unverified.",
    },
    executionUpdates: {
      status: "supported",
      method: "subscribeForUserData",
      source: "executionReport TRADE",
      guarantee: "TRADE execution reports are normalized into canonical order updates and canonical Fill values while the private user-data stream is active.",
      limitation: "A stream interruption can leave an event gap; reconnect does not replay missed execution reports.",
    },
  },
  userData: {
    stream: {
      status: "supported",
      method: "subscribeForUserData",
      protocol: "userDataStream.subscribe.signature",
      guarantee: "Creates the signed private Spot user-data subscription and forwards normalized balance and execution events. Same-process reconnect resubscribes and reports recovery generations.",
      conditions: [
        "The WebSocket API connection must be open.",
        "The API key must have the account-read permission required by the signed user-data subscription.",
        "Consumers must reconcile authoritative account, order, and fill state before acknowledging recovery.",
      ],
    },
    eventReplay: {
      status: "unsupported",
      reason: "The broker resubscribes after interruption but does not replay missed events or expose a global exchange event cursor.",
    },
  },
  recovery: {
    sameProcess: {
      status: "supported",
      method: "UserDataSession",
      guarantee: "In-memory reconnect/resubscribe uses a monotonic recovery generation; all active subscribers must acknowledge after reconciliation before state-changing RPCs are unblocked.",
    },
    processRestart: {
      status: "unsupported",
      reason: "The broker has no durable user-data session or recovery state and does not restore subscriptions or reconcile prior process state after a process restart.",
    },
  },
}

/**
 * Recursively freeze a capability declaration, including nested arrays and objects.
 *
 * @param {{value: object}} input
 * @returns {Readonly<object>}
 */
function deepFreeze({ value }) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze({ value: nestedValue })
  }

  return Object.freeze(value)
}

/**
 * Create the immutable capability declaration for one validated Binance Spot instance.
 *
 * @param {{tradingMode: "testnet" | "live"}} input
 * @returns {Readonly<object>}
 */
export function createBinanceBrokerCapabilities({ tradingMode }) {
  return deepFreeze({
    value: {
      ...BINANCE_CAPABILITY_TEMPLATE,
      environment: {
        ...BINANCE_CAPABILITY_TEMPLATE.environment,
        selectedMode: tradingMode,
      },
    },
  })
}
