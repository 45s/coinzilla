import { CanonicalOrder, Fill } from "@coinzilla/entities"
import { assertProviderIdentityMatches, hasProviderIdentity } from "../domain/orders/provider-provenance.js"
import { toResult } from "@coinzilla/utils"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import {
  mapExecutionInvalidFillData,
  mapExecutionAccountingFailedData,
  mapFillAppliedData,
  mapDuplicateFillData,
} from "../application/events/lifecycle-event-dtos.js"
import { publishLifecycleEvent } from "../application/events/publish-lifecycle-event.js"
import { makeReconcileTerminalOrderFills } from "./reconcile-terminal-order-fills.js"
import { failureResult } from "./recovery-failure.js"
import { createUserDataEventTransition } from "./create-user-data-event-transition.js"


function resolveRegisteredOrder({ state, order }) {
  if (!(order instanceof CanonicalOrder)) {
    return order
  }
  return state.registry?.getOrder?.({
    clientOrderId: order.clientOrderId,
  }) ?? order
}

function findRegisteredOrderByBrokerId({ state, brokerOrderId }) {
  return state.registry?.getOrderByBrokerOrderId?.({ brokerOrderId }) ??
    state.registry?.orders?.find((order) => order.brokerOrderId === brokerOrderId)
}

function createProviderAttributedFillHistoryBroker({ broker, state, ordersByBrokerId }) {
  return {
    ...broker,
    getFills: async ({ symbol, orderId }) => {
      const result = await broker.getFills({
        symbol,
        orderId,
      })
      if (result?.ok !== true || !Array.isArray(result.data)) {
        return result
      }
      const order = ordersByBrokerId.get(orderId) ?? findRegisteredOrderByBrokerId({
        state,
        brokerOrderId: orderId,
      })
      if (!order) {
        return result
      }
      return {
        ...result,
        data: result.data.map((fill) => attachOrderProviderIdentity({
          order,
          fill,
        })),
      }
    },
  }
}

function isRecoverySellerTerminalSell({ ownership, order } = {}) {
  return ownership?.strategyId === StrategyId.RECOVERY_SELLER && order?.side === "SELL"
}

async function failRecoverySellerTerminalReconciliation({
  pause,
  order,
  reason,
  error,
} = {}) {
  await pause({
    symbol: order.market.symbol,
    reason,
    error,
  })
  return toResult({ error })
}

async function reconcileRecoverySellerTerminalSell({
  order,
  canonicalFills,
  pause,
  reconcileRecoverySellerMixedSell,
} = {}) {
  if (typeof reconcileRecoverySellerMixedSell !== "function") {
    return failRecoverySellerTerminalReconciliation({
      pause,
      order,
      reason: "RS_TERMINAL_MIXED_SELL_RECONCILIATION_UNAVAILABLE",
      error: new Error("Recovery Seller terminal SELL requires the mixed-SELL accounting workflow"),
    })
  }
  const result = await reconcileRecoverySellerMixedSell({
    order,
    canonicalFills,
  })
  if (result?.ok === true) {
    return result
  }
  await pause({
    symbol: order.market.symbol,
    reason: "RS_TERMINAL_MIXED_SELL_RECONCILIATION_FAILED",
    error: result?.errors?.[0],
  })
  return result ?? toResult({
    error: new Error("Recovery Seller terminal mixed-SELL reconciliation failed"),
  })
}

function createRecoverySellerTerminalOrderReconciler({
  state,
  pause,
  reconcileRecoverySellerMixedSell,
} = {}) {
  return async ({ order, canonicalFills } = {}) => {
    const ownership = state.registry?.getOwnership?.({
      clientOrderId: order?.clientOrderId,
      brokerOrderId: order?.brokerOrderId,
    })
    if (!isRecoverySellerTerminalSell({ ownership, order })) {
      return toResult({
        data: {
          skipped: true,
        },
      })
    }
    const result = await reconcileRecoverySellerTerminalSell({
      order,
      canonicalFills,
      pause,
      reconcileRecoverySellerMixedSell,
    })
    if (result?.ok === true) {
      state.reconciledTerminalOrderClientIds.add(order.clientOrderId)
    }
    return result
  }
}

function createReconcileTerminalOrderFillsTransition({
  broker,
  state,
  pause,
  processExecutionFillTransition,
  reconcileRecoverySellerMixedSell,
}) {
  const ordersByBrokerId = new Map()
  const attributedBroker = createProviderAttributedFillHistoryBroker({
    broker,
    state,
    ordersByBrokerId,
  })
  const onTerminalOrderReconciled = createRecoverySellerTerminalOrderReconciler({
    state,
    pause,
    reconcileRecoverySellerMixedSell,
  })
  const reconcile = makeReconcileTerminalOrderFills({
    broker: attributedBroker,
    processedFillsByOrder: state.processedFillsByOrder,
    pause,
    processExecutionFillTransition,
    onTerminalOrderReconciled,
  })
  return ({ order, eventFill } = {}) => {
    const registeredOrder = resolveRegisteredOrder({
      state,
      order,
    })
    if (!(registeredOrder instanceof CanonicalOrder)) {
      return reconcile({
        order: registeredOrder,
        eventFill,
      })
    }
    if (typeof registeredOrder.brokerOrderId === "string") {
      ordersByBrokerId.set(registeredOrder.brokerOrderId, registeredOrder)
    }
    const attributedEventFill = eventFill === undefined
      ? undefined
      : attachOrderProviderIdentity({
          order: registeredOrder,
          fill: eventFill,
        })
    return reconcile({
      order: registeredOrder,
      eventFill: attributedEventFill,
    })
  }
}
function createProcessExecutionFillTransition({
  state,
  eventPublisher,
  updateTradingAccounting,
  updateRecoverySellerAccounting,
  recordBuyExecutionFill,
  recordSellExecutionFill,
  pause,
  requireProviderProvenance,
}) {
  const dependencies = {
    state,
    eventPublisher,
    updateTradingAccounting,
    updateRecoverySellerAccounting,
    recordBuyExecutionFill,
    recordSellExecutionFill,
    pause,
    requireProviderProvenance,
  }
  return (options = {}) => processExecutionFill({
    dependencies,
    ...options,
  })
}

function createWorkflowUserDataEventTransition({
  state,
  logger,
  eventPublisher,
  pairs,
  pause,
  resolveRecoveryManagedCancellation,
  cancelAndReconcileRecoverySells,
  evaluateLatestTransition,
  getReconciledBuyExecutionPrice,
  assertReconciledSellExecution,
  completeRecoveryCycle,
  publishRecoveryCycleNotCompleted,
  isStopping,
  onUnownedExternalOrderObserved,
  processExecutionFillTransition,
  reconcileTerminalOrderFills,
  reconcileRecoverySellerMixedSell,
}) {
  return createUserDataEventTransition({
    state,
    logger,
    eventPublisher,
    pairs,
    pause,
    resolveRecoveryManagedCancellation,
    cancelAndReconcileRecoverySells,
    evaluateLatestTransition,
    getReconciledBuyExecutionPrice,
    assertReconciledSellExecution,
    completeRecoveryCycle,
    publishRecoveryCycleNotCompleted,
    isStopping,
    onUnownedExternalOrderObserved,
    processExecutionFillTransition,
    reconcileTerminalOrderFills,
    reconcileRecoverySellerMixedSell,
  })
}

function resolveProviderProvenanceRequirement({
  override,
  updateTradingAccounting,
  broker,
}) {
  return override ??
    (updateTradingAccounting?.requiresProviderProvenance === true || hasProviderIdentity({ value: broker }))
}

export function makeOrderEventWorkflow(options = {}) {
  const {
    state,
    broker,
    eventPublisher,
    updateTradingAccounting,
    updateRecoverySellerAccounting,
    recordBuyExecutionFill,
    recordSellExecutionFill,
    pause,
    requireProviderProvenance: requireProviderProvenanceOverride,
    reconcileRecoverySellerMixedSell,
  } = options
  const requireProviderProvenance = resolveProviderProvenanceRequirement({
    override: requireProviderProvenanceOverride,
    updateTradingAccounting,
    broker,
  })
  const processExecutionFillTransition = createProcessExecutionFillTransition({
    state,
    eventPublisher,
    updateTradingAccounting,
    updateRecoverySellerAccounting,
    recordBuyExecutionFill,
    recordSellExecutionFill,
    pause,
    requireProviderProvenance,
  })
  const reconcileTerminalOrderFills = createReconcileTerminalOrderFillsTransition({
    broker,
    state,
    pause,
    processExecutionFillTransition,
    reconcileRecoverySellerMixedSell,
  })
  const processUserDataEventTransition = createWorkflowUserDataEventTransition({
    ...options,
    processExecutionFillTransition,
    reconcileTerminalOrderFills,
  })

  return Object.freeze({
    processExecutionFillTransition,
    reconcileTerminalOrderFills,
    processUserDataEventTransition,
  })
}

function publishInvalidExecutionFill({ eventPublisher, order, fill, reason, error }) {
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.EXECUTION_INVALID_FILL,
    dataResult: mapExecutionInvalidFillData({
      order,
      fill,
      reason,
      error,
    }),
  })
}

function getProviderAttributionFailure({
    order,
    fill,
  }) {
  if (!hasProviderIdentity({ value: order })) {
    return {
      error: new Error("Execution fill cannot be attributed to a provider instance: legacy order provenance is missing"),
      stage: "FILL_PROVIDER_PROVENANCE_MISSING",
    }
  }
  const matches = fill.providerInstanceId === order.providerInstanceId &&
    fill.providerType === order.providerType &&
    fill.accountId === order.accountId
  return matches ? null : {
    error: new Error("Canonical Fill provider identity does not match its registered order"),
    stage: "FILL_ORDER_IDENTITY",
  }
}

function validateMissingExecutionFill({
    order,
    fill,
    eventPublisher,
  }) {
  if (fill instanceof Fill) {
    return null
  }
  const error = new TypeError("TRADE event requires a canonical Fill")
  publishInvalidExecutionFill({
    eventPublisher,
    order,
    reason: "MISSING_FILL",
    error,
  })
  return {
    ok: false,
    result: failureResult({
      error,
      category: "REST_RECONCILIATION",
      stage: "STREAM_FILL_MISSING",
      retryable: true,
    }),
  }
}

function executionFillMatchesOrder({
    order,
    fill,
  }) {
  return fill.market.id === order.market.id &&
    fill.side === order.side &&
    fill.brokerOrderId === order.brokerOrderId &&
    (fill.clientOrderId === undefined || fill.clientOrderId === order.clientOrderId)
}

function resolveExecutionFillProviderFailure({
  order,
  fill,
  requireProviderProvenance,
}) {
  const fillHasProviderIdentity = hasProviderIdentity({ value: fill }) ||
    ["providerInstanceId", "providerType", "accountId"].some((field) => fill[field] !== undefined)
  if (!requireProviderProvenance &&
      !hasProviderIdentity({ value: order }) &&
      !fillHasProviderIdentity) {
    return null
  }
  return getProviderAttributionFailure({
    order,
    fill,
  })
}

function validateExecutionFill({ order, fill, eventPublisher, requireProviderProvenance }) {
  const missingFill = validateMissingExecutionFill({
    order,
    fill,
    eventPublisher,
  })
  if (missingFill) {
    return missingFill
  }
  if (!(order instanceof CanonicalOrder)) {
    return {
      ok: false,
      result: failureResult({
        error: new TypeError("Execution fill requires its registered canonical order"),
        category: "OWNERSHIP_INTEGRITY",
        stage: "FILL_ORDER_REGISTRY",
        retryable: false,
      }),
    }
  }
  const providerFailure = resolveExecutionFillProviderFailure({
    order,
    fill,
    requireProviderProvenance,
  })
  const identityMatches = executionFillMatchesOrder({
    order,
    fill,
  })
  if (providerFailure || !identityMatches) {
    const failure = providerFailure ?? {
      error: new Error("Canonical Fill identity does not match its registered order"),
      stage: "FILL_ORDER_IDENTITY",
    }
    publishInvalidExecutionFill({
      eventPublisher,
      order,
      fill,
      reason: "IDENTITY_MISMATCH",
      error: failure.error,
    })
    return {
      ok: false,
      error: failure.error,
      symbol: order.market.symbol,
      failure: {
        category: "OWNERSHIP_INTEGRITY",
        stage: failure.stage,
        retryable: false,
      },
    }
  }
  return {
    ok: true,
    symbol: order.market.symbol,
  }
}

async function pauseForInvalidExecutionFill({
        pause,
        validation,
      }) {
  if (!["FILL_ORDER_IDENTITY", "FILL_PROVIDER_PROVENANCE_MISSING"].includes(validation.failure?.stage)) {
    return
  }
  await pause({
    symbol: validation.symbol,
    reason: "EXECUTION_FILL_ORDER_IDENTITY_MISMATCH",
    error: validation.error,
  })
}

async function handleExecutionAccountingFailure({ accounting, order, fill, pause, eventPublisher }) {
  const error = accounting?.errors?.[0] ?? new Error("Execution accounting failed")
  publishLifecycleEvent({
    eventPublisher,
    eventName: HARVESTER_EVENT_NAMES.EXECUTION_ACCOUNTING_FAILED,
    dataResult: mapExecutionAccountingFailedData({
      order,
      fill,
      error,
    }),
  })
  await pause({
    symbol: order.market.symbol,
    reason: "EXECUTION_ACCOUNTING_FAILED",
    error,
  })
  return failureResult({
    errors: accounting?.errors ?? [error],
    category: "ACCOUNTING_INTEGRITY",
    stage: "FILL_ACCOUNTING",
    retryable: false,
  })
}

function recordExecutionFillIdentity({ state, order, fill, recordBuyExecutionFill, recordSellExecutionFill }) {
  const {symbol} = order.market
  if (fill.side === "BUY") {
    recordBuyExecutionFill({
      fill,
    })
    state.completedRecoverySellSymbols.delete(symbol)
    state.completedRecoverySellOrdersBySymbol.delete(symbol)
  }
  if (fill.side === "SELL") {
    recordSellExecutionFill({
      fill,
    })
  }
}

function publishExecutionFillOutcome({
    accounting,
    fill,
    eventPublisher,
  }) {
  if (accounting.data?.applied === true) {
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.FILL_APPLIED,
      dataResult: mapFillAppliedData({
        fill,
      }),
    })
  } else if (accounting.data?.duplicate === true) {
    publishLifecycleEvent({
      eventPublisher,
      eventName: HARVESTER_EVENT_NAMES.EXECUTION_DUPLICATE_FILL,
      dataResult: mapDuplicateFillData({
        fill,
      }),
    })
  }
}

function attachOrderProviderIdentity({
    order,
    fill,
  }) {
  if (!(order instanceof CanonicalOrder) || !(fill instanceof Fill) ||
      !hasProviderIdentity({ value: order })) {
    return fill
  }
  assertProviderIdentityMatches({
    expected: order,
    actual: fill,
    allowMissingActual: true,
    context: "Execution fill provider identity",
  })
  if (hasProviderIdentity({ value: fill })) {
    return fill
  }
  return new Fill({
    tradeId: fill.tradeId,
    brokerOrderId: fill.brokerOrderId,
    clientOrderId: fill.clientOrderId ?? order.clientOrderId,
    providerInstanceId: order.providerInstanceId,
    providerType: order.providerType,
    accountId: order.accountId,
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

async function resolveExecutionFillAccounting({ dependencies, order, fill }) {
  const {
    state,
    updateTradingAccounting,
    updateRecoverySellerAccounting,
  } = dependencies
  const ownership = state.registry?.getOwnership?.({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
  })
  const isRecoverySellerOwned = ownership?.strategyId === StrategyId.RECOVERY_SELLER
  if (isRecoverySellerOwned && fill.side === "SELL") {
    return {
      isRecoverySellerOwned,
      accounting: toResult({
        data: {
          stagedForTerminalReconciliation: true,
        },
      }),
    }
  }
  if (isRecoverySellerOwned && typeof updateRecoverySellerAccounting !== "function") {
    return {
      isRecoverySellerOwned,
      accounting: toResult({
        error: new Error("Recovery Seller BUY accounting workflow is unavailable for an RS-owned fill"),
      }),
    }
  }
  if (isRecoverySellerOwned) {
    return {
      isRecoverySellerOwned,
      accounting: await updateRecoverySellerAccounting({
        fill,
        order,
        ownership,
      }),
    }
  }
  if (ownership && ownership.strategyId !== StrategyId.COIN_GRABBER) {
    return {
      isRecoverySellerOwned,
      accounting: toResult({
        error: new Error(`Execution fill has unsupported registered strategy ownership: ${ownership.strategyId}`),
      }),
    }
  }
  return {
    isRecoverySellerOwned,
    accounting: await updateTradingAccounting({ fill }),
  }
}

function stageRecoverySellerSellExecutionFill({
  accounting,
  isRecoverySellerOwned,
  recordSellExecutionFill,
  fill,
} = {}) {
  if (!isRecoverySellerOwned || accounting?.data?.stagedForTerminalReconciliation !== true) {
    return undefined
  }
  if (typeof recordSellExecutionFill !== "function") {
    return toResult({
      error: new TypeError("Recovery Seller SELL staging requires the canonical execution-fill recorder"),
    })
  }
  recordSellExecutionFill({ fill })
  return toResult({ data: { stagedForTerminalReconciliation: true } })
}

async function applyValidatedExecutionFill({ dependencies, order, fill }) {
  const {
    state,
    eventPublisher,
    recordBuyExecutionFill,
    recordSellExecutionFill,
    pause,
  } = dependencies
  const { accounting, isRecoverySellerOwned } = await resolveExecutionFillAccounting({
    dependencies,
    order,
    fill,
  })
  const stagedResult = stageRecoverySellerSellExecutionFill({
    accounting,
    isRecoverySellerOwned,
    recordSellExecutionFill,
    fill,
  })
  if (stagedResult) {
    return stagedResult.ok
      ? stagedResult
      : handleExecutionAccountingFailure({
          accounting: stagedResult,
          order,
          fill,
          pause,
          eventPublisher,
        })
  }
  if (!accounting?.ok) {
    return handleExecutionAccountingFailure({
      accounting,
      order,
      fill,
      pause,
      eventPublisher,
    })
  }
  if (!isRecoverySellerOwned) {
    recordExecutionFillIdentity({
      state,
      order,
      fill,
      recordBuyExecutionFill,
      recordSellExecutionFill,
    })
  }
  publishExecutionFillOutcome({
    accounting,
    fill,
    eventPublisher,
  })
  return toResult({
    data: {
      applied: accounting.data?.applied === true,
      duplicate: accounting.data?.duplicate === true,
    },
  })
}
async function processExecutionFill({ dependencies, order, fill }) {
  const registeredOrder = resolveRegisteredOrder({
    state: dependencies.state,
    order,
  })
  const attributedFill = attachOrderProviderIdentity({
    order: registeredOrder,
    fill,
  })
  const { eventPublisher, pause } = dependencies
  try {
    const validation = validateExecutionFill({
      order: registeredOrder,
      fill: attributedFill,
      eventPublisher,
      requireProviderProvenance: dependencies.requireProviderProvenance,
    })
    if (!validation.ok) {
      await pauseForInvalidExecutionFill({
        pause,
        validation,
      })
      if (validation.result) {
        return validation.result
      }
      return failureResult({
        error: validation.error,
        category: validation.failure.category,
        stage: validation.failure.stage,
        retryable: validation.failure.retryable,
      })
    }
    return await applyValidatedExecutionFill({
      dependencies,
      order: registeredOrder,
      fill: attributedFill,
    })
  } catch (error) {
    return failureResult({
      error,
      category: "ACCOUNTING_INTEGRITY",
      stage: "FILL_ACCOUNTING",
      retryable: false,
    })
  }
}

/**
 * Coordinate canonical user-data order events and execution-fill application.
 * The caller owns serialization and supplies accounting, cancellation,
 * recovery-cycle and strategy-evaluation transitions.
 */
