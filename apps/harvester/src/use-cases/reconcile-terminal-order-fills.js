import { Fill } from "@coinzilla/entities"
import { addDecimal, compareDecimal, toResult } from "@coinzilla/utils"

const failureResult = ({ error, errors, category, stage, retryable }) => {
  const result = { failure: { category, stage, retryable } }
  if (errors !== undefined) {result.errors = errors}
  else {result.error = error}
  return toResult(result)
}

const withFailure = (result, failure) => {
  if (result?.failure) {return result}
  return toResult({ ...result, failure })
}

/**
 * Reconcile a terminal order's REST executions with canonical stream facts,
 * then apply the complete, deduplicated fill set in deterministic order.
 *
 * The caller invokes this workflow from its serialized engine transition.
 */
export function makeReconcileTerminalOrderFills({
  broker,
  processedFillsByOrder,
  pause,
  processExecutionFillTransition,
} = {}) {
  return async function reconcileTerminalOrderFills({ order, eventFill } = {}) {
    const symbol = order?.market?.symbol
    const terminalStatuses = new Set(["FILLED", "CANCELED", "EXPIRED", "REJECTED"])
    if (!order || !terminalStatuses.has(order.status)) {
      return failureResult({
        error: new TypeError("Terminal fill reconciliation requires a terminal canonical order"),
        category: "ACCOUNTING_INTEGRITY",
        stage: "TERMINAL_ORDER_STATE",
        retryable: false,
      })
    }
    if (typeof order.brokerOrderId !== "string" || !order.brokerOrderId.trim()) {
      const error = new Error("Terminal order has no broker order ID for fill reconciliation")
      await pause({ symbol, reason: "TERMINAL_ORDER_MISSING_BROKER_ID", error })
      return failureResult({ error, category: "OWNERSHIP_INTEGRITY", stage: "TERMINAL_ORDER_ID", retryable: false })
    }
    let fillsResult
    try {
      fillsResult = await broker.getFills({ symbol, orderId: order.brokerOrderId })
    } catch (error) {
      const failure = error?.recoveryFailure ?? {
        category: "ACCOUNTING_INTEGRITY",
        stage: "TERMINAL_FILL_HISTORY_READ_EXCEPTION",
        retryable: false,
      }
      await pause({ symbol, reason: "TERMINAL_ORDER_FILL_HISTORY_UNAVAILABLE", error })
      return failureResult({ error, ...failure })
    }
    if (fillsResult?.ok !== false && fillsResult?.ok !== true) {
      const error = new Error("Terminal order fill-history response is missing an explicit success flag")
      await pause({ symbol, reason: "TERMINAL_ORDER_FILL_HISTORY_INVALID", error })
      return failureResult({ error, category: "ACCOUNTING_INTEGRITY", stage: "TERMINAL_FILL_HISTORY_RESPONSE", retryable: false })
    }
    if (fillsResult.ok === false) {
      const error = fillsResult?.errors?.[0] ?? new Error("Unable to retrieve terminal order fill history")
      await pause({ symbol, reason: "TERMINAL_ORDER_FILL_HISTORY_UNAVAILABLE", error })
      return failureResult({ error, category: "REST_RECONCILIATION", stage: "TERMINAL_FILL_HISTORY", retryable: true })
    }
    if (!Array.isArray(fillsResult.data) || fillsResult.data.some((fill) => !(fill instanceof Fill))) {
      const error = new Error("Terminal order fill history returned malformed execution records")
      await pause({ symbol, reason: "TERMINAL_ORDER_FILL_HISTORY_INVALID", error })
      return failureResult({ error, category: "ACCOUNTING_INTEGRITY", stage: "TERMINAL_FILL_HISTORY_SHAPE", retryable: false })
    }

    // Processed user-data fills are canonical in-process facts. Prefer them
    // over REST rows when the exchange's REST metadata is contradictory; the
    // final cumulative-quantity check still requires a complete history.
    const fillsById = new Map()
    const previouslyProcessedFills = [
      ...(processedFillsByOrder.get(order.brokerOrderId)?.values() ?? []),
    ]
    const streamFills = [
      ...previouslyProcessedFills,
      ...(eventFill === undefined ? [] : [eventFill]),
    ]
    for (const fill of streamFills) {
      if (!(fill instanceof Fill) || fill.market.id !== order.market.id ||
          fill.side !== order.side || fill.brokerOrderId !== order.brokerOrderId ||
          (fill.clientOrderId !== undefined && fill.clientOrderId !== order.clientOrderId)) {
        const error = new Error("Terminal stream execution does not match its canonical order")
        await pause({ symbol, reason: "TERMINAL_ORDER_FILL_IDENTITY_MISMATCH", error })
        return failureResult({ error, category: "OWNERSHIP_INTEGRITY", stage: "TERMINAL_FILL_IDENTITY", retryable: false })
      }
      const previous = fillsById.get(fill.id)
      if (previous && JSON.stringify(previous.value) !== JSON.stringify(fill.value)) {
        const error = new Error("Terminal stream contains conflicting facts for one fill ID")
        await pause({ symbol, reason: "TERMINAL_ORDER_FILL_CONFLICTING_DUPLICATE", error })
        return failureResult({ error, category: "ACCOUNTING_INTEGRITY", stage: "TERMINAL_FILL_DUPLICATE", retryable: false })
      }
      if (!previous) {fillsById.set(fill.id, fill)}
    }
    for (const fill of fillsResult.data) {
      if (!(fill instanceof Fill) || fill.market.id !== order.market.id ||
          fill.side !== order.side || fill.brokerOrderId !== order.brokerOrderId ||
          (fill.clientOrderId !== undefined && fill.clientOrderId !== order.clientOrderId)) {
        // A valid stream execution can supersede a contradictory REST row,
        // but only if the union still proves the terminal cumulative quantity.
        if (streamFills.length > 0) {continue}
        const error = new Error("Terminal execution history does not match its canonical order")
        await pause({ symbol, reason: "TERMINAL_ORDER_FILL_IDENTITY_MISMATCH", error })
        return failureResult({ error, category: "OWNERSHIP_INTEGRITY", stage: "TERMINAL_REST_FILL_IDENTITY", retryable: false })
      }
      const previous = fillsById.get(fill.id)
      if (previous && JSON.stringify(previous.value) !== JSON.stringify(fill.value)) {
        const error = new Error("Terminal execution history contains conflicting facts for one fill ID")
        await pause({ symbol, reason: "TERMINAL_ORDER_FILL_CONFLICTING_DUPLICATE", error })
        return failureResult({ error, category: "ACCOUNTING_INTEGRITY", stage: "TERMINAL_REST_FILL_DUPLICATE", retryable: false })
      }
      if (!previous) {fillsById.set(fill.id, fill)}
    }
    const fills = [...fillsById.values()].sort((left, right) => {
      if (left.executedAt !== undefined && right.executedAt !== undefined &&
          left.executedAt !== right.executedAt) {return left.executedAt - right.executedAt}
      return left.tradeId.localeCompare(right.tradeId)
    })
    const reconciledQuantity = fills.reduce(
      (total, fill) => addDecimal({ left: total, right: fill.quantity.amount }),
      "0",
    )
    if (compareDecimal({ left: reconciledQuantity, right: order.executedQuantity.amount }) !== 0) {
      const error = new Error("Terminal order executed quantity does not match its complete distinct fill history")
      const reason = order.side === "SELL" && order.status === "FILLED"
        ? "SELL_FILL_RECONCILIATION_FAILED"
        : order.side === "BUY" && order.status === "FILLED"
          ? "BUY_FILL_RECONCILIATION_FAILED"
          : order.side === "BUY" && ["CANCELED", "EXPIRED", "REJECTED"].includes(order.status) &&
            compareDecimal({ left: order.executedQuantity.amount, right: "0" }) > 0
            ? "PARTIALLY_FILLED_ORDER_CANCELED_REQUIRES_REVIEW"
            : "TERMINAL_ORDER_EXECUTED_QUANTITY_MISMATCH"
      await pause({ symbol, reason, error })
      return failureResult({ error, category: "ACCOUNTING_INTEGRITY", stage: "TERMINAL_FILL_PARITY", retryable: false })
    }
    const fullExecution = compareDecimal({
      left: order.executedQuantity.amount,
      right: order.originalQuantity.amount,
    }) === 0
    if ((order.status === "FILLED") !== fullExecution) {
      const error = new Error("Terminal order status conflicts with its executed/original quantity")
      await pause({ symbol, reason: "TERMINAL_ORDER_STATUS_QUANTITY_CONFLICT", error })
      return failureResult({ error, category: "ACCOUNTING_INTEGRITY", stage: "TERMINAL_ORDER_STATUS", retryable: false })
    }
    for (const fill of fills) {
      const applied = await processExecutionFillTransition({ order, fill })
      if (!applied?.ok) {
        const error = applied?.errors?.[0] ?? new Error("Terminal order fill could not be applied")
        await pause({ symbol, reason: "TERMINAL_ORDER_FILL_ACCOUNTING_FAILED", error })
        return withFailure(
          toResult({ errors: applied?.errors ?? [error] }),
          applied?.failure ?? {
            category: "ACCOUNTING_INTEGRITY",
            stage: "TERMINAL_FILL_ACCOUNTING",
            retryable: false,
          },
        )
      }
    }
    return toResult({ data: { reconciled: true, fillCount: fills.length, executedQuantity: reconciledQuantity } })
  }
}
