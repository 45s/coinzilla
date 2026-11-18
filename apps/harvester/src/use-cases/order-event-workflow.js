import { CanonicalOrder, Fill } from "@coinzilla/entities"
import { hasProviderIdentity } from "../domain/orders/provider-provenance.js"
import { toResult } from "@coinzilla/utils"
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


function createProcessExecutionFillTransition({
  state,
  eventPublisher,
  updateTradingAccounting,
  recordBuyExecutionFill,
  recordSellExecutionFill,
  pause,
}) {
  const dependencies = {
    state,
    eventPublisher,
    updateTradingAccounting,
    recordBuyExecutionFill,
    recordSellExecutionFill,
    pause,
  }
  return (options = {}) => processExecutionFill({
    dependencies,
    ...options,
  })
}

export function makeOrderEventWorkflow({
  state,
  broker,
  eventPublisher,
  pairs,
  updateTradingAccounting,
  recordBuyExecutionFill,
  recordSellExecutionFill,
  pause,
  resolveRecoveryManagedCancellation,
  cancelAndReconcileRecoverySells,
  evaluateLatestTransition,
  getReconciledBuyExecutionPrice,
  assertReconciledSellExecution,
  completeRecoveryCycle,
  publishRecoveryCycleNotCompleted,
  isStopping,
  logger,
  onUnownedExternalOrderObserved,
} = {}) {
  const processExecutionFillTransition = createProcessExecutionFillTransition({
    state,
    eventPublisher,
    updateTradingAccounting,
    recordBuyExecutionFill,
    recordSellExecutionFill,
    pause,
  })
  const reconcileTerminalOrderFills = makeReconcileTerminalOrderFills({
    broker,
    processedFillsByOrder: state.processedFillsByOrder,
    pause,
    processExecutionFillTransition,
  })
  const processUserDataEventTransition = createUserDataEventTransition({
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

function validateMissingExecutionFill({ order, fill, eventPublisher }) {
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

function validateExecutionFill({ order, fill, eventPublisher }) {
  const missingFill = validateMissingExecutionFill({ order, fill, eventPublisher })
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
  const providerFailure = getProviderAttributionFailure({ order, fill })
  const identityMatches = fill.market.id === order.market.id &&
    fill.side === order.side &&
    fill.brokerOrderId === order.brokerOrderId &&
    (fill.clientOrderId === undefined || fill.clientOrderId === order.clientOrderId)
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
  return { ok: true, symbol: order.market.symbol }
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

function publishExecutionFillOutcome({ accounting, fill, eventPublisher }) {
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
  if (!(order instanceof CanonicalOrder) || order.providerInstanceId === undefined ||
      !(fill instanceof Fill) || fill.providerInstanceId !== undefined) {
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

async function applyValidatedExecutionFill({ dependencies, order, fill }) {
  const {
    state,
    eventPublisher,
    updateTradingAccounting,
    recordBuyExecutionFill,
    recordSellExecutionFill,
    pause,
  } = dependencies
  const accounting = await updateTradingAccounting({ fill })
  if (!accounting?.ok) {
    return handleExecutionAccountingFailure({
      accounting,
      order,
      fill,
      pause,
      eventPublisher,
    })
  }
  recordExecutionFillIdentity({
    state,
    order,
    fill,
    recordBuyExecutionFill,
    recordSellExecutionFill,
  })
  publishExecutionFillOutcome({ accounting, fill, eventPublisher })
  return toResult({
    data: {
      applied: accounting.data?.applied === true,
      duplicate: accounting.data?.duplicate === true,
    },
  })
}

async function processExecutionFill({ dependencies, order, fill }) {
  const attributedFill = attachOrderProviderIdentity({ order, fill })
  const { eventPublisher, pause } = dependencies
  try {
    const validation = validateExecutionFill({
      order,
      fill: attributedFill,
      eventPublisher,
    })
    if (!validation.ok) {
      await pauseForInvalidExecutionFill({ pause, validation })
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
      order,
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
