import { handleErr, toResult } from "@coinzilla/utils"

import { CoreBroker } from "../../../broker.core.js"
import { BitunixRestClient } from "../api/rest-client.js"
import { createBitunixFuturesBrokerCapabilities } from "./capabilities.js"
import {
  adaptFuturesAccounts,
  adaptFuturesCopyTradingAssets,
  adaptFuturesDepth,
  adaptFuturesFundingHistory,
  adaptFuturesFundingRates,
  adaptFuturesHistoryOrders,
  adaptFuturesHistoryPositions,
  adaptFuturesHistoryTrades,
  adaptFuturesHistoryTpSlOrders,
  adaptFuturesKlines,
  adaptFuturesLeverageMarginMode,
  adaptFuturesOrderDetail,
  adaptFuturesPendingOrders,
  adaptFuturesPendingPositions,
  adaptFuturesPendingTpSlOrders,
  adaptFuturesPositionMode,
  adaptFuturesPositionTiers,
  adaptFuturesTickers,
  adaptFuturesTradingPairs,
  adaptFuturesTradingSettings,
} from "./adapters.js"
import { BitunixFuturesConfig } from "./config.js"
import {
  createAccountQuery,
  createDepthQuery,
  createFundingHistoryQuery,
  createFundingRateQuery,
  createHistoryOrdersQuery,
  createHistoryPositionsQuery,
  createHistoryTradesQuery,
  createHistoryTpSlQuery,
  createKlinesQuery,
  createLeverageMarginModeQuery,
  createOrderDetailQuery,
  createPendingOrdersQuery,
  createPendingPositionsQuery,
  createPendingTpSlQuery,
  createPositionTiersQuery,
  createTickersQuery,
  createTradingPairsQuery,
  createTradingSettingsQuery,
} from "./requests.js"

const FUTURES_ENDPOINTS = Object.freeze({
  tradingPairs: "/api/v1/futures/market/trading_pairs",
  tickers: "/api/v1/futures/market/tickers",
  depth: "/api/v1/futures/market/depth",
  kline: "/api/v1/futures/market/kline",
  fundingRate: "/api/v1/futures/market/funding_rate",
  fundingRates: "/api/v1/futures/market/funding_rate/batch",
  fundingHistory: "/api/v1/futures/market/get_funding_rate_history",
  positionTiers: "/api/v1/futures/position/get_position_tiers",
  account: "/api/v1/futures/account",
  tradingSettings: "/api/v1/futures/account/trading_settings",
  leverageMarginMode: "/api/v1/futures/account/get_leverage_margin_mode",
  positionMode: "/api/v1/futures/account/position_mode",
  pendingPositions: "/api/v1/futures/position/get_pending_positions",
  historyPositions: "/api/v1/futures/position/get_history_positions",
  pendingOrders: "/api/v1/futures/trade/get_pending_orders",
  historyOrders: "/api/v1/futures/trade/get_history_orders",
  orderDetail: "/api/v1/futures/trade/get_order_detail",
  historyTrades: "/api/v1/futures/trade/get_history_trades",
  pendingTpSlOrders: "/api/v1/futures/tpsl/get_pending_orders",
  historyTpSlOrders: "/api/v1/futures/tpsl/get_history_orders",
  copyTradingAssets: "/api/v1/cp/asset/query",
})

/**
 * Product-specific Bitunix Futures broker.
 *
 * It shares the exchange-neutral CoreBroker base and BrokerCapabilities model,
 * but keeps Futures-only positions, funding, leverage, margin and TP/SL methods
 * out of the Spot adapter and generic Broker contract.
 */
export class BitunixFuturesBroker extends CoreBroker {
  /**
   * @param {{
   *   config?: BitunixFuturesConfig | object,
   *   restClient?: BitunixRestClient,
   *   webSocketClient?: object,
   *   logger?: Console,
   *   now?: () => number
   * }} [options]
   */
  constructor({
    config = {},
    restClient,
    webSocketClient,
    logger = console,
    now = Date.now,
  } = {}) {
    const normalizedConfig = config instanceof BitunixFuturesConfig
      ? config
      : new BitunixFuturesConfig(config)
    super(normalizedConfig)

    if (typeof now !== "function") {
      throw new TypeError("Bitunix Futures clock dependency must be a function")
    }

    this.config = normalizedConfig
    this.restClient = restClient || new BitunixRestClient({
      apiKey: normalizedConfig.apiKey,
      apiSecret: normalizedConfig.apiSecret,
      baseUrl: normalizedConfig.baseUrl,
      language: normalizedConfig.language,
      requestTimeout: normalizedConfig.requestTimeout,
    })
    this.webSocketClient = webSocketClient
    this.logger = logger
    this.now = now
    this.capabilities = createBitunixFuturesBrokerCapabilities({
      allowLiveOrderMutations: normalizedConfig.allowLiveOrderMutations,
      allowLivePositionMutations: normalizedConfig.allowLivePositionMutations,
      allowLiveAccountMutations: normalizedConfig.allowLiveAccountMutations,
      allowLiveFundsMutations: normalizedConfig.allowLiveFundsMutations,
    })
  }

  async #read({ path, queryFactory, authenticated, adapter }) {
    try {
      const queryParams = queryFactory ? queryFactory() : undefined
      const response = await this.restClient.request({
        method: "GET",
        path,
        queryParams,
        authenticated,
        stateChanging: false,
      })
      return toResult({ data: adapter(response.data) })
    } catch (error) {
      return toResult({ errors: [handleErr(error)] })
    }
  }

  /**
   * Read the official Futures contract catalog.
   *
   * @param {{symbols?: string[] | string}} [input]
   * @returns {Promise<object>}
   */
  getTradingPairs(input = {}) {
    return this.#read({
      path: FUTURES_ENDPOINTS.tradingPairs,
      queryFactory: () => createTradingPairsQuery(input),
      authenticated: false,
      adapter: adaptFuturesTradingPairs,
    })
  }

  /**
   * Read current Futures tickers.
   *
   * @param {{symbols?: string[] | string}} [input]
   * @returns {Promise<object>}
   */
  getTickers(input = {}) {
    return this.#read({
      path: FUTURES_ENDPOINTS.tickers,
      queryFactory: () => createTickersQuery(input),
      authenticated: false,
      adapter: adaptFuturesTickers,
    })
  }

  /**
   * Read a one-shot Futures order book.
   *
   * @param {{symbol: string, limit?: string | number}} input
   * @returns {Promise<object>}
   */
  getDepth(input) {
    return this.#read({
      path: FUTURES_ENDPOINTS.depth,
      queryFactory: () => createDepthQuery(input),
      authenticated: false,
      adapter: adaptFuturesDepth,
    })
  }

  /**
   * Read Futures OHLCV candles.
   *
   * @param {{symbol: string, interval: string, endTime?: string | number, limit?: number, type?: "LAST_PRICE" | "MARK_PRICE"}} input
   * @returns {Promise<object>}
   */
  getKlines(input) {
    return this.#read({
      path: FUTURES_ENDPOINTS.kline,
      queryFactory: () => createKlinesQuery(input),
      authenticated: false,
      adapter: adaptFuturesKlines,
    })
  }

  /**
   * Read the current funding rate, mark price and index price for one symbol.
   *
   * @param {{symbol: string}} input
   * @returns {Promise<object>}
   */
  getFundingRate(input) {
    return this.#read({
      path: FUTURES_ENDPOINTS.fundingRate,
      queryFactory: () => createFundingRateQuery(input),
      authenticated: false,
      adapter: adaptFuturesFundingRates,
    })
  }

  /**
   * Read current funding rates for all supported Futures symbols.
   *
   * @returns {Promise<object>}
   */
  getFundingRates() {
    return this.#read({
      path: FUTURES_ENDPOINTS.fundingRates,
      authenticated: false,
      adapter: adaptFuturesFundingRates,
    })
  }

  /**
   * Read historical funding settlements for one Futures symbol.
   *
   * @param {{symbol: string, startTime?: string | number, endTime?: string | number, limit?: number}} input
   * @returns {Promise<object>}
   */
  getFundingRateHistory(input) {
    return this.#read({
      path: FUTURES_ENDPOINTS.fundingHistory,
      queryFactory: () => createFundingHistoryQuery(input),
      authenticated: false,
      adapter: adaptFuturesFundingHistory,
    })
  }

  /**
   * Read the official leverage and maintenance-margin tiers for a symbol.
   *
   * @param {{symbol: string}} input
   * @returns {Promise<object>}
   */
  getPositionTiers(input) {
    return this.#read({
      path: FUTURES_ENDPOINTS.positionTiers,
      queryFactory: () => createPositionTiersQuery(input),
      authenticated: false,
      adapter: adaptFuturesPositionTiers,
    })
  }

  /**
   * Read one Futures margin-coin account.
   *
   * @param {{marginCoin: string}} input
   * @returns {Promise<object>}
   */
  getAccount(input) {
    return this.#read({
      path: FUTURES_ENDPOINTS.account,
      queryFactory: () => createAccountQuery(input),
      authenticated: true,
      adapter: adaptFuturesAccounts,
    })
  }

  /**
   * Read trading settings for all or selected Futures symbols.
   *
   * @param {{symbols?: string[] | string}} [input]
   * @returns {Promise<object>}
   */
  getTradingSettings(input = {}) {
    return this.#read({
      path: FUTURES_ENDPOINTS.tradingSettings,
      queryFactory: () => createTradingSettingsQuery(input),
      authenticated: true,
      adapter: adaptFuturesTradingSettings,
    })
  }

  /**
   * Read leverage and margin mode for one symbol and margin coin.
   *
   * @param {{symbol: string, marginCoin: string}} input
   * @returns {Promise<object>}
   */
  getLeverageMarginMode(input) {
    return this.#read({
      path: FUTURES_ENDPOINTS.leverageMarginMode,
      queryFactory: () => createLeverageMarginModeQuery(input),
      authenticated: true,
      adapter: adaptFuturesLeverageMarginMode,
    })
  }

  /**
   * Read the account-wide Futures position mode.
   *
   * @returns {Promise<object>}
   */
  getPositionMode() {
    return this.#read({
      path: FUTURES_ENDPOINTS.positionMode,
      authenticated: true,
      adapter: adaptFuturesPositionMode,
    })
  }

  /**
   * Read currently open Futures positions.
   *
   * @param {{symbol?: string, positionId?: string, subAccountId?: string | number, includeSubAccounts?: boolean}} [input]
   * @returns {Promise<object>}
   */
  getPendingPositions(input = {}) {
    return this.#read({
      path: FUTURES_ENDPOINTS.pendingPositions,
      queryFactory: () => createPendingPositionsQuery(input),
      authenticated: true,
      adapter: adaptFuturesPendingPositions,
    })
  }

  /**
   * Read one page of historical Futures positions.
   *
   * @param {{symbol?: string, positionId?: string, startTime?: string | number, endTime?: string | number, skip?: string | number, limit?: number, subAccountId?: string | number}} [input]
   * @returns {Promise<object>}
   */
  getHistoryPositions(input = {}) {
    return this.#read({
      path: FUTURES_ENDPOINTS.historyPositions,
      queryFactory: () => createHistoryPositionsQuery(input),
      authenticated: true,
      adapter: adaptFuturesHistoryPositions,
    })
  }

  /**
   * Read one page of pending Futures orders.
   *
   * @param {{symbol?: string, orderId?: string, clientId?: string, status?: string, startTime?: string | number, endTime?: string | number, skip?: string | number, limit?: number}} [input]
   * @returns {Promise<object>}
   */
  getPendingOrders(input = {}) {
    return this.#read({
      path: FUTURES_ENDPOINTS.pendingOrders,
      queryFactory: () => createPendingOrdersQuery(input),
      authenticated: true,
      adapter: adaptFuturesPendingOrders,
    })
  }

  /**
   * Read one page of historical Futures orders.
   *
   * Canceled-order history is limited by the official API to the last 3 days;
   * non-canceled history is limited to the last 90 days.
   *
   * @param {{symbol?: string, orderId?: string, clientId?: string, status?: string, type?: string, startTime?: string | number, endTime?: string | number, skip?: string | number, limit?: number, queryCanceled?: boolean, subAccountId?: string | number}} [input]
   * @returns {Promise<object>}
   */
  getHistoryOrders(input = {}) {
    return this.#read({
      path: FUTURES_ENDPOINTS.historyOrders,
      queryFactory: () => createHistoryOrdersQuery(input, { now: this.now() }),
      authenticated: true,
      adapter: adaptFuturesHistoryOrders,
    })
  }

  /**
   * Read one Futures order by exchange orderId or caller-supplied clientId.
   *
   * @param {{orderId?: string, clientId?: string}} input
   * @returns {Promise<object>}
   */
  getOrderDetail(input) {
    return this.#read({
      path: FUTURES_ENDPOINTS.orderDetail,
      queryFactory: () => createOrderDetailQuery(input),
      authenticated: true,
      adapter: adaptFuturesOrderDetail,
    })
  }

  /**
   * Read one page of Futures execution/trade history.
   *
   * @param {{symbol?: string, orderId?: string, positionId?: string, startTime?: string | number, endTime?: string | number, skip?: string | number, limit?: number}} [input]
   * @returns {Promise<object>}
   */
  getHistoryTrades(input = {}) {
    return this.#read({
      path: FUTURES_ENDPOINTS.historyTrades,
      queryFactory: () => createHistoryTradesQuery(input),
      authenticated: true,
      adapter: adaptFuturesHistoryTrades,
    })
  }

  /**
   * Read one page of pending Futures TP/SL orders.
   *
   * @param {{symbol?: string, positionId?: string, side?: number, positionMode?: number, skip?: string | number, limit?: number}} [input]
   * @returns {Promise<object>}
   */
  getPendingTpSlOrders(input = {}) {
    return this.#read({
      path: FUTURES_ENDPOINTS.pendingTpSlOrders,
      queryFactory: () => createPendingTpSlQuery(input),
      authenticated: true,
      adapter: adaptFuturesPendingTpSlOrders,
    })
  }

  /**
   * Read one page of historical Futures TP/SL orders.
   *
   * The official response table documents a paginated orderList, while its
   * example shows an array. The adapter accepts either documented shape.
   *
   * @param {{symbol?: string, side?: number, positionMode?: number, startTime?: string | number, endTime?: string | number, skip?: string | number, limit?: number}} [input]
   * @returns {Promise<object>}
   */
  getHistoryTpSlOrders(input = {}) {
    return this.#read({
      path: FUTURES_ENDPOINTS.historyTpSlOrders,
      queryFactory: () => createHistoryTpSlQuery(input),
      authenticated: true,
      adapter: adaptFuturesHistoryTpSlOrders,
    })
  }

  /**
   * Read Futures copy-trading asset availability.
   *
   * @param {{assetType?: "SPOT" | "FUTURES"}} [input]
   * @returns {Promise<object>}
   */
  getCopyTradingAssets() {
    return this.#read({
      path: FUTURES_ENDPOINTS.copyTradingAssets,
      authenticated: true,
      adapter: adaptFuturesCopyTradingAssets,
    })
  }

  /**
   * Generic broker order reads map to the Futures REST order endpoints.
   *
   * @param {object} input
   * @returns {Promise<object>}
   */
  getOpenOrders(input = {}) {
    return this.getPendingOrders(input)
  }

  /**
   * @param {object} input
   * @returns {Promise<object>}
   */
  getOrderHistory(input = {}) {
    return this.getHistoryOrders(input)
  }

  /**
   * @param {object} input
   * @returns {Promise<object>}
   */
  getOrder(input) {
    return this.getOrderDetail(input)
  }

  /**
   * @param {object} input
   * @returns {Promise<object>}
   */
  getMyTrades(input = {}) {
    return this.getHistoryTrades(input)
  }

  /**
   * @param {object} input
   * @returns {Promise<object>}
   */
  getFills(input = {}) {
    return this.getHistoryTrades(input)
  }

  /**
   * @param {object} input
   * @returns {Promise<object>}
   */
  getExchangeMarkets(input = {}) {
    return this.getTradingPairs(input)
  }

  /**
   * @param {{symbol: string}} input
   * @returns {Promise<object>}
   */
  getSymbolFilters({ symbol }) {
    return this.getTradingPairs({ symbols: [symbol] })
  }

  /**
   * @param {object} input
   * @returns {Promise<object>}
   */
  getPrices(input = {}) {
    return this.getTickers(input)
  }

  /**
   * @param {object} input
   * @returns {Promise<object>}
   */
  getOrderBook(input) {
    return this.getDepth(input)
  }

  /**
   * @param {object} input
   * @returns {Promise<object>}
   */
  getCandles(input) {
    return this.getKlines(input)
  }

  /**
   * @param {object} input
   * @returns {Promise<object>}
   */
  getBalances(input) {
    return this.getAccount(input)
  }

  /**
   * @param {object} input
   * @returns {Promise<object>}
   */
  getAssets(input) {
    return this.getAccount(input)
  }
}
