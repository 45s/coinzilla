import { handleErr, toResult } from "@coinzilla/utils"
import { CoreBroker } from "../../broker.core.js"
import { BitunixRestClient } from "./api/rest-client.js"
import { adaptBalances } from "./adapters/adapt-balances.js"
import { adaptOrder } from "./adapters/adapt-order.js"
import { createCanonicalMarket } from "./adapters/create-canonical-market.js"
import { BitunixSpotConfig } from "./config/bitunix-spot-config.js"

const API = Object.freeze({
  markets: "/api/spot/v1/common/coin_pair/list",
  balances: "/api/spot/v1/user/account",
  pendingOrders: "/api/spot/v1/order/pending/list",
  orderHistory: "/api/spot/v1/order/history/page",
  orderDetail: "/api/spot/v1/order/detail",
  lastPrice: "/api/spot/v1/market/last_price",
})

function unsupported(operation, reason) {
  return new Error(`Bitunix Spot ${operation} is not supported safely: ${reason}`)
}

function requireSymbol({ symbol, operation }) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError(`Bitunix Spot ${operation} requires a non-empty symbol`)
  }
  return symbol.trim().toUpperCase()
}

function requireArray({ value, operation }) {
  if (!Array.isArray(value)) {
    throw new TypeError(`Bitunix Spot ${operation} response must be an array`)
  }
  return value
}

/** Bitunix Spot adapter. Capabilities are intentionally read-only until its order lifecycle can be reconciled safely. */
export class BitunixSpotBroker extends CoreBroker {
  /**
   * @param {{apiKey: string, apiSecret: string, tradingMode: "live", baseUrl?: string, requestTimeout?: number, logger?: object}} input
   * @param {{restClientFactory?: (config: BitunixSpotConfig) => BitunixRestClient}} dependencies
   */
  constructor(input = {}, { restClientFactory = createRestClient } = {}) {
    super(input)
    this.config = new BitunixSpotConfig(input)
    this.restClient = restClientFactory(this.config)
    this.connected = false
    this.canonicalMarkets = new Map()
  }

  /** Construct the REST transport from validated configuration. */
  static createRestClient(config) {
    return createRestClient(config)
  }

  /** Mark the stateless REST adapter ready. */
  async connect() {
    this.connected = true
  }

  /** Mark the stateless REST adapter disconnected. */
  async disconnect() {
    this.connected = false
  }

  async getBalances() {
    try {
      const response = await this.restClient.request("GET", API.balances)
      return toResult({ data: adaptBalances(requireArray({
        value: response.data,
        operation: "account",
      })) })
    } catch (error) {
      handleErr({ where: "BitunixSpotBroker.getBalances()", error })
      return toResult({ errors: [error] })
    }
  }

  async getAccountSnapshot() {
    const error = unsupported(
      "getAccountSnapshot()",
      "the Spot account endpoint does not provide a source update timestamp",
    )
    return toResult({ errors: [error] })
  }

  async getExchangeMarkets() {
    try {
      const response = await this.restClient.request("GET", API.markets)
      const rows = requireArray({ value: response.data, operation: "market catalog" })
      const markets = rows.map((symbolInfo) => createCanonicalMarket({ symbolInfo }))
      const seen = new Set()
      for (const market of markets) {
        if (seen.has(market.symbol)) {
          throw new TypeError(`Bitunix Spot market catalog contains duplicate symbol ${market.symbol}`)
        }
        seen.add(market.symbol)
        this.canonicalMarkets.set(market.symbol, market)
      }
      return toResult({ data: Object.freeze(markets) })
    } catch (error) {
      handleErr({ where: "BitunixSpotBroker.getExchangeMarkets()", error })
      return toResult({ errors: [error] })
    }
  }

  async getSymbolFilters({ symbol } = {}) {
    try {
      const normalizedSymbol = requireSymbol({ symbol, operation: "getSymbolFilters()" })
      const response = await this.restClient.request("GET", API.markets)
      const rows = requireArray({ value: response.data, operation: "market catalog" })
      const symbolInfo = rows.find((row) =>
        typeof row?.symbol === "string" && row.symbol.toUpperCase() === normalizedSymbol,
      )
      if (!symbolInfo) {
        throw new Error(`Bitunix Spot market ${normalizedSymbol} was not found`)
      }
      return toResult({ data: symbolInfo })
    } catch (error) {
      handleErr({ where: "BitunixSpotBroker.getSymbolFilters()", error })
      return toResult({ errors: [error] })
    }
  }

  async getOpenOrders({ symbol } = {}) {
    try {
      const normalizedSymbol = requireSymbol({ symbol, operation: "getOpenOrders()" })
      const response = await this.restClient.request("POST", API.pendingOrders, {
        body: { symbol: normalizedSymbol },
      })
      const rows = requireArray({ value: response.data, operation: "pending orders" })
      return toResult({ data: rows.map(adaptOrder) })
    } catch (error) {
      handleErr({ where: "BitunixSpotBroker.getOpenOrders()", error })
      return toResult({ errors: [error] })
    }
  }

  async getOrderHistory({ symbol, orderId, startTime, endTime, limit } = {}) {
    try {
      const normalizedSymbol = requireSymbol({ symbol, operation: "getOrderHistory()" })
      const body = { symbol: normalizedSymbol }
      if (limit !== undefined) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new RangeError("Bitunix Spot order history limit must be from 1 to 100")
        }
        body.pageSize = limit
      }
      if (orderId !== undefined && orderId !== null) {
        throw new TypeError("Bitunix Spot order history does not support exact orderId filtering")
      }
      for (const [field, value] of [["startTime", startTime], ["endTime", endTime]]) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
          throw new RangeError(`Bitunix Spot ${field} must be a non-negative safe integer`)
        }
      }
      if (startTime !== undefined) body.startTime = new Date(startTime).toISOString()
      if (endTime !== undefined) body.endTime = new Date(endTime).toISOString()
      if (startTime !== undefined && endTime !== undefined && startTime > endTime) {
        throw new RangeError("Bitunix Spot startTime must not be after endTime")
      }
      const response = await this.restClient.request("POST", API.orderHistory, { body })
      const rows = response.data?.data
      return toResult({ data: requireArray({ value: rows, operation: "order history" }) })
    } catch (error) {
      handleErr({ where: "BitunixSpotBroker.getOrderHistory()", error })
      return toResult({ errors: [error] })
    }
  }

  async getOrder({ symbol, orderId } = {}) {
    try {
      requireSymbol({ symbol, operation: "getOrder()" })
      if ((typeof orderId !== "string" && typeof orderId !== "number") || !String(orderId).trim()) {
        throw new TypeError("Bitunix Spot getOrder() requires a broker orderId")
      }
      const response = await this.restClient.request("GET", API.orderDetail, {
        queryParams: { orderId: String(orderId) },
      })
      if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
        throw new TypeError("Bitunix Spot order detail response must be an object")
      }
      if (String(response.data.orderId) !== String(orderId)) {
        throw new TypeError("Bitunix Spot order detail returned a different orderId")
      }
      return toResult({ data: adaptOrder(response.data) })
    } catch (error) {
      handleErr({ where: "BitunixSpotBroker.getOrder()", error })
      return toResult({ errors: [error] })
    }
  }

  async getPrices({ symbol } = {}) {
    try {
      const normalizedSymbol = requireSymbol({ symbol, operation: "getPrices()" })
      const response = await this.restClient.request("GET", API.lastPrice, {
        queryParams: { symbol: normalizedSymbol },
      })
      return toResult({ data: response.data })
    } catch (error) {
      handleErr({ where: "BitunixSpotBroker.getPrices()", error })
      return toResult({ errors: [error] })
    }
  }

  async createOrder() {
    const error = unsupported(
      "createOrder()",
      "Bitunix Spot has no exchange-side client order ID, so a lost placement response cannot be reconciled idempotently",
    )
    return toResult({ errors: [error] })
  }

  async cancelOrder() {
    const error = unsupported(
      "cancelOrder()",
      "the adapter has no private order/execution push stream or verified cancellation-outcome reconciliation",
    )
    return {
      ...toResult({ errors: [error] }),
      cancellationOutcome: "NOT_SENT",
    }
  }

  async subscribeForPrices() {
    throw unsupported(
      "subscribeForPrices()",
      "the documented Spot WebSocket API exposes request/response market calls, not a continuous price subscription",
    )
  }

  async getCanonicalOrder() {
    const error = unsupported(
      "getCanonicalOrder()",
      "Bitunix Spot orders do not expose a clientOrderId required by the canonical order contract",
    )
    return toResult({ errors: [error] })
  }

  async getCanonicalOrderHistory() {
    const error = unsupported(
      "getCanonicalOrderHistory()",
      "the canonical order contract requires a clientOrderId that Bitunix Spot does not expose",
    )
    return toResult({ errors: [error] })
  }

  async getServerTime() {
    const error = unsupported(
      "getServerTime()",
      "no documented Spot server-time endpoint is available",
    )
    return toResult({ errors: [error] })
  }
}

function createRestClient(config) {
  return new BitunixRestClient({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    baseUrl: config.baseUrl,
  })
}
