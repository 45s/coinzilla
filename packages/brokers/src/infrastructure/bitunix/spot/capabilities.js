import { BrokerCapabilities } from "../../../broker/broker-capabilities.js"

const BITUNIX_SPOT_CAPABILITIES = [
  {
    type: "READ_ASSETS",
    status: "SUPPORTED",
    method: "getAssets",
    guarantee: "Returns legacy non-zero Coin projections from the Spot account.",
    limitation: "Coin quantities use JavaScript Number for compatibility; use getBalances for exact decimal values.",
  },
  {
    type: "READ_BALANCES",
    status: "SUPPORTED",
    method: "getBalances",
    guarantee: "Returns canonical balances with exact decimal strings and preserves free/locked amounts.",
  },
  {
    type: "READ_ACCOUNT_SNAPSHOT",
    status: "UNSUPPORTED",
    method: "getAccountSnapshot",
    reason: "The Spot account endpoint does not provide a source timestamp or version for an authoritative snapshot.",
  },
  {
    type: "READ_SERVER_TIME",
    status: "UNSUPPORTED",
    method: "getServerTime",
    reason: "No documented Bitunix Spot server-time endpoint is available.",
  },
  {
    type: "READ_EXCHANGE_MARKETS",
    status: "SUPPORTED",
    method: "getExchangeMarkets",
    guarantee: "Returns the validated active Spot pair catalog and excludes pairs without explicit open status.",
  },
  {
    type: "READ_SYMBOL_FILTERS",
    status: "SUPPORTED",
    method: "getSymbolFilters",
    guarantee: "Returns the unique matching raw Spot pair metadata with validated documented fields.",
    limitation: "The result does not establish exact price/quantity increments or undocumented maximum constraints.",
  },
  {
    type: "READ_TRADING_RULES",
    status: "UNKNOWN",
    reason: "The official Spot pair catalog does not establish exact tick size, quantity step, or authoritative maximum constraints.",
  },
  {
    type: "READ_OPEN_ORDERS",
    status: "SUPPORTED",
    method: "getOpenOrders",
    guarantee: "Returns validated current orders for one explicitly requested symbol.",
    conditions: ["A non-empty symbol is required; account-wide open-order coverage is not documented."],
  },
  {
    type: "READ_ORDER",
    status: "SUPPORTED",
    method: "getOrder",
    guarantee: "Reads one order by broker order ID and validates the returned symbol and order identity.",
    limitation: "The Spot API does not expose clientOrderId.",
  },
  {
    type: "READ_ORDER_HISTORY",
    status: "SUPPORTED",
    method: "getOrderHistory",
    guarantee: "Returns one validated symbol-scoped page and verifies the response page identity.",
    limitation: "The broker does not automatically paginate, infer ordering, or claim a complete history snapshot.",
  },
  {
    type: "READ_CANONICAL_ORDER",
    status: "UNSUPPORTED",
    method: "getCanonicalOrder",
    reason: "Bitunix Spot does not expose clientOrderId, which is required by the canonical order identity contract.",
  },
  {
    type: "READ_CANONICAL_ORDER_HISTORY",
    status: "UNSUPPORTED",
    method: "getCanonicalOrderHistory",
    reason: "Bitunix Spot order history does not expose clientOrderId required by the canonical order contract.",
  },
  {
    type: "READ_TRADE_HISTORY",
    status: "UNSUPPORTED",
    method: "getMyTrades",
    reason: "The documented Spot API does not provide an account-wide trade-history endpoint.",
  },
  {
    type: "READ_FILLS",
    status: "UNSUPPORTED",
    method: "getFills",
    reason: "The matching-order response does not establish quantity denomination, partial-fill completeness, or stable execution identity required for canonical fills.",
  },
  {
    type: "READ_COMPLETE_FILL_HISTORY",
    status: "UNKNOWN",
    reason: "The official Spot contract does not establish exhaustive execution history, pagination, or stable per-execution identity.",
  },
  {
    type: "READ_MARKET_PRICE",
    status: "SUPPORTED",
    method: "getPrices",
    guarantee: "Returns a positive one-shot price as an exact decimal string.",
    limitation: "The endpoint does not provide a source timestamp.",
  },
  {
    type: "READ_CANDLES",
    status: "UNSUPPORTED",
    method: "getCandles",
    reason: "The documented Spot kline response omits volume required by the canonical OHLCV candle contract.",
  },
  {
    type: "READ_ORDER_BOOK",
    status: "SUPPORTED",
    method: "getOrderBook",
    guarantee: "Returns validated one-shot Spot depth with exact decimal price and volume strings.",
    conditions: ["The caller must supply the documented precision parameter; Coinzilla does not infer it."],
  },
  {
    type: "READ_KLINES",
    status: "SUPPORTED",
    method: "getKlines",
    guarantee: "Returns the documented current Spot OHLC row without inventing volume.",
  },
  {
    type: "READ_KLINE_HISTORY",
    status: "SUPPORTED",
    method: "getKlineHistory",
    guarantee: "Returns one validated historical OHLC page with the source timestamp preserved.",
    limitation: "No cursor or automatic pagination is documented.",
  },
  {
    type: "READ_EXCHANGE_RATES",
    status: "SUPPORTED",
    method: "getExchangeRates",
    guarantee: "Returns an immutable exchange-rate catalog with positive exact decimal strings.",
  },
  {
    type: "READ_DEPOSITS",
    status: "SUPPORTED",
    method: "getDeposits",
    guarantee: "Returns one validated signed read-only deposit/internal-transfer-in history page.",
    limitation: "The endpoint has no documented cursor or automatic pagination.",
  },
  {
    type: "READ_DEPOSIT_ADDRESS",
    status: "SUPPORTED",
    method: "getDepositAddress",
    guarantee: "Reads existing addresses for an explicitly supplied coin and network without generating or selecting an address.",
  },
  {
    type: "READ_WITHDRAWAL_HISTORY",
    status: "SUPPORTED",
    method: "getWithdrawalHistory",
    guarantee: "Returns one validated signed read-only withdrawal/internal-transfer-out history page.",
    limitation: "The endpoint has no documented cursor or automatic pagination.",
  },
  {
    type: "READ_MATCHING_ORDER_DETAILS",
    status: "SUPPORTED",
    method: "getMatchingOrderDetails",
    guarantee: "Returns one validated exchange-native matching-order detail record without reinterpreting its fields.",
    limitation: "The response does not prove fill completeness, quantity denomination, or stable execution identity.",
  },
  {
    type: "PLACE_LIMIT_ORDER",
    status: "SUPPORTED",
    method: "createOrder",
    guarantee: "Uses only the documented single-order REST endpoint; sends the exact generic base quantity as base-coin volume and verifies the returned order ID with order detail.",
    conditions: ["LIMIT volume is base-coin quantity on the current official REST contract."],
    limitation: "Bitunix does not accept a caller-supplied clientOrderId. A transport failure after dispatch returns OUTCOME_UNKNOWN and is never retried; callers must reconcile manually. Exact tick/step constraints remain UNKNOWN and are enforced by the exchange. The REST endpoint documents no time-in-force selector; the exchange default is not asserted.",
  },
  {
    type: "PLACE_MARKET_ORDER",
    status: "SUPPORTED",
    method: "createOrder",
    guarantee: "Uses only the documented single-order REST endpoint and sends generic quoteQuantity as quote-coin volume without estimating from a market price.",
    conditions: ["MARKET volume is quote-coin quantity; quoteQuantity is required."],
    limitation: "Bitunix does not accept a caller-supplied clientOrderId. A transport failure after dispatch returns OUTCOME_UNKNOWN and is never retried; callers must reconcile manually.",
  },
  {
    type: "CANCEL_ORDER",
    status: "SUPPORTED",
    method: "cancelOrder",
    guarantee: "Cancels one explicitly identified order through the signed Spot REST endpoint and verifies the final order state through order detail.",
    limitation: "A lost cancellation acknowledgement or a non-terminal follow-up status is reported as OUTCOME_UNKNOWN; no private Spot event stream exists, so callers must reconcile manually and must not blindly retry.",
  },
  {
    type: "CANCEL_ALL_ORDERS",
    status: "SUPPORTED",
    method: "cancelAllOpenOrders",
    guarantee: "Cancels and verifies every currently open order returned for one explicitly requested Spot symbol.",
    conditions: ["A non-empty symbol is required; the Spot API does not document account-wide open-order enumeration."],
    limitation: "Only rows returned by the symbol-scoped current-order query are attempted; response completeness is not established. Partial failures and unknown outcomes are returned; callers must not blindly retry.",
  },
  {
    type: "SUBSCRIBE_MARKET_PRICES",
    status: "UNSUPPORTED",
    method: "subscribeForPrices",
    reason: "The documented Spot WebSocket API exposes request/response RPCs, not a continuous price subscription.",
  },
  {
    type: "SUBSCRIBE_CANDLES",
    status: "UNSUPPORTED",
    method: "subscribeForCandles",
    reason: "The documented Spot WebSocket API does not define a continuous candle subscription.",
  },
  {
    type: "SUBSCRIBE_BOOK_TICKER",
    status: "UNSUPPORTED",
    method: "subscribeForBookTicker",
    reason: "The documented Spot WebSocket API does not define a continuous order-book subscription.",
  },
  {
    type: "OBSERVE_USER_DATA",
    status: "SUPPORTED",
    method: "subscribeForUserData",
    guarantee: "Polls explicitly scoped Spot account/order data and delivers changed snapshots through onObservation.",
    limitation: "Observations use local time only, cannot replay transient states, do not establish account-wide completeness, and are not canonical fills or authoritative account snapshots.",
    conditions: [
      "At least one explicit Spot symbol and an onObservation callback are required.",
      "Only explicitly supplied tracked order identities are queried for matching-order details.",
    ],
  },
  {
    type: "SUBSCRIBE_USER_DATA",
    status: "UNSUPPORTED",
    method: "subscribeForUserData",
    reason: "The documented private Spot WebSocket API does not define a continuous native order/execution event stream.",
  },
  {
    type: "RECONCILE_ORDERS",
    status: "UNSUPPORTED",
    reason: "The broker has no verified canonical order identity, complete execution history, or source-timestamped account snapshot for reconciliation.",
  },
  {
    type: "REPLAY_USER_DATA_EVENTS",
    status: "UNSUPPORTED",
    reason: "No continuous private Spot event stream or event replay cursor is documented.",
  },
  {
    type: "RECOVER_USER_DATA_SESSION",
    status: "UNSUPPORTED",
    reason: "No continuous private Spot user-data subscription or resubscription contract is documented.",
  },
  {
    type: "RECOVER_PROCESS_RESTART",
    status: "UNSUPPORTED",
    reason: "The broker has no durable session or process-restart recovery contract.",
  },
]

const LIVE_MUTATION_TYPES = new Set([
  "PLACE_LIMIT_ORDER",
  "PLACE_MARKET_ORDER",
  "CANCEL_ORDER",
  "CANCEL_ALL_ORDERS",
])

/**
 * Create the immutable, evidence-backed Bitunix Spot capability declaration.
 *
 * @param {{allowLiveOrderMutations?: boolean}} options
 * @returns {BrokerCapabilities}
 */
export function createBitunixBrokerCapabilities({ allowLiveOrderMutations = false } = {}) {
  if (typeof allowLiveOrderMutations !== "boolean") {
    throw new TypeError("Bitunix Spot allowLiveOrderMutations must be a boolean")
  }
  const capabilities = BITUNIX_SPOT_CAPABILITIES.map((capability) => {
    if (!LIVE_MUTATION_TYPES.has(capability.type) || allowLiveOrderMutations) {
      return capability
    }
    return {
      type: capability.type,
      status: "UNSUPPORTED",
      method: capability.method,
      reason: "Live Bitunix Spot mutations are disabled by default. Explicitly set allowLiveOrderMutations: true only after independent live-account authorization.",
    }
  })
  return new BrokerCapabilities({
    provider: "bitunix",
    product: "spot",
    environment: {
      selector: "tradingMode",
      selectedMode: "live",
      supportedModes: ["live"],
      notes: "No Bitunix Spot TESTNET is documented. Live order mutations are disabled by default and require explicit configuration opt-in.",
    },
    capabilities,
  })
}
