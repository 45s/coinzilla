import { BrokerCapabilities } from "../../../broker/broker-capabilities.js"
import { BrokerUnsupportedOperationError } from "../../../broker/errors/broker-unsupported-operation-error.js"

function unsupportedResult({ operation, reason }) {
  return {
    ok: false,
    errors: [new BrokerUnsupportedOperationError({
      provider: "bitunix",
      operation,
      reason,
    })],
  }
}

const FUTURES_CAPABILITIES = [
  {
    type: "READ_BALANCES",
    status: "UNKNOWN",
    reason: "The Futures account response adapter and source-freshness contract have not yet been implemented.",
  },
  {
    type: "READ_ACCOUNT_SNAPSHOT",
    status: "UNKNOWN",
    reason: "The Futures account snapshot and source-freshness contract have not yet been verified.",
  },
  {
    type: "READ_EXCHANGE_MARKETS",
    status: "UNKNOWN",
    reason: "The Futures market catalog adapter has not yet been implemented.",
  },
  {
    type: "READ_OPEN_ORDERS",
    status: "UNKNOWN",
    reason: "The Futures open-order adapter and completeness contract have not yet been implemented.",
  },
  {
    type: "READ_ORDER",
    status: "UNKNOWN",
    reason: "The Futures order identity and detail adapter have not yet been implemented.",
  },
  {
    type: "READ_ORDER_HISTORY",
    status: "UNKNOWN",
    reason: "The Futures order-history adapter and pagination contract have not yet been implemented.",
  },
  {
    type: "READ_FILLS",
    status: "UNKNOWN",
    reason: "The Futures execution identity and fill-completeness contract have not yet been verified.",
  },
  {
    type: "PLACE_LIMIT_ORDER",
    status: "UNSUPPORTED",
    reason: "Futures order placement is not enabled until the complete request, outcome and reconciliation path is implemented.",
  },
  {
    type: "PLACE_MARKET_ORDER",
    status: "UNSUPPORTED",
    reason: "Futures order placement is not enabled until the complete request, outcome and reconciliation path is implemented.",
  },
  {
    type: "CANCEL_ORDER",
    status: "UNSUPPORTED",
    reason: "Futures cancellation is not enabled until its final-state verification and unknown-outcome handling are implemented.",
  },
  {
    type: "CANCEL_ALL_ORDERS",
    status: "UNSUPPORTED",
    reason: "Futures cancellation is not enabled until its final-state verification and unknown-outcome handling are implemented.",
  },
  {
    type: "SUBSCRIBE_USER_DATA",
    status: "UNKNOWN",
    reason: "The Futures private WebSocket event lifecycle and recovery contract have not yet been implemented.",
  },
  {
    type: "SUBSCRIBE_MARKET_PRICES",
    status: "UNKNOWN",
    reason: "The Futures public WebSocket stream lifecycle has not yet been implemented.",
  },
]

function createCapabilities({ config }) {
  return new BrokerCapabilities({
    provider: "bitunix",
    product: "futures",
    environment: {
      selector: "tradingMode",
      selectedMode: config.tradingMode,
      supportedModes: ["live"],
      notes: "The official Futures REST and WebSocket endpoints are LIVE. No Futures TESTNET endpoint is documented. Mutations are disabled by default.",
    },
    capabilities: FUTURES_CAPABILITIES,
  })
}

/**
 * Bitunix USDT-margined Futures provider. Methods remain fail-closed until
 * their exchange contract, adapter and lifecycle tests are delivered.
 */
export class BitunixFuturesBroker {
  constructor({ config, logger } = {}) {
    if (!config || config.tradingMode !== "live") {
      throw new TypeError("Bitunix Futures broker requires validated LIVE configuration")
    }
    this.config = config
    this.logger = logger
    this.connected = false
    Object.defineProperty(this, "capabilities", {
      enumerable: true,
      value: createCapabilities({ config }),
    })
  }

  async connect() {
    this.connected = true
  }

  async disconnect() {
    this.connected = false
  }

  async getBalances() {
    return unsupportedResult({ operation: "getBalances", reason: "Futures account reads are not implemented yet." })
  }

  async getAccountSnapshot() {
    return unsupportedResult({ operation: "getAccountSnapshot", reason: "Futures account snapshot reads are not implemented yet." })
  }

  async getServerTime() {
    return unsupportedResult({ operation: "getServerTime", reason: "A documented Futures server-time endpoint has not been verified." })
  }

  async getExchangeMarkets() {
    return unsupportedResult({ operation: "getExchangeMarkets", reason: "Futures market catalog reads are not implemented yet." })
  }

  async getOpenOrders() {
    return unsupportedResult({ operation: "getOpenOrders", reason: "Futures open-order reads are not implemented yet." })
  }

  async getCanonicalOrder() {
    return unsupportedResult({ operation: "getCanonicalOrder", reason: "Futures canonical order reads are not implemented yet." })
  }

  async getCanonicalOrderHistory() {
    return unsupportedResult({ operation: "getCanonicalOrderHistory", reason: "Futures canonical order history is not implemented yet." })
  }

  async getFills() {
    return unsupportedResult({ operation: "getFills", reason: "Futures canonical fills are not implemented yet." })
  }

  async getPrices() {
    return unsupportedResult({ operation: "getPrices", reason: "Futures market price reads are not implemented yet." })
  }

  async getCandles() {
    return unsupportedResult({ operation: "getCandles", reason: "Futures candle reads are not implemented yet." })
  }

  async createCanonicalOrder() {
    return unsupportedResult({ operation: "createCanonicalOrder", reason: "Futures order placement is disabled until the mutation lifecycle is verified." })
  }

  async cancelOrder() {
    return unsupportedResult({ operation: "cancelOrder", reason: "Futures cancellation is disabled until the mutation lifecycle is verified." })
  }

  async cancelAllOpenOrders() {
    return unsupportedResult({ operation: "cancelAllOpenOrders", reason: "Futures cancellation is disabled until the mutation lifecycle is verified." })
  }

  async subscribeForPrices() {
    return unsupportedResult({ operation: "subscribeForPrices", reason: "Futures public WebSocket subscriptions are not implemented yet." })
  }

  async subscribeForCandles() {
    return unsupportedResult({ operation: "subscribeForCandles", reason: "Futures public WebSocket subscriptions are not implemented yet." })
  }

  async subscribeForBookTicker() {
    return unsupportedResult({ operation: "subscribeForBookTicker", reason: "Futures public WebSocket subscriptions are not implemented yet." })
  }

  async subscribeForUserData() {
    return unsupportedResult({ operation: "subscribeForUserData", reason: "Futures private WebSocket subscriptions are not implemented yet." })
  }

  async getAssets() {
    return unsupportedResult({ operation: "getAssets", reason: "The Futures API does not expose the Spot asset projection." })
  }

  async getOrder() {
    return unsupportedResult({ operation: "getOrder", reason: "Futures order reads are not implemented yet." })
  }

  async getOrderHistory() {
    return unsupportedResult({ operation: "getOrderHistory", reason: "Futures order history is not implemented yet." })
  }

  async getMyTrades() {
    return unsupportedResult({ operation: "getMyTrades", reason: "Futures trade history is not implemented yet." })
  }

  async getPrice() {
    return unsupportedResult({ operation: "getPrice", reason: "Futures price reads are not implemented yet." })
  }

  async createOrder() {
    return unsupportedResult({ operation: "createOrder", reason: "Futures order placement is disabled until the mutation lifecycle is verified." })
  }

  async getSymbolFilters() {
    return unsupportedResult({ operation: "getSymbolFilters", reason: "Futures symbol metadata reads are not implemented yet." })
  }
}
