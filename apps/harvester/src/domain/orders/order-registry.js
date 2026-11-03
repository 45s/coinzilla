import { CanonicalOrder } from "@coinzilla/entities"
import { compareDecimal } from "@coinzilla/utils"

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

function sameOrderIntent({ current, next }) {
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
  return current.status !== "PENDING" &&
    next.status === "OPEN" &&
    current.status !== "OPEN"
}

function validateOrderUpdate({ current, next }) {
  if (!sameOrderIntent({ current, next })) {
    throw new Error("Canonical order update changed immutable order intent")
  }
  if (
    current.brokerOrderId !== undefined &&
    current.brokerOrderId !== next.brokerOrderId
  ) {
    throw new Error("Canonical order update changed brokerOrderId")
  }
  if (
    compareDecimal({
      left: next.executedQuantity.amount,
      right: current.executedQuantity.amount,
    }) < 0
  ) {
    throw new Error("Canonical order executed quantity cannot move backwards")
  }
  if (
    current.updatedAt !== undefined &&
    next.updatedAt !== undefined &&
    next.updatedAt < current.updatedAt
  ) {
    throw new Error("Canonical order update timestamp cannot move backwards")
  }
  if (!ALLOWED_TRANSITIONS[current.status]?.has(next.status)) {
    throw new Error(
      "Invalid canonical order status transition: " + current.status + " -> " + next.status,
    )
  }
  if (
    (current.status === "REJECTED" || next.status === "REJECTED") &&
    next.executedQuantity.amount !== current.executedQuantity.amount
  ) {
    throw new Error("Rejected orders cannot have changing executed quantity")
  }
}

/**
 * Immutable registry of Harvester-owned canonical orders.
 *
 * Unknown exchange orders are deliberately not adopted. The caller must
 * reconcile them separately before treating account state as fully known.
 */
export class OrderRegistry {
  #orders

  constructor({ orders = [] } = {}) {
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
    Object.freeze(this)
  }

  get orders() { return this.#orders }

  getOrder({ clientOrderId } = {}) {
    if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
      throw new TypeError("OrderRegistry.getOrder requires clientOrderId")
    }
    return this.#orders.find((order) => order.clientOrderId === clientOrderId)
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

  registerPending({ order } = {}) {
    if (!(order instanceof CanonicalOrder) || order.status !== "PENDING") {
      throw new TypeError("OrderRegistry.registerPending requires a PENDING CanonicalOrder")
    }
    const existing = this.getOrder({ clientOrderId: order.clientOrderId })
    if (existing) {
      if (!sameOrderState({ current: existing, next: order })) {
        throw new Error("Conflicting pending order reused clientOrderId " + order.clientOrderId)
      }
      return Object.freeze({ registry: this, applied: false, duplicate: true })
    }
    if (order.brokerOrderId !== undefined) {
      throw new Error("Pending order cannot already have a brokerOrderId")
    }
    return Object.freeze({
      registry: new OrderRegistry({ orders: [...this.#orders, order] }),
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
      return Object.freeze({ registry: this, removed: false })
    }
    if (current.status !== "PENDING") {
      throw new Error("OrderRegistry can remove only a PENDING order")
    }
    return Object.freeze({
      registry: new OrderRegistry({
        orders: this.#orders.filter((order) => order.clientOrderId !== clientOrderId),
      }),
      removed: true,
    })
  }

  applyUpdate({ order } = {}) {
    if (!(order instanceof CanonicalOrder) || order.status === "PENDING") {
      throw new TypeError("OrderRegistry.applyUpdate requires a broker-acknowledged CanonicalOrder")
    }
    const index = this.#orders.findIndex((item) => item.clientOrderId === order.clientOrderId)
    if (index < 0) {
      return Object.freeze({
        registry: this,
        applied: false,
        duplicate: false,
        unknown: true,
      })
    }

    const current = this.#orders[index]
    if (
      sameOrderIntent({ current, next: order }) &&
      (current.brokerOrderId === undefined || current.brokerOrderId === order.brokerOrderId) &&
      isStaleOrderUpdate({ current, next: order })
    ) {
      return Object.freeze({
        registry: this,
        applied: false,
        duplicate: false,
        stale: true,
        unknown: false,
      })
    }
    validateOrderUpdate({ current, next: order })
    if (sameOrderState({ current, next: order })) {
      return Object.freeze({
        registry: this,
        applied: false,
        duplicate: true,
        stale: false,
        unknown: false,
      })
    }

    const orders = this.#orders.map((item, itemIndex) =>
      itemIndex === index ? order : item,
    )
    return Object.freeze({
      registry: new OrderRegistry({ orders }),
      applied: true,
      duplicate: false,
      stale: false,
      unknown: false,
    })
  }

  static empty() {
    return new OrderRegistry()
  }

  get value() {
    return Object.freeze({
      orders: this.#orders.map((order) => order.value),
    })
  }
}
