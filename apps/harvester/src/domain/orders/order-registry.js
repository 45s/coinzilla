import { CanonicalOrder } from "@coinzilla/entities"
import { compareDecimal, toResult } from "@coinzilla/utils"
import {
  attachBrokerOrderIdToOwnership,
  createOrderOwnership,
  findOrderOwnership,
  hasSameOrderOwnership,
  validateOrderOwnerships,
} from "./order-ownership.js"

const ACTIVE_STATUSES = new Set(["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"])
const TERMINAL_STATUSES = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED"])
const ALLOWED_TRANSITIONS = Object.freeze({
  PENDING: new Set(["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED", "UNKNOWN"]),
  OPEN: new Set(["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED", "UNKNOWN"]),
  PARTIALLY_FILLED: new Set(["PARTIALLY_FILLED", "FILLED", "CANCELED", "EXPIRED", "UNKNOWN"]),
  UNKNOWN: new Set(["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED", "UNKNOWN"]),
  FILLED: new Set(["FILLED"]),
  CANCELED: new Set(["CANCELED", "FILLED"]),
  REJECTED: new Set(["REJECTED"]),
  EXPIRED: new Set(["EXPIRED", "FILLED"]),
})

function sameOrderIntent({
    current,
    next,
  }) {
  return current.market.id === next.market.id &&
    current.side === next.side &&
    current.type === next.type &&
    current.originalQuantity.amount === next.originalQuantity.amount &&
    current.limitPrice?.amount === next.limitPrice?.amount
}

function sameOrderState({ current, next }) {
  return JSON.stringify(current.value) === JSON.stringify(next.value)
}

function isStaleOrderUpdate({ current, next }) {
  if (
    compareDecimal({
      left: next.executedQuantity.amount,
      right: current.executedQuantity.amount,
    }) > 0
  ) {
    return false
  }
  // FILLED is terminal: a later non-terminal snapshot with no additional
  // execution cannot reopen the order, regardless of event timestamp. Binance
  // may deliver/replay the original NEW report after the submission response
  // has already established the fully executed state.
  if (
    current.status === "FILLED" &&
    ["OPEN", "PARTIALLY_FILLED"].includes(next.status)
  ) {
    return true
  }
  if (
    current.updatedAt !== undefined &&
    (next.updatedAt === undefined || next.updatedAt < current.updatedAt)
  ) {
    return true
  }
  if (
    ["CANCELED", "EXPIRED"].includes(current.status) &&
    ["OPEN", "PARTIALLY_FILLED"].includes(next.status) &&
    compareDecimal({
      left: next.executedQuantity.amount,
      right: current.executedQuantity.amount,
    }) <= 0
  ) {
    // A delayed non-terminal report may arrive after the cancellation
    // response. The cancellation snapshot and fill history remain authoritative.
    return true
  }
  // UNKNOWN may mean the placement acknowledgement was lost, so its first
  // identity-matching exchange NEW report must be allowed to establish ownership.
  return current.status === "PARTIALLY_FILLED" &&
    next.status === "OPEN"
}

function validateProviderIdentityUnchanged({
    current,
    next,
  }) {
  const fields = ["providerInstanceId", "providerType", "accountId"]
  const currentHasIdentity = fields.some((field) => current[field] !== undefined)
  const nextHasIdentity = fields.some((field) => next[field] !== undefined)
  if (!currentHasIdentity && nextHasIdentity) {
    throw new Error("Cannot assign provider provenance to a legacy canonical order from an exchange update")
  }
  for (const field of fields) {
    if (next[field] !== undefined && current[field] !== undefined && next[field] !== current[field]) {
      throw new Error(`Canonical order update changed immutable ${field}`)
    }
  }
}

function validateOrderProgress({
    current,
    next,
  }) {
  if (compareDecimal({
    left: next.executedQuantity.amount,
    right: current.executedQuantity.amount,
  }) < 0) {
    throw new Error("Canonical order executed quantity cannot move backwards")
  }
  if (current.updatedAt !== undefined && next.updatedAt !== undefined &&
      next.updatedAt < current.updatedAt) {
    throw new Error("Canonical order update timestamp cannot move backwards")
  }
}

function validateOrderStatusTransition({
    current,
    next,
  }) {
  if (!ALLOWED_TRANSITIONS[current.status]?.has(next.status)) {
    throw new Error(
      `Invalid canonical order status transition: ${current.status} -> ${next.status}`,
    )
  }
  if ((current.status === "REJECTED" || next.status === "REJECTED") &&
      next.executedQuantity.amount !== current.executedQuantity.amount) {
    throw new Error("Rejected orders cannot have changing executed quantity")
  }
}

function validateOrderUpdate({ current, next }) {
  validateProviderIdentityUnchanged({
    current,
    next,
  })
  if (!sameOrderIntent({
    current,
    next,
  })) {
    throw new Error("Canonical order update changed immutable order intent")
  }
  if (current.brokerOrderId !== undefined && current.brokerOrderId !== next.brokerOrderId) {
    throw new Error("Canonical order update changed brokerOrderId")
  }
  validateOrderProgress({
    current,
    next,
  })
  validateOrderStatusTransition({
    current,
    next,
  })
}

function findOrderUpdateIndex({ orders, order } = {}) {
  const brokerIdIndex = order.brokerOrderId === undefined
    ? -1
    : orders.findIndex((item) => item.brokerOrderId === order.brokerOrderId)
  const clientIdIndex = orders.findIndex((item) => item.clientOrderId === order.clientOrderId)
  if (brokerIdIndex >= 0 && clientIdIndex >= 0 && brokerIdIndex !== clientIdIndex) {
    throw new Error("Order update brokerOrderId and clientOrderId identify different registered orders")
  }
  return brokerIdIndex >= 0 ? brokerIdIndex : clientIdIndex
}

function createNextCanonicalOrder({ current, order } = {}) {
  validateProviderIdentityUnchanged({
    current,
    next: order,
  })
  if (current.clientOrderId === order.clientOrderId &&
      current.providerInstanceId === order.providerInstanceId &&
      current.providerType === order.providerType &&
      current.accountId === order.accountId) {
    return order
  }
  return new CanonicalOrder({
    clientOrderId: current.clientOrderId,
    providerInstanceId: current.providerInstanceId ?? order.providerInstanceId,
    providerType: current.providerType ?? order.providerType,
    accountId: current.accountId ?? order.accountId,
    brokerOrderId: order.brokerOrderId,
    market: order.market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: order.executedQuantity,
    status: order.status,
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt: order.updatedAt,
    completedAt: order.completedAt,
  })
}

/**
 * Immutable registry of Harvester-owned canonical orders and their application-owned attribution.
 *
 * Order ownership is keyed by Harvester's original clientOrderId and linked to the brokerOrderId
 * once the exchange identity is known. Unknown exchange orders are deliberately not adopted.
 */


export class OrderRegistry {
  #orders
  #ownerships

  constructor({ orders = [], ownerships = [] } = {}) {
    if (!Array.isArray(orders) || orders.some((order) => !(order instanceof CanonicalOrder))) {
      throw new TypeError("OrderRegistry.orders must contain CanonicalOrder values")
    }
    const clientOrderIds = orders.map((order) => order.clientOrderId)
    const brokerOrderIds = orders
      .map((order) => order.brokerOrderId)
      .filter((id) => id !== undefined)
    if (new Set(clientOrderIds).size !== clientOrderIds.length) {
      throw new TypeError("OrderRegistry cannot contain duplicate clientOrderIds")
    }
    if (new Set(brokerOrderIds).size !== brokerOrderIds.length) {
      throw new TypeError("OrderRegistry cannot contain duplicate brokerOrderIds")
    }

    this.#orders = Object.freeze([...orders])
    this.#ownerships = validateOrderOwnerships({ orders,
ownerships })
    Object.freeze(this)
  }

  get orders() { return this.#orders }
  get ownerships() { return this.#ownerships }

  getOrder({ clientOrderId } = {}) {
    if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
      throw new TypeError("OrderRegistry.getOrder requires clientOrderId")
    }
    return this.#orders.find((order) => order.clientOrderId === clientOrderId)
  }

  getOrderByBrokerOrderId({ brokerOrderId } = {}) {
    if (typeof brokerOrderId !== "string" || !brokerOrderId.trim()) {
      throw new TypeError("OrderRegistry.getOrderByBrokerOrderId requires brokerOrderId")
    }
    return this.#orders.find((order) => order.brokerOrderId === brokerOrderId)
  }

  getOwnership({ clientOrderId, brokerOrderId } = {}) {
    return findOrderOwnership({
      ownerships: this.#ownerships,
      clientOrderId,
      brokerOrderId,
    })
  }

  getActiveOrders({ marketId } = {}) {
    return this.#orders.filter((order) =>
      ACTIVE_STATUSES.has(order.status) &&
      (marketId === undefined || order.market.id === marketId),
    )
  }

  getTerminalOrders({ marketId } = {}) {
    return this.#orders.filter((order) =>
      TERMINAL_STATUSES.has(order.status) &&
      (marketId === undefined || order.market.id === marketId),
    )
  }

  registerPending({ order, ownership } = {}) {
    if (!(order instanceof CanonicalOrder) || order.status !== "PENDING") {
      throw new TypeError("OrderRegistry.registerPending requires a PENDING CanonicalOrder")
    }
    const existing = this.getOrder({ clientOrderId: order.clientOrderId })
    const nextOwnership = ownership === undefined
      ? undefined
      : createOrderOwnership({
          ownership,
          clientOrderId: order.clientOrderId,
          brokerOrderId: order.brokerOrderId,
        })
    if (existing) {
      if (!sameOrderState({ current: existing,
next: order })) {
        throw new Error(`Conflicting pending order reused clientOrderId ${order.clientOrderId}`)
      }
      const existingOwnership = this.getOwnership({ clientOrderId: order.clientOrderId })
      if (nextOwnership !== undefined &&
          (!existingOwnership || !hasSameOrderOwnership({
            current: existingOwnership,
            next: nextOwnership,
          }))) {
        throw new Error(`Conflicting order ownership reused clientOrderId ${order.clientOrderId}`)
      }
      return Object.freeze({ registry: this,
applied: false,
duplicate: true })
    }
    if (order.brokerOrderId !== undefined) {
      throw new Error("Pending order cannot already have a brokerOrderId")
    }
    return Object.freeze({
      registry: new OrderRegistry({
        orders: [...this.#orders, order],
        ownerships: nextOwnership === undefined
          ? this.#ownerships
          : [...this.#ownerships, nextOwnership],
      }),
      applied: true,
      duplicate: false,
    })
  }

  removePending({ clientOrderId } = {}) {
    if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
      throw new TypeError("OrderRegistry.removePending requires clientOrderId")
    }
    const current = this.getOrder({ clientOrderId })
    if (!current) {
      return Object.freeze({ registry: this,
removed: false })
    }
    if (current.status !== "PENDING") {
      throw new Error("OrderRegistry can remove only a PENDING order")
    }
    return Object.freeze({
      registry: new OrderRegistry({
        orders: this.#orders.filter((order) => order.clientOrderId !== clientOrderId),
        ownerships: this.#ownerships.filter((ownership) => ownership.clientOrderId !== clientOrderId),
      }),
      removed: true,
    })
  }

  markUnknown({ clientOrderId } = {}) {
    try {
      if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
        throw new TypeError("markUnknown requires a non-empty clientOrderId")
      }
      const index = this.#orders.findIndex((order) => order.clientOrderId === clientOrderId)
      if (index < 0) {throw new Error("Cannot mark an unregistered order UNKNOWN")}
      const current = this.#orders[index]
      if (current.status === "UNKNOWN") {
        return toResult({ data: { registry: this,
order: current,
applied: false,
duplicate: true } })
      }
      if (current.status !== "PENDING") {
        return toResult({ data: { registry: this,
order: current,
applied: false,
alreadyAcknowledged: true } })
      }
      const unknownOrder = new CanonicalOrder({
        clientOrderId: current.clientOrderId,
        providerInstanceId: current.providerInstanceId,
        providerType: current.providerType,
        accountId: current.accountId,
        brokerOrderId: current.brokerOrderId,
        market: current.market,
        side: current.side,
        type: current.type,
        limitPrice: current.limitPrice,
        originalQuantity: current.originalQuantity,
        executedQuantity: current.executedQuantity,
        status: "UNKNOWN",
        createdAt: current.createdAt,
        acknowledgedAt: current.acknowledgedAt,
        updatedAt: current.updatedAt,
        completedAt: current.completedAt,
      })
      validateOrderUpdate({ current,
next: unknownOrder })
      const orders = [...this.#orders]
      orders[index] = unknownOrder
      return toResult({
        data: {
          registry: new OrderRegistry({
            orders,
            ownerships: this.#ownerships,
          }),
          order: unknownOrder,
          applied: true,
          duplicate: false,
        },
      })
    } catch (error) {
      return toResult({ error })
    }
  }

  markCancellationUnknown({ clientOrderId } = {}) {
    try {
      if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
        throw new TypeError("markCancellationUnknown requires a non-empty clientOrderId")
      }
      const index = this.#orders.findIndex((order) => order.clientOrderId === clientOrderId)
      if (index < 0) {throw new Error("Cannot mark an unregistered order UNKNOWN")}
      const current = this.#orders[index]
      if (current.status === "UNKNOWN") {
        return toResult({ data: { registry: this,
order: current,
applied: false,
duplicate: true } })
      }
      if (!["OPEN", "PARTIALLY_FILLED"].includes(current.status)) {
        return toResult({ data: { registry: this,
order: current,
applied: false,
alreadyTerminal: true } })
      }
      const unknownOrder = new CanonicalOrder({
        clientOrderId: current.clientOrderId,
        brokerOrderId: current.brokerOrderId,
        providerInstanceId: current.providerInstanceId,
        providerType: current.providerType,
        accountId: current.accountId,
        market: current.market,
        side: current.side,
        type: current.type,
        limitPrice: current.limitPrice,
        originalQuantity: current.originalQuantity,
        executedQuantity: current.executedQuantity,
        status: "UNKNOWN",
        createdAt: current.createdAt,
        acknowledgedAt: current.acknowledgedAt,
        updatedAt: current.updatedAt,
        completedAt: current.completedAt,
      })
      validateOrderUpdate({ current,
next: unknownOrder })
      const orders = [...this.#orders]
      orders[index] = unknownOrder
      return toResult({
        data: {
          registry: new OrderRegistry({
            orders,
            ownerships: this.#ownerships,
          }),
          order: unknownOrder,
          applied: true,
          duplicate: false,
        },
      })
    } catch (error) {
      return toResult({ error })
    }
  }

  attachAcknowledgedBrokerOrderId({ order } = {}) {
    return createAcknowledgedOrderAttachment({
      registry: this,
      orders: this.#orders,
      ownerships: this.#ownerships,
      order,
    })
  }

  applyUpdate({ order } = {}) {
    return applyCanonicalOrderUpdate({
      registry: this,
      orders: this.#orders,
      ownerships: this.#ownerships,
      order,
    })
  }

  static empty() {
    return new OrderRegistry()
  }

  get value() {
    return Object.freeze({
      orders: this.#orders.map((order) => order.value),
      ownerships: Object.freeze(this.#ownerships.map((ownership) => Object.freeze({ ...ownership }))),
    })
  }
}


function isDuplicateAcknowledgement({
    current,
    order,
  }) {
  return current.brokerOrderId === order.brokerOrderId &&
    (current.status === "UNKNOWN" || current.brokerOrderId !== undefined)
}

function validateAcknowledgementCanAttach({
    current,
    orders,
    order,
  }) {
  if (!["PENDING", "UNKNOWN"].includes(current.status)) {
    throw new Error("Only a PENDING or unresolved UNKNOWN order can receive its acknowledged brokerOrderId")
  }
  if (current.brokerOrderId !== undefined && current.brokerOrderId !== order.brokerOrderId) {
    throw new Error("Acknowledged order changed brokerOrderId")
  }
  if (orders.some((item) => item.brokerOrderId === order.brokerOrderId)) {
    throw new Error("Broker order ID is already owned by another Harvester order")
  }
}

function createAcknowledgedCanonicalOrder({
    current,
    order,
  }) {
  return new CanonicalOrder({
    clientOrderId: current.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    providerInstanceId: current.providerInstanceId ?? order.providerInstanceId,
    providerType: current.providerType ?? order.providerType,
    accountId: current.accountId ?? order.accountId,
    market: current.market,
    side: current.side,
    type: current.type,
    limitPrice: current.limitPrice,
    originalQuantity: current.originalQuantity,
    executedQuantity: current.executedQuantity,
    status: "UNKNOWN",
    createdAt: order.createdAt ?? current.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt: order.updatedAt,
  })
}

function createAcknowledgedRegistryResult({ registry, orders, ownerships, index, current, order, attached }) {
  const nextOrders = [...orders]
  nextOrders[index] = attached
  return Object.freeze({
    registry: new OrderRegistry({
      orders: nextOrders,
      ownerships: attachBrokerOrderIdToOwnership({
        ownerships,
        clientOrderId: current.clientOrderId,
        brokerOrderId: order.brokerOrderId,
      }),
    }),
    applied: true,
    duplicate: false,
  })
}

function createAcknowledgedOrderAttachment({ registry, orders, ownerships, order }) {
  if (!(order instanceof CanonicalOrder) || order.status === "PENDING" ||
      typeof order.brokerOrderId !== "string" || !order.brokerOrderId.trim()) {
    throw new TypeError("OrderRegistry.attachAcknowledgedBrokerOrderId requires an acknowledged order with brokerOrderId")
  }
  const index = orders.findIndex((item) => item.clientOrderId === order.clientOrderId)
  if (index < 0) {
    throw new Error("Acknowledged order is not registered by clientOrderId")
  }
  const current = orders[index]
  validateProviderIdentityUnchanged({
    current,
    next: order,
  })
  if (!sameOrderIntent({
    current,
    next: order,
  })) {
    throw new Error("Broker acknowledgement changed immutable order intent")
  }
  if (isDuplicateAcknowledgement({
    current,
    order,
  })) {
    return Object.freeze({
      registry,
      applied: false,
      duplicate: true,
    })
  }
  validateAcknowledgementCanAttach({
    current,
    orders,
    order,
  })
  const attached = createAcknowledgedCanonicalOrder({ current, order })
  return createAcknowledgedRegistryResult({
    registry,
    orders,
    ownerships,
    index,
    current,
    order,
    attached,
  })
}

function createUpdatedOrderRegistryResult({ registry, orders, ownerships, index, current, nextOrder }) {
  const nextOrders = [...orders]
  nextOrders[index] = nextOrder
  const nextOwnerships = nextOrder.brokerOrderId === undefined
    ? ownerships
    : attachBrokerOrderIdToOwnership({
        ownerships,
        clientOrderId: current.clientOrderId,
        brokerOrderId: nextOrder.brokerOrderId,
      })
  return Object.freeze({
    registry: new OrderRegistry({
      orders: nextOrders,
      ownerships: nextOwnerships,
    }),
    applied: true,
    duplicate: false,
    stale: false,
    unknown: false,
  })
}

function unchangedOrderUpdate({ registry, stale = false, duplicate = false } = {}) {
  return Object.freeze({
    registry,
    applied: false,
    duplicate,
    stale,
    unknown: false,
  })
}

function unknownOrderUpdateResult({ registry }) {
  return Object.freeze({
    registry,
    applied: false,
    duplicate: false,
    stale: false,
    unknown: true,
  })
}

function applyCanonicalOrderUpdate({ registry, orders, ownerships, order }) {
  if (!(order instanceof CanonicalOrder) || order.status === "PENDING") {
    throw new TypeError("OrderRegistry.applyUpdate requires a broker-acknowledged CanonicalOrder")
  }
  const index = findOrderUpdateIndex({
    orders,
    order,
  })
  if (index < 0) {
    return unknownOrderUpdateResult({ registry })
  }
  const current = orders[index]
  if (current.brokerOrderId !== undefined && current.brokerOrderId !== order.brokerOrderId) {
    throw new Error("Canonical order update changed brokerOrderId")
  }
  const nextOrder = createNextCanonicalOrder({
    current,
    order,
  })
  const intentMatches = sameOrderIntent({
    current,
    next: nextOrder,
  })
  const brokerIdentityMatches = current.brokerOrderId === undefined ||
    current.brokerOrderId === nextOrder.brokerOrderId
  if (intentMatches && brokerIdentityMatches && isStaleOrderUpdate({
      current,
      next: nextOrder,
    })) {
    return unchangedOrderUpdate({
      registry,
      stale: true,
    })
  }
  validateOrderUpdate({
    current,
    next: nextOrder,
  })
  if (sameOrderState({
    current,
    next: nextOrder,
  })) {
    return unchangedOrderUpdate({
      registry,
      duplicate: true,
    })
  }
  return createUpdatedOrderRegistryResult({
    registry,
    orders,
    ownerships,
    index,
    current,
    nextOrder,
  })
}
