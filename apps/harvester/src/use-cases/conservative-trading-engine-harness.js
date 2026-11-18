import { CanonicalOrder, Fill, Money, Quantity } from "@coinzilla/entities"
import { multiplyDecimal } from "@coinzilla/utils"

function createPlaceOrderHandler({
  orders,
  acknowledgedOrdersById,
  acknowledgedFillsByOrder,
  getAcknowledgedFills,
  onPlaceOrder,
  onPlaceOrderStarted,
  placeOrderGate,
  deferOrderSide,
  placeOrderThrow,
  placeOrderFailureAfterCount,
  placeOrderFailureError,
  placeOrderFailureAfterFirst,
  remainingPlaceOrderFailures,
  placeOrderCallCount,
  immediateFilledAcknowledgement,
  market,
  baseAsset,
  quoteAsset,
} = {}) {
  return async ({ order }) => {
    placeOrderCallCount.value += 1
    orders.push(order)
    onPlaceOrder?.({ order })
    onPlaceOrderStarted?.({ order })
    if (placeOrderGate && order.side === deferOrderSide) {await placeOrderGate.promise}
    if (placeOrderThrow) {throw new Error("socket closed")}
    if (placeOrderFailureAfterCount !== undefined && placeOrderCallCount.value > placeOrderFailureAfterCount) {
      return { ok: false,
        errors: [placeOrderFailureError ?? new Error("replacement rejected")] }
    }
    if (placeOrderFailureAfterFirst && placeOrderCallCount.value > 1) {
      return { ok: false,
        errors: [placeOrderFailureError ?? new Error("replacement rejected")] }
    }
    if (remainingPlaceOrderFailures.value > 0) {
      if (Number.isFinite(remainingPlaceOrderFailures.value)) {remainingPlaceOrderFailures.value -= 1}
      return { ok: false,
        errors: [placeOrderFailureError ?? new Error("broker rejected order")] }
    }
    const acknowledgedOrder = new CanonicalOrder({
      clientOrderId: order.clientOrderId,
      brokerOrderId: `broker-${order.clientOrderId}`,
      market,
      side: order.side,
      type: order.type,
      limitPrice: new Money({ amount: order.price,
        asset: quoteAsset }),
      originalQuantity: new Quantity({ amount: order.quantity,
        asset: baseAsset }),
      executedQuantity: new Quantity({
        amount: immediateFilledAcknowledgement ? order.quantity : "0",
        asset: baseAsset,
      }),
      status: immediateFilledAcknowledgement ? "FILLED" : "OPEN",
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 1,
      ...(immediateFilledAcknowledgement ? { completedAt: 2 } : {}),
    })
    if (immediateFilledAcknowledgement) {
      acknowledgedOrdersById.set(acknowledgedOrder.brokerOrderId, acknowledgedOrder)
      acknowledgedFillsByOrder.set(
        acknowledgedOrder.brokerOrderId,
        getAcknowledgedFills({ order: acknowledgedOrder }),
      )
    }
    return { ok: true,
      data: acknowledgedOrder }
  }
}

function createCancelOrderHandler({
  cancellationIds,
  canceledOrders,
  onCancelOrderStarted,
  cancelOrderGate,
  cancelThrow,
  cancelNotSent,
  cancelNotSentOnSuccess,
  cancelFailure,
  cancelExecutedQuantity,
  cancelOrderStatus,
  cancelUpdatedAt,
  market,
  baseAsset,
} = {}) {
  return async ({ order }) => {
    cancellationIds.push(order.brokerOrderId)
    onCancelOrderStarted?.({ order })
    if (cancelOrderGate) {await cancelOrderGate.promise}
    if (cancelThrow) {throw new Error("cancel socket closed")}
    if (cancelNotSent) {
      return {
        ok: false,
        cancellationOutcome: "NOT_SENT",
        errors: [new Error("user-data stream unavailable")],
      }
    }
    if (cancelNotSentOnSuccess) {
      return {
        ok: true,
        cancellationOutcome: "NOT_SENT",
        errors: [new Error("contradictory cancellation result")],
      }
    }
    if (cancelFailure) {return { ok: false,
      errors: [new Error("cancel denied")] }}
    canceledOrders.set(order.brokerOrderId, order)
    const executedQuantity = typeof cancelExecutedQuantity === "function"
      ? cancelExecutedQuantity({ order })
      : cancelExecutedQuantity
    const resolvedStatus = typeof cancelOrderStatus === "function"
      ? cancelOrderStatus({ order })
      : cancelOrderStatus
    const resolvedUpdatedAt = typeof cancelUpdatedAt === "function"
      ? cancelUpdatedAt({ order })
      : cancelUpdatedAt ?? Math.max(order.updatedAt ?? 0, 2) + 1
    return {
      ok: true,
      data: new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: order.brokerOrderId,
        market,
        side: order.side,
        type: order.type,
        limitPrice: order.limitPrice,
        originalQuantity: order.originalQuantity,
        executedQuantity: new Quantity({ amount: executedQuantity,
          asset: baseAsset }),
        status: resolvedStatus,
        createdAt: order.createdAt,
        acknowledgedAt: order.acknowledgedAt,
        updatedAt: resolvedUpdatedAt,
        completedAt: 2,
      }),
    }
  }
}

function createGetFillsHandler({
  acknowledgedFillsByOrder,
  canceledOrders,
  cancelExecutedQuantity,
  cancelWithFill,
  accountedFills,
  getTerminalFills,
  market,
  baseAsset,
  quoteAsset,
  acknowledgedFillsGate,
} = {}) {
  return async ({ orderId }) => {
    if (acknowledgedFillsByOrder.has(orderId)) {
      if (acknowledgedFillsGate) {await acknowledgedFillsGate.promise}
      const fills = acknowledgedFillsByOrder.get(orderId)
      return { ok: true,
        data: typeof fills === "function" ? fills() : fills }
    }
    const canceledOrder = canceledOrders.get(orderId)
    const executedQuantity = canceledOrder && (typeof cancelExecutedQuantity === "function"
      ? cancelExecutedQuantity({ order: canceledOrder })
      : cancelExecutedQuantity)
    const cancelFill = cancelWithFill && canceledOrder
      ? [new Fill({
        tradeId: `recovery-cancel-fill-${canceledOrder.side.toLowerCase()}-${orderId}`,
        brokerOrderId: orderId,
        clientOrderId: canceledOrder.clientOrderId,
        market,
        side: canceledOrder.side,
        price: canceledOrder.limitPrice,
        quantity: new Quantity({ amount: executedQuantity,
          asset: baseAsset }),
        quoteQuantity: new Money({
          amount: multiplyDecimal({ left: canceledOrder.limitPrice.amount,
            right: executedQuantity }),
          asset: quoteAsset,
        }),
        commissions: [],
        commissionStatus: "COMPLETE",
      })]
      : []
    return {
      ok: true,
      data: [
        ...accountedFills.filter((fill) => fill.brokerOrderId === orderId),
        ...cancelFill,
        ...getTerminalFills({ orderId }),
      ],
    }
  }
}

function createHarnessAccountSnapshot({
  baseAsset,
  quoteAsset,
  baseFreeBalance,
  quoteFreeBalance,
  quoteCashFlowBaseline,
  portfolioBaseQuantityBaseline,
  additionalTrackedBaseQuantityBaseline,
  committedQuoteBalanceBaseline,
  committedBaseBalanceBaseline,
} = {}) {
  return {
    getFreeBalance: ({ assetId }) => assetId === quoteAsset.id
      ? new Quantity({ amount: quoteFreeBalance,
        asset: quoteAsset })
      : new Quantity({ amount: baseFreeBalance,
        asset: baseAsset }),
    getQuoteCashFlowBaseline: ({ assetId }) => assetId === quoteAsset.id ? quoteCashFlowBaseline : "0",
    getPortfolioBaseQuantityBaseline: ({ assetId }) => assetId === baseAsset.id ? portfolioBaseQuantityBaseline : "0",
    getAdditionalTrackedBaseQuantityBaseline: ({ assetId }) => assetId === baseAsset.id ? additionalTrackedBaseQuantityBaseline : "0",
    getCommittedQuoteBalanceBaseline: ({ assetId }) => assetId === quoteAsset.id ? committedQuoteBalanceBaseline : "0",
    getCommittedBaseBalanceBaseline: ({ assetId }) => assetId === baseAsset.id ? committedBaseBalanceBaseline : "0",
  }
}

function createHarnessState({ placeOrderFailure, placeOrderFailureCount } = {}) {
  return {
    orders: [],
    pauses: [],
    accountedFills: [],
    accountedFillIds: new Set(),
    completedCycles: [],
    cancellationIds: [],
    canceledOrders: new Map(),
    acknowledgedFillsByOrder: new Map(),
    acknowledgedOrdersById: new Map(),
    canonicalOrdersByClientId: new Map(),
    remainingPlaceOrderFailures: { value: placeOrderFailure ? Number.POSITIVE_INFINITY : placeOrderFailureCount },
    placeOrderCallCount: { value: 0 },
  }
}

function createSymbolFiltersHandler(options = {}) {
  const {
    getSymbolFiltersOverride,
    getMarketMetadataOverride,
    suppliedMarketMetadata,
    marketMetadata,
  } = options
  return async ({ symbol }) => getSymbolFiltersOverride
    ? getSymbolFiltersOverride({ symbol })
    : {
      ok: true,
      data: getMarketMetadataOverride ? getMarketMetadataOverride() : (suppliedMarketMetadata ?? marketMetadata),
    }
}

function createCanonicalOrderLookupHandler({ canonicalOrdersByClientId } = {}) {
  return async ({ clientOrderId }) => {
    const order = canonicalOrdersByClientId.get(clientOrderId)
    return order
      ? { ok: true,
        data: order }
      : { ok: false,
        errors: [new Error("order not found by client order ID")] }
  }
}

function createCanonicalOrderHistoryHandler({ acknowledgedOrdersById } = {}) {
  return async ({ orderId }) => ({
    ok: true,
    data: acknowledgedOrdersById.has(orderId) ? [acknowledgedOrdersById.get(orderId)] : [],
  })
}

function createEmptyOpenOrdersHandler() {
  return async () => ({ ok: true,
    data: [] })
}

function createHarnessBrokerPort({ options, state } = {}) {
  return {
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
    getSymbolFilters: createSymbolFiltersHandler(options),
    placeOrder: createPlaceOrderHandler({ ...options,
      ...state }),
    cancelOrder: createCancelOrderHandler({ ...options,
      ...state }),
    getFills: createGetFillsHandler({ ...options,
      ...state }),
    getCanonicalOrder: createCanonicalOrderLookupHandler(state),
    getOpenOrders: createEmptyOpenOrdersHandler(),
    getCanonicalOrderHistory: createCanonicalOrderHistoryHandler(state),
  }
}

export function createHarnessBroker(options = {}) {
  const state = createHarnessState(options)
  return {
    ...state,
    broker: createHarnessBrokerPort({ options,
      state }),
    accountSnapshot: createHarnessAccountSnapshot(options),
  }
}
