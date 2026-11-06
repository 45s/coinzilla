import { defaultLogger as logger } from "@coinzilla/utils"
import { adaptUser } from "./user.js"
import { adaptAggTrades } from "./adapt-trades.js"

export const wsEventsMap = Object.freeze({
  executionReport: "executionReport",
  outboundAccountPosition: "outboundAccountPosition",
  aggTrade: "aggTrade",
  account: "account",
  balanceUpdate: "balanceUpdate",
  listStatus: "listStatus",
})

const EXECUTION_REPORT_EVIDENCE_FIELDS = Object.freeze({
  eventTime: "E", transactionTime: "T", symbol: "s", clientOrderId: "c",
  originalClientOrderId: "C", side: "S", orderType: "o", timeInForce: "f",
  orderQuantity: "q", orderPrice: "p", executionType: "x", orderStatus: "X",
  orderId: "i", orderListId: "g", orderCreationTime: "O", workingTime: "W",
  lastExecutedQuantity: "l", cumulativeExecutedQuantity: "z", lastExecutedPrice: "L",
  commissionAmount: "n", commissionAsset: "N", tradeId: "t", executionId: "I",
  tradeGroupId: "M", isMaker: "m", cumulativeQuoteQuantity: "Z",
  lastQuoteQuantity: "Y", quoteOrderQuantity: "Q", stopPrice: "P",
  icebergQuantity: "F", selfTradePreventionMode: "V", matchType: "k",
  working: "w", rejectReason: "r",
})
const createExecutionReportEvidence = (message) => ({
  schemaVersion: 1,
  source: "binance.spot.userData.executionReport",
  ...Object.fromEntries(Object.entries(EXECUTION_REPORT_EVIDENCE_FIELDS).flatMap(([field, key]) => {
    const value = message[key]
    if (value === undefined) return []
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) return []
    return [[field, typeof value === "string" ? value.slice(0, 256) : value]]
  })),
})
const adaptExecutedOrder = (message) => {
  const report = adaptUser.executionReport(message)
  const executedOrder = {
    id: String(report.orderId),
    symbol: report.symbol,
    type: report.orderType,
    side: report.side,
    quantity: report.quantity,
    executedQuantity: report.totalTradeQuantity,
    price: report.price,
    status: report.orderStatus,
    clientOrderId: report.newClientOrderId,
    createdAt: report.creationTime,
    updatedAt: report.eventTime,
  }

  const fill = report.executionType === "TRADE"
    ? {
        id: String(report.tradeId),
        orderId: String(report.orderId),
        symbol: report.symbol,
        side: report.side,
        price: report.priceLastTrade,
        quantity: report.lastTradeQuantity,
        quoteQuantity: report.lastQuoteTransacted,
        commissionAmount: report.commission,
        commissionAsset: report.commissionAsset,
        isMaker: report.isMaker,
        // Binance E is event publication time; T is transaction time.
        // Canonical REST myTrades fills use the transaction timestamp.
        time: report.orderTime,
      }
    : null

  return {
    eventType: report.eventType,
    executionType: report.executionType,
    // Preserve Binance execution-report identifiers separately:
    // c is the current/new client order ID; C is the original client order ID.
    // Ownership is correlated by the exchange-assigned order ID, as in Free-Roll.
    clientOrderId: report.newClientOrderId,
    originalClientOrderId: report.originalClientOrderId,
    executedOrder,
    ...(fill ? { fill } : {}),
    brokerEvidence: createExecutionReportEvidence(message),
  }
}

const adaptersMap = {
  [wsEventsMap.executionReport]: adaptExecutedOrder,
  [wsEventsMap.outboundAccountPosition]: adaptUser.outboundAccountPosition,
  [wsEventsMap.aggTrade]: adaptAggTrades,
  [wsEventsMap.account]: adaptUser.outboundAccountInfo,
  [wsEventsMap.balanceUpdate]: adaptUser.balanceUpdate,
  [wsEventsMap.listStatus]: adaptUser.listStatus,
}

export function adaptMsg(message) {
  const adapter = adaptersMap[message.e]
  if (!adapter) {
    logger.warn(`Adapter for "${message.e}" message not found`)
    return message
  }
  return adapter(message)
}
