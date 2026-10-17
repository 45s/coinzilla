import { defaultLogger as logger } from '../../../../_utils/index.js'
import { adaptUser } from './user.js'
import { adaptAggTrades } from './adapt-trades.js'
import { ExecutedOrder } from '../../../../orders/index.js'

export const wsEventsMap = {
  executionReport: 'executionReport',
  outboundAccountPosition: 'outboundAccountPosition',
  aggTrade: 'aggTrade',
  account: 'account',
  balanceUpdate: 'balanceUpdate',
  listStatus: 'listStatus',
}

const adaptExecutedOrder = (m) => {
  const {
    eventType,
    symbol,
    side,
    quantity,
    price,
    orderId,
    commission,
    commissionAsset,
    orderType: type,
    orderStatus: status,
  } = adaptUser.executionReport(m)

  const executedOrder = new ExecutedOrder({
    symbol,
    type,
    side,
    quantity: +quantity,
    price: +price,
    id: orderId.toString(),
    status,
    commission: +commission,
    commissionAsset,
  }).value
  return {
    eventType,
    executedOrder,
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

export function adaptMsg(m) {
  const adapter = adaptersMap[m.e]
  if (!adapter) {
    logger.warn(`Adapter for "${m.e}" message not found`)
    return m
  }
  return adapter(m)
}
