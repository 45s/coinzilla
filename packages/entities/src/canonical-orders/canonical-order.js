import { Market } from "../markets/market.js"
import { Money } from "../money/money.js"
import { Quantity } from "../quantity/quantity.js"
import { subtractDecimalStrings } from "../values/subtract-decimal-strings.js"

export const CANONICAL_ORDER_SIDES = Object.freeze(["BUY", "SELL"])
export const CANONICAL_ORDER_TYPES = Object.freeze(["LIMIT", "LIMIT_MAKER", "MARKET"])
export const CANONICAL_ORDER_STATUSES = Object.freeze([
  "PENDING",
  "OPEN",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
  "UNKNOWN",
])
const brokerAcknowledgedStatuses = [
  "OPEN",
  "PARTIALLY_FILLED",
  "FILLED",
  "CANCELED",
  "EXPIRED",
]

export const canonicalOrderErrMsgs = {
  clientOrderId: "CanonicalOrder.clientOrderId should be a non-empty string",
  brokerOrderId: "CanonicalOrder.brokerOrderId should be a non-empty string",
  market: "CanonicalOrder.market should be a Market",
  side: "CanonicalOrder.side should be BUY or SELL",
  type: "CanonicalOrder.type is unsupported",
  status: "CanonicalOrder.status is unsupported",
  limitPrice: "CanonicalOrder.limitPrice should be Money for limit orders",
  marketPrice: "CanonicalOrder.limitPrice is not allowed for market orders",
  priceAsset: "CanonicalOrder.limitPrice should use the market quote Asset",
  limitPricePositive: "CanonicalOrder.limitPrice should be greater than zero",
  originalQuantity: "CanonicalOrder.originalQuantity should be a Quantity",
  executedQuantity: "CanonicalOrder.executedQuantity should be a Quantity",
  quantityAsset: "CanonicalOrder quantities should use the market base Asset",
  positiveQuantity: "CanonicalOrder.originalQuantity should be greater than zero",
  executedRange: "CanonicalOrder.executedQuantity cannot exceed originalQuantity",
  brokerAcknowledgement: "Acknowledged CanonicalOrder status requires brokerOrderId",
  pendingBrokerId: "Pending CanonicalOrder cannot have brokerOrderId",
  pendingExecution: "Pending CanonicalOrder cannot have executed quantity",
  openExecution: "Open CanonicalOrder cannot have executed quantity",
  partialExecution: "Partially filled CanonicalOrder requires executed and remaining quantity",
  filledExecution: "Filled CanonicalOrder must have zero remaining quantity",
  timestamp: "CanonicalOrder timestamps should be non-negative safe integers",
}

const isNonEmptyString = (value) =>
  typeof value === "string" && Boolean(value.trim())

function validateTimestamp({ value }) {
  return value === undefined ||
    (Number.isSafeInteger(value) && value >= 0)
}

export class CanonicalOrder {
  #clientOrderId
  #brokerOrderId
  #market
  #side
  #type
  #limitPrice
  #originalQuantity
  #executedQuantity
  #remainingQuantity
  #status
  #createdAt
  #acknowledgedAt
  #updatedAt
  #completedAt

  constructor({
    clientOrderId,
    brokerOrderId,
    market,
    side,
    type,
    limitPrice,
    originalQuantity,
    executedQuantity,
    status = "PENDING",
    createdAt,
    acknowledgedAt,
    updatedAt,
    completedAt,
  } = {}) {
    if (typeof clientOrderId !== "string" || !clientOrderId.trim()) {
      throw new Error(canonicalOrderErrMsgs.clientOrderId)
    }
    if (
      brokerOrderId !== undefined &&
      brokerOrderId !== null &&
      (typeof brokerOrderId !== "string" || !brokerOrderId.trim())
    ) {
      throw new Error(canonicalOrderErrMsgs.brokerOrderId)
    }
    if (!(market instanceof Market)) {
      throw new Error(canonicalOrderErrMsgs.market)
    }
    if (!CANONICAL_ORDER_SIDES.includes(side)) {
      throw new Error(canonicalOrderErrMsgs.side)
    }
    if (!CANONICAL_ORDER_TYPES.includes(type)) {
      throw new Error(canonicalOrderErrMsgs.type)
    }
    if (!CANONICAL_ORDER_STATUSES.includes(status)) {
      throw new Error(canonicalOrderErrMsgs.status)
    }

    const normalizedLimitPrice = limitPrice ?? undefined
    if (type === "MARKET" && normalizedLimitPrice !== undefined) {
      throw new Error(canonicalOrderErrMsgs.marketPrice)
    }
    if (
      type !== "MARKET" &&
      !(normalizedLimitPrice instanceof Money)
    ) {
      throw new Error(canonicalOrderErrMsgs.limitPrice)
    }
    if (
      normalizedLimitPrice &&
      normalizedLimitPrice.asset.id !== market.quoteAsset.id
    ) {
      throw new Error(canonicalOrderErrMsgs.priceAsset)
    }
    if (
      normalizedLimitPrice &&
      (normalizedLimitPrice.amount === "0" || normalizedLimitPrice.amount.startsWith("-"))
    ) {
      throw new Error(canonicalOrderErrMsgs.limitPricePositive)
    }

    if (!(originalQuantity instanceof Quantity)) {
      throw new Error(canonicalOrderErrMsgs.originalQuantity)
    }
    if (!(executedQuantity instanceof Quantity)) {
      throw new Error(canonicalOrderErrMsgs.executedQuantity)
    }
    if (
      originalQuantity.asset.id !== market.baseAsset.id ||
      executedQuantity.asset.id !== market.baseAsset.id
    ) {
      throw new Error(canonicalOrderErrMsgs.quantityAsset)
    }
    if (originalQuantity.amount === "0") {
      throw new Error(canonicalOrderErrMsgs.positiveQuantity)
    }

    const remainingResult = subtractDecimalStrings({
      left: originalQuantity.amount,
      right: executedQuantity.amount,
    })
    if (!remainingResult.ok) {
      throw remainingResult.errors[0]
    }
    if (remainingResult.value.startsWith("-")) {
      throw new Error(canonicalOrderErrMsgs.executedRange)
    }

    const remainingQuantity = new Quantity({
      amount: remainingResult.value,
      asset: market.baseAsset,
    })

    if (brokerAcknowledgedStatuses.includes(status) && !isNonEmptyString(brokerOrderId)) {
      throw new Error(canonicalOrderErrMsgs.brokerAcknowledgement)
    }
    if (status === "PENDING" && brokerOrderId != null) {
      throw new Error(canonicalOrderErrMsgs.pendingBrokerId)
    }
    if (status === "PENDING" && executedQuantity.amount !== "0") {
      throw new Error(canonicalOrderErrMsgs.pendingExecution)
    }
    if (status === "OPEN" && executedQuantity.amount !== "0") {
      throw new Error(canonicalOrderErrMsgs.openExecution)
    }
    if (
      status === "PARTIALLY_FILLED" &&
      (executedQuantity.amount === "0" || remainingQuantity.amount === "0")
    ) {
      throw new Error(canonicalOrderErrMsgs.partialExecution)
    }
    if (status === "FILLED" && remainingQuantity.amount !== "0") {
      throw new Error(canonicalOrderErrMsgs.filledExecution)
    }

    for (const timestamp of [createdAt, acknowledgedAt, updatedAt, completedAt]) {
      if (timestamp !== undefined && (!Number.isSafeInteger(timestamp) || timestamp < 0)) {
        throw new Error(canonicalOrderErrMsgs.timestamp)
      }
    }

    this.#clientOrderId = clientOrderId.trim()
    this.#brokerOrderId = brokerOrderId == null ? undefined : brokerOrderId.trim()
    this.#market = market
    this.#side = side
    this.#type = type
    this.#limitPrice = normalizedLimitPrice
    this.#originalQuantity = originalQuantity
    this.#executedQuantity = executedQuantity
    this.#remainingQuantity = remainingQuantity
    this.#status = status
    this.#createdAt = createdAt
    this.#acknowledgedAt = acknowledgedAt
    this.#updatedAt = updatedAt
    this.#completedAt = completedAt

    Object.freeze(this)
  }

  get clientOrderId() {
    return this.#clientOrderId
  }

  get brokerOrderId() {
    return this.#brokerOrderId
  }

  get market() {
    return this.#market
  }

  get side() {
    return this.#side
  }

  get type() {
    return this.#type
  }

  get limitPrice() {
    return this.#limitPrice
  }

  get originalQuantity() {
    return this.#originalQuantity
  }

  get executedQuantity() {
    return this.#executedQuantity
  }

  get remainingQuantity() {
    return this.#remainingQuantity
  }

  get status() {
    return this.#status
  }

  get createdAt() {
    return this.#createdAt
  }

  get acknowledgedAt() {
    return this.#acknowledgedAt
  }

  get updatedAt() {
    return this.#updatedAt
  }

  get completedAt() {
    return this.#completedAt
  }

  get value() {
    return {
      clientOrderId: this.#clientOrderId,
      ...(this.#brokerOrderId === undefined ? {} : { brokerOrderId: this.#brokerOrderId }),
      market: this.#market.value,
      side: this.#side,
      type: this.#type,
      ...(this.#limitPrice === undefined ? {} : { limitPrice: this.#limitPrice.value }),
      originalQuantity: this.#originalQuantity.value,
      executedQuantity: this.#executedQuantity.value,
      remainingQuantity: this.#remainingQuantity.value,
      status: this.#status,
      ...(this.#createdAt === undefined ? {} : { createdAt: this.#createdAt }),
      ...(this.#acknowledgedAt === undefined ? {} : { acknowledgedAt: this.#acknowledgedAt }),
      ...(this.#updatedAt === undefined ? {} : { updatedAt: this.#updatedAt }),
      ...(this.#completedAt === undefined ? {} : { completedAt: this.#completedAt }),
    }
  }
}
