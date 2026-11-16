import { Fill } from "@coinzilla/entities"
import { addDecimal, compareDecimal, toResult } from "@coinzilla/utils"

const failureResult = ({ error, errors, category, stage, retryable }) => {
  const result = { failure: { category, 
    stage, 
    retryable } }
  if (errors !== undefined) {
    result.errors = errors
  } else {
    result.error = error
  }
  return toResult(result)
}

const withFailure = ({ result, failure }) => {
  if (result?.failure) {
    return result
  }
  return toResult({ ...result, 
    failure })
}

async function pauseWithFailure({ pause, symbol, reason, error, category, stage, retryable }) {
  await pause({ symbol, 
    reason, 
    error })
  return failureResult({ error, 
    category, 
    stage, 
    retryable })
}

function validateTerminalOrder({ order }) {
  const terminalStatuses = new Set(["FILLED", "CANCELED", "EXPIRED", "REJECTED"])
  if (!order || !terminalStatuses.has(order.status)) {
    return failureResult({
      error: new TypeError("Terminal fill reconciliation requires a terminal canonical order"),
      category: "ACCOUNTING_INTEGRITY",
      stage: "TERMINAL_ORDER_STATE",
      retryable: false,
    })
  }
  return undefined
}

async function readTerminalFillHistory({ broker, order, pause, symbol }) {
  let fillsResult
  try {
    fillsResult = await broker.getFills({ symbol, 
      orderId: order.brokerOrderId })
  } catch (error) {
    const failure = error?.recoveryFailure ?? {
      category: "ACCOUNTING_INTEGRITY",
      stage: "TERMINAL_FILL_HISTORY_READ_EXCEPTION",
      retryable: false,
    }
    await pause({ symbol, 
      reason: "TERMINAL_ORDER_FILL_HISTORY_UNAVAILABLE", 
      error })
    return failureResult({ error, 
      ...failure })
  }
  if (fillsResult?.ok !== false && fillsResult?.ok !== true) {
    return pauseWithFailure({
      pause,
      symbol,
      reason: "TERMINAL_ORDER_FILL_HISTORY_INVALID",
      error: new Error("Terminal order fill-history response is missing an explicit success flag"),
      category: "ACCOUNTING_INTEGRITY",
      stage: "TERMINAL_FILL_HISTORY_RESPONSE",
      retryable: false,
    })
  }
  if (fillsResult.ok === false) {
    return pauseWithFailure({
      pause,
      symbol,
      reason: "TERMINAL_ORDER_FILL_HISTORY_UNAVAILABLE",
      error: fillsResult?.errors?.[0] ?? new Error("Unable to retrieve terminal order fill history"),
      category: "REST_RECONCILIATION",
      stage: "TERMINAL_FILL_HISTORY",
      retryable: true,
    })
  }
  if (!Array.isArray(fillsResult.data) || fillsResult.data.some((fill) => !(fill instanceof Fill))) {
    return pauseWithFailure({
      pause,
      symbol,
      reason: "TERMINAL_ORDER_FILL_HISTORY_INVALID",
      error: new Error("Terminal order fill history returned malformed execution records"),
      category: "ACCOUNTING_INTEGRITY",
      stage: "TERMINAL_FILL_HISTORY_SHAPE",
      retryable: false,
    })
  }
  return fillsResult.data
}

function hasCanonicalOrderIdentity({ fill, order }) {
  return fill instanceof Fill &&
    fill.market.id === order.market.id &&
    fill.side === order.side &&
    fill.brokerOrderId === order.brokerOrderId &&
    (fill.clientOrderId === undefined || fill.clientOrderId === order.clientOrderId)
}

async function collectStreamFills({ order, eventFill, processedFillsByOrder, pause, symbol }) {
  const fillsById = new Map()
  const previouslyProcessedFills = [
    ...(processedFillsByOrder.get(order.brokerOrderId)?.values() ?? []),
  ]
  const streamFills = [
    ...previouslyProcessedFills,
    ...(eventFill === undefined ? [] : [eventFill]),
  ]
  for (const fill of streamFills) {
    if (!hasCanonicalOrderIdentity({ fill, 
      order })) {
      return pauseWithFailure({
        pause,
        symbol,
        reason: "TERMINAL_ORDER_FILL_IDENTITY_MISMATCH",
        error: new Error("Terminal stream execution does not match its canonical order"),
        category: "OWNERSHIP_INTEGRITY",
        stage: "TERMINAL_FILL_IDENTITY",
        retryable: false,
      })
    }
    const previous = fillsById.get(fill.id)
    if (previous && JSON.stringify(previous.value) !== JSON.stringify(fill.value)) {
      return pauseWithFailure({
        pause,
        symbol,
        reason: "TERMINAL_ORDER_FILL_CONFLICTING_DUPLICATE",
        error: new Error("Terminal stream contains conflicting facts for one fill ID"),
        category: "ACCOUNTING_INTEGRITY",
        stage: "TERMINAL_FILL_DUPLICATE",
        retryable: false,
      })
    }
    if (!previous) {
      fillsById.set(fill.id, fill)
    }
  }
  return { fillsById, 
    streamFills }
}

async function mergeRestFills({ fillsById, restFills, streamFills, order, pause, symbol }) {
  for (const fill of restFills) {
    if (!hasCanonicalOrderIdentity({ fill, 
      order })) {
      if (streamFills.length > 0) {
        continue
      }
      return pauseWithFailure({
        pause,
        symbol,
        reason: "TERMINAL_ORDER_FILL_IDENTITY_MISMATCH",
        error: new Error("Terminal execution history does not match its canonical order"),
        category: "OWNERSHIP_INTEGRITY",
        stage: "TERMINAL_REST_FILL_IDENTITY",
        retryable: false,
      })
    }
    const previous = fillsById.get(fill.id)
    if (previous && JSON.stringify(previous.value) !== JSON.stringify(fill.value)) {
      return pauseWithFailure({
        pause,
        symbol,
        reason: "TERMINAL_ORDER_FILL_CONFLICTING_DUPLICATE",
        error: new Error("Terminal execution history contains conflicting facts for one fill ID"),
        category: "ACCOUNTING_INTEGRITY",
        stage: "TERMINAL_REST_FILL_DUPLICATE",
        retryable: false,
      })
    }
    if (!previous) {
      fillsById.set(fill.id, fill)
    }
  }
  return undefined
}

function sortTerminalFills({ fillsById }) {
  return [...fillsById.values()].sort((...entries) => {
    const [left, right] = entries
    if (left.executedAt !== undefined && right.executedAt !== undefined &&
        left.executedAt !== right.executedAt) {
      return left.executedAt - right.executedAt
    }
    return left.tradeId.localeCompare(right.tradeId)
  })
}

function getTerminalFillMismatchReason({ order }) {
  if (order.side === "SELL" && order.status === "FILLED") {
    return "SELL_FILL_RECONCILIATION_FAILED"
  }
  if (order.side === "BUY" && order.status === "FILLED") {
    return "BUY_FILL_RECONCILIATION_FAILED"
  }
  const partiallyFilledTerminalBuy = order.side === "BUY" &&
    ["CANCELED", "EXPIRED", "REJECTED"].includes(order.status) &&
    compareDecimal({ left: order.executedQuantity.amount, 
      right: "0" }) > 0
  if (partiallyFilledTerminalBuy) {
    return "PARTIALLY_FILLED_ORDER_CANCELED_REQUIRES_REVIEW"
  }
  return "TERMINAL_ORDER_EXECUTED_QUANTITY_MISMATCH"
}

async function verifyTerminalFillQuantities({ fills, order, pause, symbol }) {
  const reconciledQuantity = fills.reduce(
    (...entries) => {
      const [total, fill] = entries
      return addDecimal({ left: total, 
        right: fill.quantity.amount })
    },
    "0",
  )
  if (compareDecimal({ left: reconciledQuantity, 
    right: order.executedQuantity.amount }) !== 0) {
    return pauseWithFailure({
      pause,
      symbol,
      reason: getTerminalFillMismatchReason({ order }),
      error: new Error("Terminal order executed quantity does not match its complete distinct fill history"),
      category: "ACCOUNTING_INTEGRITY",
      stage: "TERMINAL_FILL_PARITY",
      retryable: false,
    })
  }
  const fullExecution = compareDecimal({
    left: order.executedQuantity.amount,
    right: order.originalQuantity.amount,
  }) === 0
  if ((order.status === "FILLED") !== fullExecution) {
    return pauseWithFailure({
      pause,
      symbol,
      reason: "TERMINAL_ORDER_STATUS_QUANTITY_CONFLICT",
      error: new Error("Terminal order status conflicts with its executed/original quantity"),
      category: "ACCOUNTING_INTEGRITY",
      stage: "TERMINAL_ORDER_STATUS",
      retryable: false,
    })
  }
  return { reconciledQuantity }
}

async function applyTerminalFills({ fills, order, processExecutionFillTransition, pause, symbol }) {
  for (const fill of fills) {
    const applied = await processExecutionFillTransition({ order, 
      fill })
    if (!applied?.ok) {
      const error = applied?.errors?.[0] ?? new Error("Terminal order fill could not be applied")
      await pause({ symbol, 
        reason: "TERMINAL_ORDER_FILL_ACCOUNTING_FAILED", 
        error })
      return withFailure({
        result: toResult({ errors: applied?.errors ?? [error] }),
        failure: applied?.failure ?? {
          category: "ACCOUNTING_INTEGRITY",
          stage: "TERMINAL_FILL_ACCOUNTING",
          retryable: false,
        },
      })
    }
  }
  return undefined
}

/**
 * Reconcile a terminal order's REST executions with canonical stream facts,
 * then apply the complete, deduplicated fill set in deterministic order.
 *
 * The caller invokes this workflow from its serialized engine transition.
 */
export function makeReconcileTerminalOrderFills(options = {}) {
  const { broker, processedFillsByOrder, pause, processExecutionFillTransition } = options
  return async function reconcileTerminalOrderFills({ order, eventFill } = {}) {
    const symbol = order?.market?.symbol
    const invalidOrder = validateTerminalOrder({ order })
    if (invalidOrder) {
      return invalidOrder
    }
    if (typeof order.brokerOrderId !== "string" || !order.brokerOrderId.trim()) {
      return pauseWithFailure({
        pause,
        symbol,
        reason: "TERMINAL_ORDER_MISSING_BROKER_ID",
        error: new Error("Terminal order has no broker order ID for fill reconciliation"),
        category: "OWNERSHIP_INTEGRITY",
        stage: "TERMINAL_ORDER_ID",
        retryable: false,
      })
    }

    const restFills = await readTerminalFillHistory({ broker, 
      order, 
      pause, 
      symbol })
    if (!Array.isArray(restFills)) {
      return restFills
    }
    const streamResult = await collectStreamFills({
      order,
      eventFill,
      processedFillsByOrder,
      pause,
      symbol,
    })
    if (streamResult?.ok !== undefined && streamResult.ok !== true) {
      return streamResult
    }
    const restMergeResult = await mergeRestFills({
      fillsById: streamResult.fillsById,
      restFills,
      streamFills: streamResult.streamFills,
      order,
      pause,
      symbol,
    })
    if (restMergeResult) {
      return restMergeResult
    }

    const fills = sortTerminalFills({ fillsById: streamResult.fillsById })
    const quantityResult = await verifyTerminalFillQuantities({ fills, 
      order, 
      pause, 
      symbol })
    if (quantityResult?.ok !== undefined && quantityResult.ok !== true) {
      return quantityResult
    }
    const applyResult = await applyTerminalFills({
      fills,
      order,
      processExecutionFillTransition,
      pause,
      symbol,
    })
    if (applyResult) {
      return applyResult
    }
    return toResult({
      data: {
        reconciled: true,
        fillCount: fills.length,
        executedQuantity: quantityResult.reconciledQuantity,
      },
    })
  }
}
