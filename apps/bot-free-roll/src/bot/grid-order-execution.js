import { toResult } from "@coinzilla/utils"
import { appendGridCycleSellOrder } from "./grid-cycles.js"
import {
  acknowledgeGridOrderIntent,
  createGridOrderIntent,
  resolveGridOrderIntent,
} from "./grid-order-intents.js"

function failure(reason) {
  return toResult({ errors: [reason] })
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

export function normalizeGridBrokerOrder({ order } = {}) {
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    return failure("Broker order response must be an object")
  }

  const normalized = {
    id: String(order.id ?? order.orderId ?? order.brokerOrderId ?? ""),
    clientOrderId: String(order.clientOrderId ?? ""),
    symbol: String(order.symbol ?? order.market?.symbol ?? ""),
    side: String(order.side ?? ""),
    type: String(order.type ?? ""),
    quantity: String(order.quantity ?? order.origQty ?? order.originalQuantity?.amount ?? ""),
    price: String(order.price ?? order.limitPrice?.amount ?? ""),
    status: String(order.status ?? ""),
  }
  if (!isNonEmptyString(normalized.id) ||
      !isNonEmptyString(normalized.clientOrderId) ||
      !isNonEmptyString(normalized.symbol) ||
      !["BUY", "SELL"].includes(normalized.side) ||
      !["LIMIT", "LIMIT_MAKER"].includes(normalized.type) ||
      !isNonEmptyString(normalized.quantity) ||
      !isNonEmptyString(normalized.price) ||
      !isNonEmptyString(normalized.status)) {
    return failure("Broker order response is missing canonical order identity")
  }
  return toResult({ data: Object.freeze(normalized) })
}

function validateIntentSnapshot({ intent }) {
  if (!intent || !["PREPARED", "ACKNOWLEDGED"].includes(intent.status)) {
    return failure("Grid order intent has an invalid lifecycle status")
  }
  const canonical = createGridOrderIntent({
    intentId: intent.intentId,
    symbol: intent.symbol,
    side: intent.side,
    type: intent.type,
    quantity: intent.quantity,
    price: intent.price,
    reservedQuantity: intent.reservedQuantity,
    createdAtServerTime: intent.createdAtServerTime,
    cycleId: intent.cycleId,
  })
  if (!canonical.ok) return canonical
  if (canonical.data.clientOrderId !== intent.clientOrderId ||
      (intent.status === "PREPARED" && intent.brokerOrderId !== null) ||
      (intent.status === "ACKNOWLEDGED" && !isNonEmptyString(intent.brokerOrderId))) {
    return failure("Grid order intent does not match its deterministic identity")
  }
  return toResult({ ok: true })
}

function validateSubmissionContext({ state, intent }) {
  const intentValidation = validateIntentSnapshot({ intent })
  if (!intentValidation.ok) return intentValidation
  if (!state || state.mode !== "grid" || state.symbol !== intent?.symbol ||
      !(state.gridCycles instanceof Map) ||
      !(state.orderIntents instanceof Map) ||
      !(state.trackedOrderIds instanceof Set)) {
    return failure("Grid order intent does not match an initialized Grid pair state")
  }
  if (intent.side === "BUY" && intent.cycleId !== null) {
    return failure("Grid BUY order intent cannot reference a recovery cycle")
  }
  if (intent.side === "SELL" && !isNonEmptyString(intent.cycleId)) {
    return failure("Grid SELL order intent must reference its owning cycle")
  }
  return toResult({ ok: true })
}

function attachAcknowledgedOrder({ state, intent, order }) {
  if (intent.side === "BUY") {
    if (state.buyOrder) {
      if (state.buyOrder.clientOrderId === intent.clientOrderId &&
          state.buyOrder.id === order.id) {
        return toResult({ data: state.buyOrder, duplicate: true })
      }
      return failure("Grid pair already has a different working BUY order")
    }
    state.buyOrder = order
  } else {
    const cycle = state.gridCycles.get(intent.cycleId)
    if (!cycle) return failure("Grid SELL intent references an unknown cycle")
    const existing = cycle.sellOrders.find((entry) =>
      entry.clientOrderId === intent.clientOrderId,
    )
    if (existing) {
      if (existing.id === order.id) return toResult({ data: existing, duplicate: true })
      return failure("Grid SELL client order ID is already attached to another broker order")
    }
    const appended = appendGridCycleSellOrder({
      cycle,
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      type: order.type,
      price: order.price,
      quantity: order.quantity,
      reservedQuantity: intent.reservedQuantity,
    })
    if (!appended.ok) return appended
    state.gridCycles.set(cycle.id, appended.data)
  }
  state.trackedOrderIds.add(order.id)
  return toResult({ data: order })
}

export function createGridOrderExecution({
  broker,
  persistGridState,
} = {}) {
  if (!broker || typeof broker.createOrder !== "function") {
    throw new TypeError("Grid order execution requires broker.createOrder")
  }
  if (typeof persistGridState !== "function") {
    throw new TypeError("Grid order execution requires persistGridState")
  }

  async function persist({ state }) {
    try {
      const result = await persistGridState({ state })
      if (!result?.ok) return result ?? failure("Grid state persistence failed")
      return result
    } catch (error) {
      return failure(error.message)
    }
  }

  async function submitPreparedIntent({ state, intent }) {
    const context = validateSubmissionContext({ state, intent })
    if (!context.ok) return context
    const existingIntent = state.orderIntents.get(intent.clientOrderId)
    if (existingIntent && JSON.stringify(existingIntent) !== JSON.stringify(intent)) {
      return failure("Conflicting Grid order intent already exists")
    }
    if (!existingIntent) state.orderIntents.set(intent.clientOrderId, intent)

    const beforeSubmit = await persist({ state })
    if (!beforeSubmit.ok) return failure("Grid order intent was not durably persisted; broker submission was blocked")

    let brokerResult
    try {
      brokerResult = await broker.createOrder({
        symbol: intent.symbol,
        side: intent.side,
        type: intent.type,
        quantity: intent.quantity,
        price: intent.price,
        clientOrderId: intent.clientOrderId,
      })
    } catch (error) {
      return failure(`Grid order submission outcome is uncertain: ${error.message}`)
    }
    if (!brokerResult?.ok) {
      return brokerResult ?? failure("Grid broker order submission failed")
    }

    const normalized = normalizeGridBrokerOrder({
      order: brokerResult.data ?? brokerResult,
    })
    if (!normalized.ok) {
      return failure("Broker accepted a Grid order but returned incomplete identity; reconcile by clientOrderId")
    }
    const acknowledged = acknowledgeGridOrderIntent({
      intent,
      order: normalized.data,
    })
    if (!acknowledged.ok) {
      return failure("Broker accepted a Grid order whose identity does not match its intent")
    }

    const attached = attachAcknowledgedOrder({
      state,
      intent,
      order: normalized.data,
    })
    if (!attached.ok) {
      return failure("Broker accepted a Grid order but it could not be attached to local cycle state")
    }
    state.orderIntents.delete(intent.clientOrderId)

    const afterSubmit = await persist({ state })
    if (!afterSubmit.ok) {
      return failure("Grid order was accepted but its acknowledged state was not persisted; pair must pause and reconcile")
    }
    return toResult({
      data: {
        order: normalized.data,
        intent: acknowledged.data,
      },
    })
  }

  async function submit({ state, intent }) {
    if (!intent || intent.status !== "PREPARED") {
      return failure("Grid submission requires a PREPARED order intent")
    }
    return submitPreparedIntent({ state, intent })
  }

  async function resolve({ state, intent, matchingOrders, historyComplete }) {
    const context = validateSubmissionContext({ state, intent })
    if (!context.ok) return context
    const candidates = []
    for (const order of matchingOrders ?? []) {
      if (order?.clientOrderId !== intent?.clientOrderId) continue
      const normalized = normalizeGridBrokerOrder({ order })
      if (!normalized.ok) return normalized
      candidates.push(normalized.data)
    }

    const resolution = resolveGridOrderIntent({
      intent,
      matchingOrders: candidates,
      historyComplete,
    })
    if (!resolution.ok) return resolution
    if (resolution.data.status === "UNKNOWN") {
      return failure("Grid order submission cannot be resolved from incomplete broker history")
    }
    if (resolution.data.status === "ABSENT") {
      return submitPreparedIntent({ state, intent })
    }

    const order = resolution.data.order
    const acknowledged = intent.status === "PREPARED"
      ? acknowledgeGridOrderIntent({ intent, order })
      : toResult({ data: intent })
    if (!acknowledged.ok) return acknowledged

    const attached = attachAcknowledgedOrder({ state, intent, order })
    if (!attached.ok) return attached
    state.orderIntents.delete(intent.clientOrderId)
    const persisted = await persist({ state })
    if (!persisted.ok) {
      return failure("Recovered Grid order was attached but its state could not be persisted")
    }
    return toResult({ data: { order, intent: acknowledged.data, recovered: true } })
  }

  return Object.freeze({ resolve, submit })
}
