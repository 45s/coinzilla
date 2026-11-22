import { assertDecimalString, compareDecimal, defaultLogger, handleErr, toResult } from "@coinzilla/utils"
import { getBrokerMutationOutcome } from "../../../broker/broker-contract.js"
import { BrokerUnsupportedOperationError } from "../../../broker/errors/broker-unsupported-operation-error.js"
import { createBitunixBrokerCapabilities } from "./capabilities.js"
import { BitunixRestClient } from "./api/rest-client.js"
import { adaptAssets } from "./adapters/adapt-assets.js"
import { adaptBalances } from "./adapters/adapt-balances.js"
import { adaptBitunixKline, adaptBitunixKlineHistory, adaptBitunixOrderBook, createBitunixKlineHistoryQuery, normalizeBitunixKlineInterval } from "./adapters/adapt-market-data.js"
import { adaptExchangeRates } from "./adapters/adapt-exchange-rates.js"
import { adaptTokenNetworks } from "./adapters/adapt-token-networks.js"
import { adaptUserInfo } from "./adapters/adapt-user-info.js"
import { adaptTaxFilingPage, createTaxFilingQuery } from "./adapters/adapt-tax-filing.js"
import {
  createCancelInternalTransferRequest,
  createCancelWithdrawalRequest,
  createFundsTransferRequest,
  createInternalTransferRequest,
  createWithdrawalRequest,
  normalizeFundsMutationAcknowledgement,
  normalizeFundsMutationId,
} from "./adapters/funds-mutation-requests.js"
import { adaptDepositAddresses } from "./adapters/adapt-deposit-addresses.js"
import { adaptDeposits } from "./adapters/adapt-deposits.js"
import { BitunixDepositAddressError } from "./errors/bitunix-deposit-address-error.js"
import { adaptWithdrawalHistory } from "./adapters/adapt-withdrawal-history.js"
import { adaptMatchingOrderDetails } from "./adapters/adapt-matching-order-details.js"
import { adaptOrder } from "./adapters/adapt-order.js"
import { createCanonicalMarket, getBitunixSymbol } from "./adapters/create-canonical-market.js"
import { validateBitunixSymbolFilterMetadata } from "./adapters/validate-symbol-filter-metadata.js"
import { createDepositRequest, createHistoryRequest, createWithdrawalHistoryRequest, normalizeOrderHistoryPage } from "./adapters/history-requests.js"
import { BitunixSpotConfig } from "./config/bitunix-spot-config.js"
import { BitunixSpotReconciler } from "./reconciler.js"
import {
  BITUNIX_SPOT_ORDER_API,
  createSpotCancelRequest,
  createSpotOrderDetailRequest,
  createSpotOrderRequest,
  validateOrderDetailResponse,
  validateOrderId,
  validateSpotOrderPlacementResponse,
} from "./adapters/order-requests.js"

const API = Object.freeze({
  markets: "/api/spot/v1/common/coin_pair/list",
  balances: "/api/spot/v1/user/account",
  pendingOrders: "/api/spot/v1/order/pending/list",
  orderHistory: "/api/spot/v1/order/history/page",
  orderDetail: BITUNIX_SPOT_ORDER_API.orderDetail,
  placeOrder: BITUNIX_SPOT_ORDER_API.placeOrder,
  lastPrice: "/api/spot/v1/market/last_price",
  exchangeRates: "/api/spot/v1/common/rate/list",
  tokenNetworks: "/api/spot/v1/common/coin/coin_network/list",
  userInfo: "/api/spot/v1/user/info",
  taxFiling: "/api/spot/v1/tax/filing/page",
  withdraw: "/api/spot/v1/withdraw",
  cancelWithdrawal: "/api/spot/v1/withdraw/cancel",
  insideTransfer: "/api/spot/v1/inside_transfer",
  cancelInsideTransfer: "/api/spot/v1/inside_transfer/cancel",
  fundsTransfer: "/api/spot/v1/funds_transfer",
  depth: "/api/spot/v1/market/depth",
  kline: "/api/spot/v1/market/kline",
  klineHistory: "/api/spot/v1/market/kline/history",
  deposits: "/api/spot/v1/deposit/page",
  depositAddress: "/api/spot/v1/deposit/address",
  withdrawalHistory: "/api/spot/v1/withdraw_transfer/page",
  matchingOrderDetails: "/api/spot/v1/order/deal/list",
})

function logBrokerDiagnostic({ logger, level = "debug", event }) {
  try {
    logger?.[level]?.({
      provider: "bitunix",
      product: "spot",
      layer: "broker-api",
      ...event,
    })
  } catch {
    // Diagnostics must never change Broker API behavior.
  }
}

function unsupported({ operation, reason }) {
  return new BrokerUnsupportedOperationError({
    provider: "bitunix",
    operation: operation.replace(/\(\)$/, ""),
    reason,
  })
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

function normalizeOrderRows({ value }) {
  if (Array.isArray(value)) {
    return value
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value) && value.orderId !== undefined) {
    return [value]
  }
  throw new TypeError("Bitunix Spot pending orders response must contain order rows")
}

function adaptSymbolOrderRows({ rows, symbol, operation }) {
  return rows.map((row) => {
    if (typeof row?.symbol !== "string" || row.symbol.trim().toUpperCase() !== symbol) {
      throw new TypeError(`Bitunix Spot ${operation} response symbol does not match the requested symbol`)
    }
    return adaptOrder(row)
  })
}

function isOpenMarket({ symbolInfo }) {
  return symbolInfo?.isOpen === "1" || symbolInfo?.isOpen === 1
}

function requireDepositAddressInput({ value, field }) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BitunixDepositAddressError({
      message: `Bitunix Spot deposit-address ${field} must be a non-empty string`,
      kind: "input",
      field,
    })
  }
  return value
}

function createDepositAddressRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BitunixDepositAddressError({
      message: "Bitunix Spot getDepositAddress() input must be an object",
      kind: "input",
      field: "input",
    })
  }
  const body = {
    coin: requireDepositAddressInput({
      value: input.coin,
      field: "coin",
    }),
    network: requireDepositAddressInput({
      value: input.network,
      field: "network",
    }),
  }
  return { body }
}

function createMatchingOrderDetailsRequest({ input }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bitunix Spot getMatchingOrderDetails() input must be an object")
  }
  if (typeof input.orderId !== "string" || !input.orderId.trim()) {
    throw new TypeError("Bitunix Spot matching-order orderId must be a non-empty string")
  }
  if (typeof input.symbol !== "string" || !input.symbol.trim()) {
    throw new TypeError("Bitunix Spot matching-order symbol must be a non-empty string")
  }
  return {
    body: {
      orderId: input.orderId,
      symbol: input.symbol,
    },
  }
}

function unsupportedMutationResult({ operation, reason }) {
  return {
    ...toResult({
      errors: [unsupported({
        operation,
        reason,
      })],
    }),
    mutationOutcome: "NOT_SENT",
  }
}

async function executeFundsMutation({
  config,
  restClient,
  operation,
  path,
  input,
  buildRequest,
  normalizeResponse,
}) {
  if (!config.allowLiveFundsMutations) {
    return unsupportedMutationResult({
      operation,
      reason: "live Bitunix funds mutations are disabled by default; " +
        "set allowLiveFundsMutations: true only after independent funds-operation authorization",
    })
  }

  let requestDispatched = false
  try {
    const body = buildRequest({ input })
    requestDispatched = true
    const response = await restClient.request({
      method: "POST",
      path,
      body,
      authenticated: true,
      stateChanging: true,
    })
    return toResult({
      data: normalizeResponse({
        data: response.data,
        body,
      }),
      mutationOutcome: "CONFIRMED",
    })
  } catch (error) {
    handleErr({
      where: `BitunixSpotBroker.${operation}()`,
      error,
    })
    return toResult({
      errors: [error],
      mutationOutcome: error?.kind === "exchange"
        ? "REJECTED"
        : getBrokerMutationOutcome({
          error,
          requestDispatched,
        }),
    })
  }
}

function createClientOrderIdUnsupportedResult({ clientOrderId }) {
  if (clientOrderId === undefined || clientOrderId === null) {
    return null
  }
  return toResult({
    errors: [unsupported({
      operation: "getOrder",
      reason: "Bitunix Spot does not expose clientOrderId; use a broker orderId.",
    })],
  })
}

async function reconcileSpotOrderPlacement({ restClient, symbol, placementData }) {
  try {
    const order = await getBitunixSpotOrderDetail({
      restClient,
      symbol,
      orderId: placementData.orderId,
    })
    return toResult({
      data: order,
      mutationOutcome: "CONFIRMED",
    })
  } catch (error) {
    handleErr({
      where: "BitunixSpotBroker.createOrder() detail reconciliation",
      error,
    })
    return toResult({
      data: placementData,
      errors: [error],
      mutationOutcome: "CONFIRMED",
    })
  }
}

async function sendBitunixSpotCancelRequest({ restClient, symbol, orderId }) {
  return restClient.request(createSpotCancelRequest({
    symbol,
    orderId,
  }))
}

async function getBitunixSpotOrderDetail({ restClient, symbol, orderId }) {
  const response = await restClient.request(createSpotOrderDetailRequest({ orderId }))
  return adaptOrder(validateOrderDetailResponse({
    response,
    orderId,
    symbol,
  }))
}

function createCancelOrderFailureResult({ error, requestDispatched, cancelAcknowledged }) {
  let mutationOutcome
  if (cancelAcknowledged) {
    mutationOutcome = "CONFIRMED"
  } else if (error?.kind === "exchange") {
    mutationOutcome = "REJECTED"
  } else {
    mutationOutcome = getBrokerMutationOutcome({
      error,
      requestDispatched,
    })
  }
  const cancellationOutcome = cancelAcknowledged ||
    (requestDispatched && mutationOutcome !== "NOT_SENT")
    ? "OUTCOME_UNKNOWN"
    : "NOT_SENT"
  return toResult({
    errors: [error],
    mutationOutcome,
    cancellationOutcome,
  })
}

async function cancelOpenOrdersForSymbol({ broker, symbol, orders }) {
  const results = []
  const errors = []
  let hasUnknownOutcome = false
  for (const order of orders) {
    const cancellation = await broker.cancelOrder({
      symbol,
      orderId: order.id,
    })
    if (cancellation.ok) {
      results.push(cancellation.data)
      continue
    }
    errors.push(...(cancellation.errors ?? []))
    results.push(cancellation.data ?? order)
    if (cancellation.cancellationOutcome === "OUTCOME_UNKNOWN") {
      hasUnknownOutcome = true
    }
  }

  const allConfirmed = errors.length === 0
  let mutationOutcome = "REJECTED"
  let cancellationOutcome = "OUTCOME_UNKNOWN"
  if (hasUnknownOutcome) {
    mutationOutcome = "OUTCOME_UNKNOWN"
  } else if (allConfirmed) {
    mutationOutcome = "CONFIRMED"
    cancellationOutcome = "CONFIRMED"
  }
  return toResult({
    data: results,
    ...(errors.length > 0 ? { errors } : {}),
    mutationOutcome,
    cancellationOutcome,
  })
}

function createBitunixUserDataStatusReporter({ onStatus }) {
  return (status) => {
    if (typeof onStatus !== "function") {
      return
    }
    try {
      onStatus(status)
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.subscribeForUserData().onStatus",
        error,
      })
    }
  }
}

function startBitunixUserDataObservationPolling({
  broker,
  symbols,
  trackedOrders,
  intervalMs,
  onObservation,
  onStatus,
}) {
  const reportStatus = createBitunixUserDataStatusReporter({ onStatus })
  const reconciler = broker.reconcilerFactory({ broker })
  const session = reconciler.start({
    symbols,
    trackedOrders,
    intervalMs,
    onSnapshot: (observation) => onObservation({ observation }),
    onStatus: reportStatus,
    onError: (error) => {
      handleErr({
        where: "BitunixSpotBroker.subscribeForUserData().poll",
        error,
      })
      reportStatus({
        type: "pollingError",
        deliveryMode: "POLLING_OBSERVATIONS",
        nativePush: false,
        error,
      })
    },
  })

  let active = true
  const subscription = Object.freeze({
    deliveryMode: "POLLING_OBSERVATIONS",
    nativePush: false,
    disconnect: async () => {
      if (!active) {
        return
      }
      active = false
      session.stop()
      broker.userDataSubscriptions.delete(subscription)
    },
    getStatus: () => session.getStatus(),
  })
  broker.userDataSubscriptions.add(subscription)
  return subscription
}

export class BitunixSpotBroker {
  /**
   * @param {{
 *   apiKey: string,
 *   apiSecret: string,
 *   tradingMode: "live",
 *   baseUrl?: string,
 *   requestTimeout?: number,
 *   allowLiveOrderMutations?: boolean,
 *   allowLiveFundsMutations?: boolean,
 *   logger?: object,
 *   dependencies?: {restClientFactory?: (config: BitunixSpotConfig) => BitunixRestClient, reconcilerFactory?: ({broker: BitunixSpotBroker}) => BitunixSpotReconciler},
 * }} input
   */
  constructor(input = {}) {
    const {
      dependencies = {},
      ...configInput
    } = input
    const {
      restClientFactory = createRestClient,
      reconcilerFactory = ({ broker }) => new BitunixSpotReconciler({ broker }),
    } = dependencies
    if (typeof reconcilerFactory !== "function") {
      throw new TypeError("Bitunix Spot reconcilerFactory must be a function")
    }
    this.logger = configInput.logger || defaultLogger
    this.config = new BitunixSpotConfig(configInput)
    Object.defineProperty(this, "capabilities", {
      enumerable: true,
      value: createBitunixBrokerCapabilities({ allowLiveOrderMutations: this.config.allowLiveOrderMutations }),
    })
    this.restClient = restClientFactory(this.config, this.logger)
    this.connected = false
    this.canonicalMarkets = new Map()
    this.reconcilerFactory = reconcilerFactory
    this.userDataSubscriptions = new Set()
  }

  /** Mark the stateless REST adapter ready. */
  async connect() {
    this.connected = true
  }

  /** Stop active polling subscriptions and mark the stateless REST adapter disconnected. */
  async disconnect() {
    for (const subscription of [...this.userDataSubscriptions]) {
      await subscription.disconnect()
    }
    this.connected = false
  }

  async getBalances() {
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: API.balances,
      })
      return toResult({
        data: adaptBalances(requireArray({
          value: response.data,
          operation: "account",
        })),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getBalances()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getAccountSnapshot() {
    const error = unsupported({
      operation: "getAccountSnapshot()",
      reason: "the Spot account endpoint does not provide a source timestamp",
    })
    return toResult({ errors: [error] })
  }

  async getExchangeMarkets() {
    logBrokerDiagnostic({
      logger: this.logger,
      event: { event: "getExchangeMarkets.started" },
    })
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: API.markets,
        authenticated: false,
      })
      const rows = requireArray({
        value: response.data,
        operation: "market catalog",
      })
      const markets = rows
        .filter((symbolInfo) => isOpenMarket({ symbolInfo }))
        .map((symbolInfo) => createCanonicalMarket({ symbolInfo }))
      const seen = new Set()
      for (const market of markets) {
        if (seen.has(market.symbol)) {
          throw new TypeError(`Bitunix Spot market catalog contains duplicate symbol ${market.symbol}`)
        }
        seen.add(market.symbol)
        this.canonicalMarkets.set(market.symbol, market)
      }
      logBrokerDiagnostic({
        logger: this.logger,
        event: {
          event: "getExchangeMarkets.completed",
          ok: true,
          marketCount: markets.length,
          symbols: markets.map((market) => market.symbol),
        },
      })
      return toResult({ data: Object.freeze(markets) })
    } catch (error) {
      logBrokerDiagnostic({
        logger: this.logger,
        level: "error",
        event: {
          event: "getExchangeMarkets.failed",
          error: {
            name: error?.name,
            code: error?.code,
            message: error?.message,
          },
        },
      })
      handleErr({
        where: "BitunixSpotBroker.getExchangeMarkets()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getSymbolFilters({ symbol } = {}) {
    try {
      const normalizedSymbol = requireSymbol({
        symbol,
        operation: "getSymbolFilters()",
      })
      const response = await this.restClient.request({
        method: "GET",
        path: API.markets,
        authenticated: false,
      })
      const rows = requireArray({
        value: response.data,
        operation: "market catalog",
      })
      const matchingRows = rows.filter((row) =>
        getBitunixSymbol({ symbolInfo: row }) === normalizedSymbol,
      )
      if (matchingRows.length === 0) {
        throw new Error(`Bitunix Spot market ${normalizedSymbol} was not found`)
      }
      if (matchingRows.length > 1) {
        throw new TypeError(`Bitunix Spot market catalog contains duplicate metadata for symbol ${normalizedSymbol}`)
      }
      const [symbolInfo] = matchingRows
      validateBitunixSymbolFilterMetadata({ symbolInfo })
      return toResult({
        data: {
          ...symbolInfo,
          symbol: normalizedSymbol,
        },
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getSymbolFilters()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getOpenOrders({ symbol } = {}) {
    logBrokerDiagnostic({
      logger: this.logger,
      event: { event: "getOpenOrders.started", symbol: symbol ?? null },
    })
    try {
      const normalizedSymbol = requireSymbol({
        symbol,
        operation: "getOpenOrders()",
      })
      const response = await this.restClient.request({
        method: "POST",
        path: API.pendingOrders,
        body: { symbol: normalizedSymbol },
        stateChanging: false,
      })
      const rows = normalizeOrderRows({ value: response.data })
      const orders = adaptSymbolOrderRows({
        rows,
        symbol: normalizedSymbol,
        operation: "open orders",
      })
      logBrokerDiagnostic({
        logger: this.logger,
        event: {
          event: "getOpenOrders.completed",
          ok: true,
          symbol: normalizedSymbol,
          orderCount: orders.length,
          orderIds: orders.map((order) => order.id),
        },
      })
      return toResult({ data: orders })
    } catch (error) {
      logBrokerDiagnostic({
        logger: this.logger,
        level: "error",
        event: {
          event: "getOpenOrders.failed",
          symbol: symbol ?? null,
          error: {
            name: error?.name,
            code: error?.code,
            exchangeCode: error?.exchangeCode,
            message: error?.message,
          },
        },
      })
      handleErr({
        where: "BitunixSpotBroker.getOpenOrders()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getOrderHistory(input = {}) {
    try {
      const { body } = createHistoryRequest({
        input,
        requireSymbol,
      })
      const response = await this.restClient.request({
        method: "POST",
        path: API.orderHistory,
        body,
        stateChanging: false,
      })
      const rows = normalizeOrderHistoryPage({
        value: response.data,
        requestedPage: body.page,
      })
      return toResult({
        data: adaptSymbolOrderRows({
          rows,
          symbol: body.symbol,
          operation: "order history",
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getOrderHistory()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getOrder({ symbol, orderId, clientOrderId } = {}) {
    logBrokerDiagnostic({
      logger: this.logger,
      event: { event: "getOrder.started", symbol: symbol ?? null, orderId: orderId ?? null },
    })
    try {
      const unsupportedResult = createClientOrderIdUnsupportedResult({ clientOrderId })
      if (unsupportedResult) {
        return unsupportedResult
      }
      let normalizedSymbol
      if (symbol !== undefined) {
        normalizedSymbol = requireSymbol({
          symbol,
          operation: "getOrder()",
        })
      }
      const normalizedOrderId = validateOrderId({ orderId })
      const response = await this.restClient.request({
        method: "GET",
        path: API.orderDetail,
        queryParams: { orderId: normalizedOrderId },
      })
      const order = validateOrderDetailResponse({
        response,
        orderId: normalizedOrderId,
        symbol: normalizedSymbol,
      })
      const normalizedOrder = adaptOrder(order)
      logBrokerDiagnostic({
        logger: this.logger,
        event: {
          event: "getOrder.completed",
          ok: true,
          symbol: normalizedOrder.symbol,
          orderId: normalizedOrder.id,
          status: normalizedOrder.status,
        },
      })
      return toResult({ data: normalizedOrder })
    } catch (error) {
      logBrokerDiagnostic({
        logger: this.logger,
        level: "error",
        event: {
          event: "getOrder.failed",
          symbol: symbol ?? null,
          orderId: orderId ?? null,
          error: { name: error?.name, code: error?.code, exchangeCode: error?.exchangeCode, message: error?.message },
        },
      })
      handleErr({
        where: "BitunixSpotBroker.getOrder()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getPrices({ symbol } = {}) {
    try {
      const normalizedSymbol = requireSymbol({
        symbol,
        operation: "getPrices()",
      })
      const response = await this.restClient.request({
        method: "GET",
        path: API.lastPrice,
        queryParams: { symbol: normalizedSymbol },
        authenticated: false,
      })
      assertDecimalString({
        value: response.data,
        field: "Bitunix Spot last price",
      })
      if (compareDecimal({
        left: response.data,
        right: "0",
      }) <= 0) {
        throw new RangeError("Bitunix Spot last price must be positive")
      }
      return toResult({
        data: {
          symbol: normalizedSymbol,
          price: response.data,
        },
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getPrices()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read one page of Bitunix Spot on-chain deposit and internal-transfer records.
   * The endpoint documents a maximum limit of 100 but no cursor or page parameter.
   *
   * @param {{id?: string, coin?: string, type?: "deposit"|"inside_transfer_in", transactionHash?: string, startTime?: number, endTime?: number, limit?: number}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getDeposits(input = {}) {
    try {
      const { body } = createDepositRequest({ input })
      const response = await this.restClient.request({
        method: "POST",
        path: API.deposits,
        body,
        stateChanging: false,
      })
      return toResult({
        data: adaptDeposits({
          value: response.data,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getDeposits()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read all Bitunix deposit addresses for one explicitly selected coin/network.
   * The endpoint is read-only and rate-limited to 10 requests per second per IP;
   * callers must avoid polling above that exchange limit.
   *
   * @param {{coin: string, network: string}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getDepositAddress(input = {}) {
    try {
      const { body } = createDepositAddressRequest({ input })
      const response = await this.restClient.request({
        method: "POST",
        path: API.depositAddress,
        body,
        authenticated: true,
        stateChanging: false,
      })
      return toResult({
        data: adaptDepositAddresses({
          value: response.data,
          coin: body.coin,
          network: body.network,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getDepositAddress()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read one exchange-native matching-order detail for a known Spot order.
   * This is not a canonical Fill: volume denomination, execution-ID uniqueness,
   * and multi-execution completeness are not established by the API contract.
   *
   * @param {{orderId: string, symbol: string}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getMatchingOrderDetails(input = {}) {
    try {
      const { body } = createMatchingOrderDetailsRequest({ input })
      const response = await this.restClient.request({
        method: "POST",
        path: API.matchingOrderDetails,
        body,
        authenticated: true,
        stateChanging: false,
      })
      return toResult({
        data: adaptMatchingOrderDetails({
          value: response.data,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getMatchingOrderDetails()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read one page of Bitunix Spot withdrawals and internal-transfer-out records.
   * The endpoint documents a maximum limit of 100 but no cursor or page parameter.
   * Recipient identifiers and contact/address fields are returned unchanged and are
   * never logged or persisted by this adapter.
   *
   * @param {{id?: string, outBizId?: string, coin?: string, type?: "withdraw"|"inside_transfer_out", transactionHash?: string, startTime?: number, endTime?: number, remark?: string, limit?: number}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getWithdrawalHistory(input = {}) {
    try {
      const { body } = createWithdrawalHistoryRequest({ input })
      const response = await this.restClient.request({
        method: "POST",
        path: API.withdrawalHistory,
        body,
        authenticated: true,
        stateChanging: false,
      })
      return toResult({
        data: adaptWithdrawalHistory({
          value: response.data,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getWithdrawalHistory()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read the documented public Bitunix Spot exchange-rate catalog.
   * This is a Bitunix-specific extension, not a Binance broker capability.
   *
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  /**
   * Submit a Bitunix Spot withdrawal from a pre-approved quick-withdrawal address.
   * The API key must have withdrawal permission. A successful response confirms
   * request acceptance, not blockchain settlement; use getWithdrawalHistory() for status.
   *
   * Requires allowLiveFundsMutations: true. No automatic retry is performed.
   *
   * @param {{coin: string, network: string, address: string, amount: string, memo?: string}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async withdraw(input = {}) {
    return executeFundsMutation({
      config: this.config,
      restClient: this.restClient,
      operation: "withdraw",
      path: API.withdraw,
      input,
      buildRequest: createWithdrawalRequest,
      normalizeResponse: ({ data }) => normalizeFundsMutationId({
        data,
        field: "withdrawId",
      }),
    })
  }

  /**
   * Request cancellation of a Bitunix Spot withdrawal.
   * The acknowledgement is not a final settlement status; query getWithdrawalHistory().
   *
   * Requires allowLiveFundsMutations: true. No automatic retry is performed.
   *
   * @param {{withdrawId: string}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async cancelWithdrawal(input = {}) {
    return executeFundsMutation({
      config: this.config,
      restClient: this.restClient,
      operation: "cancelWithdrawal",
      path: API.cancelWithdrawal,
      input,
      buildRequest: createCancelWithdrawalRequest,
      normalizeResponse: ({ data, body }) => normalizeFundsMutationAcknowledgement({
        data,
        field: "withdrawId",
        id: body.withdrawId,
      }),
    })
  }

  /**
   * Submit an internal Bitunix user-to-user transfer by UID, phone, or email.
   * UID routing preserves positive signed int64 IDs as exact JSON integer tokens without JavaScript Number rounding.
   * An optional outBizId is passed through as the exchange idempotency key.
   *
   * Requires allowLiveFundsMutations: true. No automatic retry is performed.
   *
   * @param {{
 *   coin: string,
 *   amount: string,
 *   toType: "uid"|"phone"|"email",
 *   toUid?: string|number,
 *   toPhoneCountryCode?: string,
 *   toPhoneNumber?: string,
 *   toEmail?: string,
 *   outBizId?: string,
 *   remark?: string,
 * }} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async transferInternally(input = {}) {
    return executeFundsMutation({
      config: this.config,
      restClient: this.restClient,
      operation: "transferInternally",
      path: API.insideTransfer,
      input,
      buildRequest: createInternalTransferRequest,
      normalizeResponse: ({ data }) => normalizeFundsMutationId({
        data,
        field: "insideTransferId",
      }),
    })
  }

  /**
   * Request cancellation of a Bitunix internal transfer.
   * The acknowledgement is not a final settlement status; query transfer history.
   *
   * Requires allowLiveFundsMutations: true. No automatic retry is performed.
   *
   * @param {{insideTransferId: string}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async cancelInternalTransfer(input = {}) {
    return executeFundsMutation({
      config: this.config,
      restClient: this.restClient,
      operation: "cancelInternalTransfer",
      path: API.cancelInsideTransfer,
      input,
      buildRequest: createCancelInternalTransferRequest,
      normalizeResponse: ({ data, body }) => normalizeFundsMutationAcknowledgement({
        data,
        field: "insideTransferId",
        id: body.insideTransferId,
      }),
    })
  }

  /**
   * Transfer funds between the Bitunix Spot and Futures accounts.
   *
   * Requires allowLiveFundsMutations: true. No automatic retry is performed.
   *
   * @param {{type: "spot_futures"|"futures_spot", coin: string, amount: string}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async transferFunds(input = {}) {
    return executeFundsMutation({
      config: this.config,
      restClient: this.restClient,
      operation: "transferFunds",
      path: API.fundsTransfer,
      input,
      buildRequest: createFundsTransferRequest,
      normalizeResponse: ({ data }) => normalizeFundsMutationId({
        data,
        field: "transferId",
      }),
    })
  }

  async getExchangeRates() {
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: API.exchangeRates,
        authenticated: false,
      })
      return toResult({
        data: adaptExchangeRates({
          value: response.data,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getExchangeRates()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read the documented public Bitunix Spot token and network metadata catalog.
   * Includes exchange-reported deposit/withdrawal availability and network limits;
   * it does not initiate deposits, withdrawals, or transfers.
   *
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getTokenNetworks() {
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: API.tokenNetworks,
        authenticated: false,
      })
      return toResult({
        data: adaptTokenNetworks({
          value: response.data,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getTokenNetworks()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read private user identity information bound to the configured API key.
   * Bitunix may return a null UID; identifiers are normalized to exact strings.
   *
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getUserInfo() {
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: API.userInfo,
        authenticated: true,
      })
      return toResult({
        data: adaptUserInfo({
          value: response.data,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getUserInfo()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read one signed page of Bitunix Spot tax-filing records.
   * The caller controls pagination; each query is limited to a UTC range of 365 days.
   *
   * @param {{startTime: string, endTime: string, dataTypeCodes?: string[], page?: number, pageSize?: number}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getTaxFilingHistory(input = {}) {
    try {
      const query = createTaxFilingQuery({ input })
      const response = await this.restClient.request({
        method: "POST",
        path: API.taxFiling,
        body: query.body,
        authenticated: true,
        stateChanging: false,
      })
      return toResult({
        data: adaptTaxFilingPage({
          value: response.data,
          page: query.page,
          pageSize: query.pageSize,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getTaxFilingHistory()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read one Bitunix Spot order-book snapshot. The caller must provide the
   * exchange's required precision value; its selection semantics are not
   * inferred by this adapter.
   *
   * @param {{symbol: string, precision: number}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getOrderBook(input = {}) {
    try {
      const symbol = requireSymbol({
        symbol: input.symbol,
        operation: "getOrderBook()",
      })
      if (typeof input.precision !== "number" ||
          !Number.isFinite(input.precision) ||
          input.precision < 0) {
        throw new TypeError("Bitunix Spot getOrderBook() requires a non-negative numeric precision")
      }
      const response = await this.restClient.request({
        method: "GET",
        path: API.depth,
        queryParams: {
          symbol,
          precision: input.precision,
        },
      })
      return toResult({
        data: adaptBitunixOrderBook({
          value: response.data,
          symbol,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getOrderBook()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read the current Bitunix Spot OHLC row. This is intentionally not exposed
   * as a canonical candle because the documented response has no volume.
   *
   * @param {{symbol: string, interval?: string|number}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getKlines(input = {}) {
    try {
      const symbol = requireSymbol({
        symbol: input.symbol,
        operation: "getKlines()",
      })
      const interval = normalizeBitunixKlineInterval({
        interval: input.interval,
      })
      const response = await this.restClient.request({
        method: "GET",
        path: API.kline,
        queryParams: {
          symbol,
          interval,
        },
      })
      return toResult({
        data: adaptBitunixKline({
          value: response.data,
          symbol,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getKlines()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  /**
   * Read one page of Bitunix Spot historical OHLC rows. The endpoint accepts
   * endTime in seconds and does not document startTime or cursor pagination.
   *
   * @param {{symbol: string, interval?: string|number, endTime?: number|string, limit?: number}} input
   * @returns {Promise<import("@coinzilla/utils").Result>}
   */
  async getKlineHistory(input = {}) {
    try {
      const { queryParams } = createBitunixKlineHistoryQuery({ input })
      const response = await this.restClient.request({
        method: "GET",
        path: API.klineHistory,
        queryParams,
      })
      return toResult({
        data: adaptBitunixKlineHistory({
          value: response.data,
          symbol: queryParams.symbol,
        }),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getKlineHistory()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getFills() {
    return toResult({
      errors: [unsupported({
        operation: "getFills()",
        reason: "the Spot matching-order response does not define quantity denomination, execution completeness for partial fills, or stable and unique execution identity",
      })],
    })
  }

  async getPrice(input = {}) {
    return this.getPrices(input)
  }

  async getAssets() {
    try {
      const response = await this.restClient.request({
        method: "GET",
        path: API.balances,
      })
      return toResult({
        data: adaptAssets(requireArray({
          value: response.data,
          operation: "account",
        })),
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.getAssets()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async getMyTrades() {
    const error = unsupported({
      operation: "getMyTrades()",
      reason: "the Spot API exposes matching-order lookup by orderId, not an account-wide trade-history endpoint",
    })
    return toResult({ errors: [error] })
  }

  /**
   * Place one Spot order through Bitunix's single-order REST endpoint.
   * LIMIT quantity is base-denominated; MARKET quoteQuantity is quote-denominated.
   * The provider never estimates quote quantity from a market price. A lost
   * response is OUTCOME_UNKNOWN and is never retried because Bitunix does not
   * accept a client order ID.
   *
   * @param {{symbol: string, side: "BUY"|"SELL", type: "LIMIT"|"MARKET", quantity?: string|number, quoteQuantity?: string|number, price?: string|number}} input
   */
  async createOrder(input = {}) {
    if (!this.config.allowLiveOrderMutations) {
      return unsupportedMutationResult({
        operation: "createOrder",
        reason: "live Bitunix order mutations are disabled by default; set allowLiveOrderMutations: true only after independent live-account authorization",
      })
    }
    let requestDispatched = false
    try {
      const order = createSpotOrderRequest({ input })
      requestDispatched = true
      const response = await this.restClient.request({
        method: "POST",
        path: API.placeOrder,
        body: order.body,
        authenticated: true,
        stateChanging: true,
      })
      const placementData = validateSpotOrderPlacementResponse({
        response: response.data,
        symbol: order.symbol,
        side: order.body.side,
        type: order.body.type,
        volume: order.volume,
        price: order.price,
      })
      return reconcileSpotOrderPlacement({
        restClient: this.restClient,
        symbol: order.symbol,
        placementData,
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.createOrder()",
        error,
      })
      const mutationOutcome = error?.kind === "exchange"
        ? "REJECTED"
        : getBrokerMutationOutcome({
          error,
          requestDispatched,
        })
      return toResult({
        errors: [error],
        mutationOutcome,
      })
    }
  }

  async createCanonicalOrder() {
    return unsupportedMutationResult({
      operation: "createCanonicalOrder",
      reason: "Bitunix Spot does not expose clientOrderId required for canonical order identity and idempotent recovery",
    })
  }

  /**
   * Cancel one known Spot order and verify the exchange's final order state.
   * A successful cancel acknowledgement alone is insufficient because a fill
   * may win the cancellation race; the follow-up detail read is authoritative.
   *
   * @param {{symbol: string, orderId: string|number}} input
   * @returns {Promise<import("@coinzilla/utils").Result & {mutationOutcome: string, cancellationOutcome?: string}>}
   */
  async cancelOrder({ symbol, orderId } = {}) {
    if (!this.config.allowLiveOrderMutations) {
      return {
        ...unsupportedMutationResult({
          operation: "cancelOrder",
          reason: "live Bitunix order mutations are disabled by default; set allowLiveOrderMutations: true only after independent live-account authorization",
        }),
        cancellationOutcome: "NOT_SENT",
      }
    }
    let requestDispatched = false
    let cancelAcknowledged = false
    try {
      const normalizedSymbol = requireSymbol({
        symbol,
        operation: "cancelOrder()",
      })
      const normalizedOrderId = validateOrderId({ orderId })
      requestDispatched = true
      await sendBitunixSpotCancelRequest({
        restClient: this.restClient,
        symbol: normalizedSymbol,
        orderId: normalizedOrderId,
      })
      cancelAcknowledged = true
      const normalizedOrder = await getBitunixSpotOrderDetail({
        restClient: this.restClient,
        symbol: normalizedSymbol,
        orderId: normalizedOrderId,
      })
      const isCancelled = normalizedOrder.status === "CANCELED" ||
        normalizedOrder.status === "PARTIALLY_FILLED_CANCELED"
      if (isCancelled) {
        return toResult({
          data: normalizedOrder,
          mutationOutcome: "CONFIRMED",
          cancellationOutcome: "CONFIRMED",
        })
      }
      return toResult({
        data: normalizedOrder,
        errors: [new Error(
          `Bitunix Spot cancellation was acknowledged but final order status is ${normalizedOrder.status}; reconcile order ${normalizedOrder.id} before retrying`,
        )],
        mutationOutcome: "CONFIRMED",
        cancellationOutcome: "OUTCOME_UNKNOWN",
      })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.cancelOrder()",
        error,
      })
      return createCancelOrderFailureResult({
        error,
        requestDispatched,
        cancelAcknowledged,
      })
    }
  }

  /**
   * Cancel every open order for one explicitly selected Spot symbol.
   * The API has no account-wide pending-order query, so symbol is mandatory.
   * Each cancellation is independently verified; failures never stop later
   * known orders from being processed and are returned to the caller.
   *
   * @param {{symbol: string}} input
   * @returns {Promise<import("@coinzilla/utils").Result & {mutationOutcome: string, cancellationOutcome: string}>}
   */
  async cancelAllOpenOrders({ symbol } = {}) {
    if (!this.config.allowLiveOrderMutations) {
      return {
        ...unsupportedMutationResult({
          operation: "cancelAllOpenOrders",
          reason: "live Bitunix order mutations are disabled by default; set allowLiveOrderMutations: true only after independent live-account authorization",
        }),
        cancellationOutcome: "NOT_SENT",
      }
    }
    let normalizedSymbol
    try {
      normalizedSymbol = requireSymbol({
        symbol,
        operation: "cancelAllOpenOrders()",
      })
    } catch (error) {
      return toResult({
        errors: [error],
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      })
    }

    const openOrders = await this.getOpenOrders({ symbol: normalizedSymbol })
    if (!openOrders.ok) {
      return toResult({
        errors: openOrders.errors ?? [],
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      })
    }
    if (openOrders.data.length === 0) {
      return toResult({
        data: [],
        mutationOutcome: "NOT_SENT",
        cancellationOutcome: "NOT_SENT",
      })
    }
    return cancelOpenOrdersForSymbol({
      broker: this,
      symbol: normalizedSymbol,
      orders: openOrders.data,
    })
  }

  /**
   * Deliver explicitly scoped, non-authoritative Spot observations.
   *
   * @param {{symbols: string[], trackedOrders?: Array<{symbol: string, orderId: string|number}>, intervalMs?: number, onEvent?: (message: {event: object}) => void|Promise<void>, onObservation: (message: {observation: object}) => void|Promise<void>, onStatus?: (status: object) => void}} options
   * @returns {Promise<BrokerResult<object>>}
   */
  async subscribeForUserData({
    symbols,
    trackedOrders = [],
    intervalMs = 2_000,
    onEvent,
    onObservation,
    onStatus,
  } = {}) {
    try {
      if (!this.connected) {
        throw new Error("Bitunix Spot broker must be connected before subscribing to user-data observations")
      }
      if (onEvent !== undefined && typeof onEvent !== "function") {
        throw new TypeError("Bitunix Spot onEvent must be a function when supplied")
      }
      if (typeof onObservation !== "function") {
        throw new TypeError("Bitunix Spot onObservation must be a function")
      }
      if (onStatus !== undefined && typeof onStatus !== "function") {
        throw new TypeError("Bitunix Spot onStatus must be a function when supplied")
      }
      const subscription = startBitunixUserDataObservationPolling({
        broker: this,
        symbols,
        trackedOrders,
        intervalMs,
        onObservation,
        onStatus,
      })
      return toResult({ data: subscription })
    } catch (error) {
      handleErr({
        where: "BitunixSpotBroker.subscribeForUserData()",
        error,
      })
      return toResult({ errors: [error] })
    }
  }

  async subscribeForBookTicker() {
    return toResult({
      errors: [unsupported({
        operation: "subscribeForBookTicker",
        reason: "the documented Spot WebSocket API does not define a continuous order-book subscription",
      })],
    })
  }

  async subscribeForCandles() {
    return toResult({
      errors: [unsupported({
        operation: "subscribeForCandles",
        reason: "the documented Spot WebSocket API does not define a continuous candle subscription",
      })],
    })
  }

  async getCandles() {
    const error = unsupported({
      operation: "getCandles()",
      reason: "the documented Spot kline responses provide OHLC and a start timestamp but omit volume, which the canonical candle contract requires",
    })
    return toResult({ errors: [error] })
  }

  async subscribeForPrices() {
    return toResult({
      errors: [unsupported({
        operation: "subscribeForPrices",
        reason: "the documented Spot WebSocket API exposes request/response market calls, not a continuous price subscription",
      })],
    })
  }

  async getCanonicalOrder() {
    const error = unsupported({
      operation: "getCanonicalOrder()",
      reason: "Bitunix Spot orders do not expose a clientOrderId required by the canonical order contract",
    })
    return toResult({ errors: [error] })
  }

  async getCanonicalOrderHistory() {
    const error = unsupported({
      operation: "getCanonicalOrderHistory()",
      reason: "the canonical order contract requires a clientOrderId that Bitunix Spot does not expose",
    })
    return toResult({ errors: [error] })
  }

  async getServerTime() {
    const error = unsupported({
      operation: "getServerTime()",
      reason: "no documented Spot server-time endpoint is available",
    })
    return toResult({ errors: [error] })
  }
}

function createRestClient(config) {
  return new BitunixRestClient({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    baseUrl: config.baseUrl,
    requestTimeout: config.requestTimeout,
    logger: config.logger,
  })
}
