import { BrokerCapabilities } from "../../../broker/broker-capabilities.js"

const USER_DATA_READY_CONDITIONS = [
  "The WebSocket API connection must be open.",
  "The API key must have the account-read permission required by the signed user-data subscription.",
  "Consumers must reconcile authoritative account, order, and fill state before acknowledging recovery.",
]

const ORDER_MUTATION_CONDITIONS = [
  "The instance must use an explicitly validated tradingMode of testnet or live.",
  "The selected Binance account and API key must have Spot trading permission.",
  "The WebSocket API must be connected and user-data recovery must be acknowledged before state-changing calls.",
]

const BINANCE_SPOT_CAPABILITIES = [
  {
    type: "READ_ASSETS",
    status: "SUPPORTED",
    method: "getAssets",
    guarantee: "Returns non-zero legacy Coin projections from the Spot account.",
    limitation: "Coin quantities use JavaScript Number for compatibility; use getBalances for exact decimal values.",
  },
  {
    type: "READ_BALANCES",
    status: "SUPPORTED",
    method: "getBalances",
    guarantee: "Returns canonical balances, including zero balances, with exact decimal values.",
  },
  {
    type: "READ_ACCOUNT_SNAPSHOT",
    status: "SUPPORTED",
    method: "getAccountSnapshot",
    guarantee: "Returns canonical balances with account.status updateTime as sourceTime and rejects a missing or invalid timestamp.",
    limitation: "sourceTime is not a global user-data event cursor or replay position.",
  },
  {
    type: "READ_SERVER_TIME",
    status: "SUPPORTED",
    method: "getServerTime",
    guarantee: "Returns validated Binance server time in Unix epoch milliseconds.",
  },
  {
    type: "READ_EXCHANGE_MARKETS",
    status: "SUPPORTED",
    method: "getExchangeMarkets",
    guarantee: "Returns a validated canonical Spot market catalog and rejects duplicate market identities.",
  },
  {
    type: "READ_SYMBOL_FILTERS",
    status: "SUPPORTED",
    method: "getSymbolFilters",
    guarantee: "Returns validated symbol and account filter metadata for the requested market.",
  },
  {
    type: "READ_TRADING_RULES",
    status: "SUPPORTED",
    method: "getSymbolFilters",
    guarantee: "Returns exchange and account trading filters used to validate Spot order constraints.",
  },
  {
    type: "READ_OPEN_ORDERS",
    status: "SUPPORTED",
    method: "getOpenOrders",
    guarantee: "Returns normalized current open orders account-wide or for one requested symbol.",
  },
  {
    type: "READ_ORDER",
    status: "SUPPORTED",
    method: "getOrder",
    guarantee: "Performs a signed order.status lookup by broker order ID or client order ID.",
    limitation: "A status observation is not canonical reconciliation.",
  },
  {
    type: "READ_ORDER_HISTORY",
    status: "SUPPORTED",
    method: "getOrderHistory",
    guarantee: "Returns one validated, bounded, symbol-scoped allOrders response.",
    limitation: "The caller owns pagination; the broker does not claim complete account-wide history.",
  },
  {
    type: "READ_CANONICAL_ORDER",
    status: "SUPPORTED",
    method: "getCanonicalOrder",
    guarantee: "Validates order identity and market metadata before returning a canonical order.",
    limitation: "A successful lookup is evidence for one order only and does not reconcile fills or account state.",
  },
  {
    type: "READ_CANONICAL_ORDER_HISTORY",
    status: "SUPPORTED",
    method: "getCanonicalOrderHistory",
    guarantee: "Returns canonical orders from one bounded, symbol-scoped allOrders query.",
    limitation: "The caller owns pagination; this is not complete account-wide history.",
  },
  {
    type: "READ_TRADE_HISTORY",
    status: "SUPPORTED",
    method: "getMyTrades",
    guarantee: "Returns one validated, bounded symbol-scoped myTrades response.",
    limitation: "The caller owns cursor/time pagination and symbol coverage.",
  },
  {
    type: "READ_FILLS",
    status: "SUPPORTED",
    method: "getFills",
    guarantee: "Returns canonical Fill values with exact decimal strings and validated trade metadata.",
    limitation: "Each call is one bounded response; cursor/time pagination is caller-managed.",
  },
  {
    type: "READ_COMPLETE_FILL_HISTORY",
    status: "UNKNOWN",
    reason: "The implementation does not automatically paginate every symbol or establish exhaustive coverage across Binance history-retention windows.",
  },
  {
    type: "READ_MARKET_PRICE",
    status: "SUPPORTED",
    method: "getPrices",
    guarantee: "Returns a one-shot ticker price response for the requested symbol; this is not a subscription.",
  },
  {
    type: "READ_CANDLES",
    status: "SUPPORTED",
    method: "getCandles",
    guarantee: "Returns one validated, ascending kline response with exact OHLCV strings and server-time-based candle completion.",
    limitation: "The broker does not paginate automatically, fill gaps, or backfill missing candles.",
  },
  {
    type: "SUBSCRIBE_MARKET_PRICES",
    status: "SUPPORTED",
    method: "subscribeForPrices",
    guarantee: "Streams aggregate trades and monitors logical delivery against the independent rolling-window ticker.",
    limitation: "Missed events are not replayed; consumers remain responsible for freshness and reconciliation.",
  },
  {
    type: "SUBSCRIBE_CANDLES",
    status: "SUPPORTED",
    method: "subscribeForCandles",
    guarantee: "Streams validated Kline updates, preserves Binance isClosed, and returns an unsubscribe handle.",
  },
  {
    type: "SUBSCRIBE_BOOK_TICKER",
    status: "SUPPORTED",
    method: "subscribeForBookTicker",
    guarantee: "Subscribes to the public best-bid/best-ask update stream and returns an unsubscribe handle.",
  },
  {
    type: "OBSERVE_USER_DATA",
    status: "UNSUPPORTED",
    reason: "Binance delivers native authenticated user-data events instead of polling-backed observations.",
  },
  {
    type: "SUBSCRIBE_USER_DATA",
    status: "SUPPORTED",
    method: "subscribeForUserData",
    guarantee: "Creates the signed private Spot user-data subscription and forwards normalized balance and execution events.",
    conditions: USER_DATA_READY_CONDITIONS,
  },
  {
    type: "PLACE_LIMIT_ORDER",
    status: "SUPPORTED",
    method: "createCanonicalOrder",
    guarantee: "Submits a Spot limit order with a client order ID and requires a result response suitable for canonical tracking.",
    conditions: ORDER_MUTATION_CONDITIONS,
    limitation: "Offline tests verify safety gates and request construction, not exchange acceptance in TESTNET or LIVE.",
  },
  {
    type: "PLACE_MARKET_ORDER",
    status: "SUPPORTED",
    method: "createCanonicalOrder",
    guarantee: "Submits a Spot market order with a client order ID and requires a result response suitable for canonical tracking.",
    conditions: ORDER_MUTATION_CONDITIONS,
    limitation: "Offline tests verify safety gates and request construction, not exchange acceptance in TESTNET or LIVE.",
  },
  {
    type: "CANCEL_ORDER",
    status: "SUPPORTED",
    method: "cancelOrder",
    guarantee: "Submits a signed cancellation only after user-data readiness is acknowledged.",
    conditions: ORDER_MUTATION_CONDITIONS,
    limitation: "A dispatched request without an authoritative response has an unknown outcome and is never blindly retried.",
  },
  {
    type: "CANCEL_ALL_ORDERS",
    status: "SUPPORTED",
    method: "cancelAllOpenOrders",
    guarantee: "Submits a signed symbol-scoped cancellation only after user-data readiness is acknowledged.",
    conditions: ORDER_MUTATION_CONDITIONS,
  },
  {
    type: "RECONCILE_ORDERS",
    status: "UNSUPPORTED",
    reason: "The broker does not own an end-to-end canonical order reconciliation workflow.",
  },
  {
    type: "REPLAY_USER_DATA_EVENTS",
    status: "UNSUPPORTED",
    reason: "The broker resubscribes after interruption but does not replay missed events or expose a global exchange event cursor.",
  },
  {
    type: "RECOVER_USER_DATA_SESSION",
    status: "SUPPORTED",
    method: "UserDataSession",
    guarantee: "Same-process reconnect/resubscribe uses a monotonic recovery generation and requires subscriber acknowledgement after reconciliation.",
  },
  {
    type: "RECOVER_PROCESS_RESTART",
    status: "UNSUPPORTED",
    reason: "The broker has no durable user-data session or recovery state for process-restart restoration.",
  },
]

/**
 * Create the immutable, evidence-backed Binance Spot capability declaration.
 *
 * @param {{tradingMode: "testnet" | "live"}} input
 * @returns {BrokerCapabilities}
 */
export function createBinanceBrokerCapabilities({ tradingMode }) {
  return new BrokerCapabilities({
    provider: "binance",
    product: "spot",
    environment: {
      selector: "tradingMode",
      selectedMode: tradingMode,
      supportedModes: ["testnet", "live"],
      notes: "NODE_ENV does not select exchange endpoints.",
    },
    capabilities: BINANCE_SPOT_CAPABILITIES,
  })
}
