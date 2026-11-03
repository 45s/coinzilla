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
        time: report.eventTime,
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
