import { Fill } from "@coinzilla/entities"
import { createOrderHistoryRecord } from "../../../domain/order-history/order-history-record.js"
import { HISTORY_SOURCE } from "../constants.js"

export function createSourceEvent({ id, name, observedAt }) {
  return {
    id,
    name,
    source: HISTORY_SOURCE,
    timestamp: observedAt,
  }
}

export function mapCanonicalOrder({ order, providerIdentity, environment, observedAt }) {
  const updatedAt = order.updatedAt ?? order.createdAt ?? 0
  const eventId = [
    "exchange-history-order",
    providerIdentity.providerInstanceId,
    order.market.symbol,
    order.brokerOrderId,
    updatedAt,
    order.status,
    order.executedQuantity.amount,
  ].join(":")
  return createOrderHistoryRecord({
    order: {
      providerInstanceId: providerIdentity.providerInstanceId,
      providerType: providerIdentity.providerType,
      accountId: providerIdentity.accountId,
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      market: order.market,
      symbol: order.market.symbol,
      side: order.side,
      type: order.type,
      price: order.limitPrice?.amount,
      originalQuantity: order.originalQuantity.amount,
      executedQuantity: order.executedQuantity.amount,
      remainingQuantity: order.remainingQuantity.amount,
      status: order.status,
      createdAt: order.createdAt,
      acknowledgedAt: order.acknowledgedAt,
      updatedAt: order.updatedAt,
      completedAt: order.completedAt,
    },
    sourceEvent: createSourceEvent({
      id: eventId,
      name: "exchange.history_order_observed",
      observedAt,
    }),
    environment,
    includeUnfilled: true,
  })
}

export function validateCanonicalOrderProviderIdentity({ order, providerIdentity, symbol }) {
  if (order.providerInstanceId === undefined) {
    return
  }
  if (
    order.providerInstanceId !== providerIdentity.providerInstanceId ||
    order.providerType !== providerIdentity.providerType ||
    order.accountId !== providerIdentity.accountId
  ) {
    throw new Error(`Binance order provider identity conflicts for ${symbol}:${order.brokerOrderId}`)
  }
}

export function createOrderIdentityKey({ order }) {
  return `${order.market.id}:${order.brokerOrderId}`
}

export function createEnrichedFill({ fill, clientOrderId, providerIdentity }) {
  const hasProviderIdentity = [
    fill.providerInstanceId,
    fill.providerType,
    fill.accountId,
  ].some((value) => value !== undefined)
  if (
    hasProviderIdentity &&
    (fill.providerInstanceId !== providerIdentity.providerInstanceId ||
      fill.providerType !== providerIdentity.providerType ||
      fill.accountId !== providerIdentity.accountId)
  ) {
    throw new Error(`Binance fill provider identity conflicts for ${fill.market.symbol}:${fill.tradeId}`)
  }
  if (
    fill.clientOrderId !== undefined &&
    clientOrderId !== undefined &&
    fill.clientOrderId !== clientOrderId
  ) {
    throw new Error(`Binance fill client-order identity conflicts for ${fill.market.symbol}:${fill.tradeId}`)
  }
  return new Fill({
    tradeId: fill.tradeId,
    brokerOrderId: fill.brokerOrderId,
    clientOrderId: fill.clientOrderId ?? clientOrderId,
    ...providerIdentity,
    market: fill.market,
    side: fill.side,
    price: fill.price,
    quantity: fill.quantity,
    quoteQuantity: fill.quoteQuantity,
    liquidityRole: fill.liquidityRole,
    executedAt: fill.executedAt,
    commissions: fill.commissions,
    commissionStatus: fill.commissionStatus,
  })
}

export function mapCanonicalFill({ fill }) {
  return {
    fillId: fill.id,
    tradeId: fill.tradeId,
    brokerOrderId: fill.brokerOrderId,
    clientOrderId: fill.clientOrderId,
    providerInstanceId: fill.providerInstanceId,
    providerType: fill.providerType,
    accountId: fill.accountId,
    symbol: fill.market.symbol,
    side: fill.side,
    price: fill.price.amount,
    quantity: fill.quantity.amount,
    quoteQuantity: fill.quoteQuantity.amount,
    liquidityRole: fill.liquidityRole,
    commissionStatus: fill.commissionStatus,
    executedAt: fill.executedAt,
    commissions: fill.commissions.map((commission) => ({
      amount: commission.amount.amount,
      assetId: commission.amount.asset.id,
      asset: commission.amount.asset.code,
      quoteValue: commission.quoteValue
        ? {
            amount: commission.quoteValue.amount,
            assetId: commission.quoteValue.asset.id,
            asset: commission.quoteValue.asset.code,
          }
        : null,
    })),
  }
}
