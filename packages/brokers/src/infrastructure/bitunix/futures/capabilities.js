import { BrokerCapabilities } from "../../../broker/broker-capabilities.js"

const BITUNIX_FUTURES_CAPABILITIES = [
  { type: "READ_ASSETS", status: "SUPPORTED", method: "getAssets", guarantee: "Reads the requested margin-coin account and preserves exact decimal strings." },
  { type: "READ_BALANCES", status: "SUPPORTED", method: "getBalances", guarantee: "Reads one margin-coin account with available, frozen, margin and PNL amounts." },
  { type: "READ_ACCOUNT_SNAPSHOT", status: "UNSUPPORTED", method: "getAccountSnapshot", reason: "The Futures account response does not include a source timestamp or version for an authoritative snapshot." },
  { type: "READ_SERVER_TIME", status: "UNSUPPORTED", method: "getServerTime", reason: "No documented Bitunix Futures server-time endpoint is available." },
  { type: "READ_EXCHANGE_MARKETS", status: "SUPPORTED", method: "getExchangeMarkets", guarantee: "Returns the official Futures trading-pair catalog, including API availability and symbol status." },
  { type: "READ_SYMBOL_FILTERS", status: "SUPPORTED", method: "getSymbolFilters", guarantee: "Returns exact documented min/max volume, precision, leverage and price-protection metadata." },
  { type: "READ_TRADING_RULES", status: "UNKNOWN", reason: "The official Futures catalog exposes decimal precision but does not document exact price tick and quantity step increments." },
  { type: "READ_OPEN_ORDERS", status: "SUPPORTED", method: "getOpenOrders", guarantee: "Returns one authenticated page of pending Futures orders; symbol filtering is optional." },
  { type: "READ_ORDER", status: "SUPPORTED", method: "getOrder", guarantee: "Reads one order by exchange orderId or caller-supplied clientId." },
  { type: "READ_ORDER_HISTORY", status: "SUPPORTED", method: "getOrderHistory", guarantee: "Returns one authenticated history page with exchange orderId and clientId when supplied." },
  { type: "READ_CANONICAL_ORDER", status: "SUPPORTED", method: "getCanonicalOrder", guarantee: "The Futures API accepts caller-supplied clientId and supports lookup by clientId or orderId." },
  { type: "READ_CANONICAL_ORDER_HISTORY", status: "SUPPORTED", method: "getCanonicalOrderHistory", guarantee: "History records preserve exchange orderId and clientId identity." },
  { type: "READ_TRADE_HISTORY", status: "SUPPORTED", method: "getMyTrades", guarantee: "Returns authenticated trade history with stable tradeId, orderId and clientId fields." },
  { type: "READ_FILLS", status: "SUPPORTED", method: "getFills", guarantee: "Returns exchange trade records with tradeId, orderId, quantity, price, fee and realized PNL." },
  { type: "READ_COMPLETE_FILL_HISTORY", status: "UNKNOWN", reason: "Trade history uses offset skip/limit pagination without a snapshot cursor; completeness under concurrent inserts is not guaranteed." },
  { type: "READ_MARKET_PRICE", status: "SUPPORTED", method: "getPrices", guarantee: "Provides last, mark and index prices plus current funding data." },
  { type: "READ_CANDLES", status: "SUPPORTED", method: "getCandles", guarantee: "Futures Klines provide OHLC and base/quote volume with source timestamps." },
  { type: "READ_ORDER_BOOK", status: "SUPPORTED", method: "getOrderBook", guarantee: "Provides one-shot Futures depth with exact price and quantity strings." },
  { type: "READ_KLINES", status: "SUPPORTED", method: "getKlines", guarantee: "Returns one validated Futures OHLCV Kline page." },
  { type: "READ_KLINE_HISTORY", status: "SUPPORTED", method: "getKlineHistory", guarantee: "Returns one validated Futures OHLCV Kline page with the source timestamp preserved." },
  { type: "READ_EXCHANGE_RATES", status: "UNSUPPORTED", reason: "No Futures exchange-rate catalog endpoint is documented." },
  { type: "READ_DEPOSITS", status: "UNSUPPORTED", reason: "Deposit history is provided by the separate Spot/account API, not the Futures API." },
  { type: "READ_DEPOSIT_ADDRESS", status: "UNSUPPORTED", reason: "Deposit address lookup is provided by the separate Spot/account API, not the Futures API." },
  { type: "READ_WITHDRAWAL_HISTORY", status: "UNSUPPORTED", reason: "Withdrawal history is provided by the separate Spot/account API, not the Futures API." },
  { type: "READ_MATCHING_ORDER_DETAILS", status: "UNSUPPORTED", reason: "Futures exposes order and trade history endpoints instead of the Spot matching-order RPC." },
  { type: "PLACE_LIMIT_ORDER", status: "SUPPORTED", method: "createOrder", guarantee: "Futures order placement supports caller-supplied clientId and exact base-coin quantity; live mutation is separately gated." },
  { type: "PLACE_MARKET_ORDER", status: "SUPPORTED", method: "createOrder", guarantee: "Futures market order placement supports caller-supplied clientId and exact base-coin quantity; live mutation is separately gated." },
  { type: "CANCEL_ORDER", status: "SUPPORTED", method: "cancelOrder", guarantee: "Order cancellation is available and reconciled through authenticated order events; live mutation is separately gated." },
  { type: "CANCEL_ALL_ORDERS", status: "SUPPORTED", method: "cancelAllOpenOrders", guarantee: "The official Futures API exposes account/symbol order cancellation with per-order success and failure lists." },
  { type: "RECONCILE_ORDERS", status: "SUPPORTED", method: "reconcileOrder", guarantee: "Order identity and state can be reconciled by clientId/orderId, order detail reads and authenticated order events." },
  { type: "SUBSCRIBE_MARKET_PRICES", status: "SUPPORTED", method: "subscribeForPrices", guarantee: "The Futures public WebSocket exposes market-price and ticker push channels." },
  { type: "SUBSCRIBE_CANDLES", status: "SUPPORTED", method: "subscribeForCandles", guarantee: "The Futures public WebSocket exposes Kline push channels." },
  { type: "SUBSCRIBE_BOOK_TICKER", status: "SUPPORTED", method: "subscribeForBookTicker", guarantee: "The Futures public WebSocket exposes depth book push channels." },
  { type: "SUBSCRIBE_USER_DATA", status: "SUPPORTED", method: "subscribeForUserData", guarantee: "Authenticated private balance, order, position and TP/SL channels are documented." },
  { type: "RECOVER_USER_DATA_SESSION", status: "SUPPORTED", method: "recoverUserDataSession", guarantee: "The client can reconnect, re-authenticate and restore private channel subscriptions." },
  { type: "REPLAY_USER_DATA_EVENTS", status: "UNSUPPORTED", reason: "The official Futures private WebSocket does not document a replay cursor or event replay endpoint." },
  { type: "RECOVER_PROCESS_RESTART", status: "UNSUPPORTED", reason: "No durable private-event cursor or process-restart replay contract is documented." },
]

const LIVE_MUTATION_TYPES = new Set([
  "PLACE_LIMIT_ORDER",
  "PLACE_MARKET_ORDER",
  "CREATE_CANONICAL_ORDER",
  "CANCEL_ORDER",
  "CANCEL_ALL_ORDERS",
  "AMEND_ORDER",
])

/**
 * Create the Futures capability declaration using the shared BrokerCapabilities model.
 *
 * @param {{
 *   allowLiveOrderMutations?: boolean,
 *   allowLivePositionMutations?: boolean,
 *   allowLiveAccountMutations?: boolean,
 *   allowLiveFundsMutations?: boolean
 * }} [options]
 * @returns {BrokerCapabilities}
 */
export function createBitunixFuturesBrokerCapabilities({
  allowLiveOrderMutations = false,
  allowLivePositionMutations = false,
  allowLiveAccountMutations = false,
  allowLiveFundsMutations = false,
} = {}) {
  const flags = {
    allowLiveOrderMutations,
    allowLivePositionMutations,
    allowLiveAccountMutations,
    allowLiveFundsMutations,
  }
  for (const [field, value] of Object.entries(flags)) {
    if (typeof value !== "boolean") {
      throw new TypeError(`Bitunix Futures ${field} must be a boolean`)
    }
  }

  const capabilities = BITUNIX_FUTURES_CAPABILITIES.map((capability) => {
    if (!LIVE_MUTATION_TYPES.has(capability.type) || allowLiveOrderMutations) {
      return capability
    }
    return {
      type: capability.type,
      status: "UNSUPPORTED",
      method: capability.method,
      reason: "Live Bitunix Futures order mutations are disabled by default. Explicitly enable allowLiveOrderMutations only after independent live-account authorization.",
    }
  })

  return new BrokerCapabilities({
    provider: "bitunix",
    product: "futures",
    environment: {
      selector: "tradingMode",
      selectedMode: "live",
      supportedModes: ["live"],
      notes: "The official Bitunix Futures API documents only the live endpoint. Order, position, account and funds mutations are separately gated and disabled by default.",
    },
    capabilities,
  })
}
