import { Market } from "../markets/market.js"
import { Money } from "../money/money.js"
import { Quantity } from "../quantity/quantity.js"

export const TRADING_RULE_CONSTRAINT_TYPES = Object.freeze([
  "PRICE_INCREMENT",
  "MIN_PRICE",
  "MAX_PRICE",
  "QUANTITY_INCREMENT",
  "MIN_QUANTITY",
  "MAX_QUANTITY",
  "MIN_NOTIONAL",
  "MAX_NOTIONAL",
])

export const TRADING_RULE_STATUSES = Object.freeze([
  "SUPPORTED",
  "UNSUPPORTED",
  "DYNAMIC",
  "UNKNOWN",
])

const moneyConstraintTypes = new Set([
  "PRICE_INCREMENT",
  "MIN_PRICE",
  "MAX_PRICE",
  "MIN_NOTIONAL",
  "MAX_NOTIONAL",
])

const incrementConstraintTypes = new Set([
  "PRICE_INCREMENT",
  "QUANTITY_INCREMENT",
])

export const tradingRulesErrMsgs = {
  market: "TradingRules.market should be a Market",
  constraints: "TradingRules.constraints should be an array",
  constraint: "TradingRules.constraints should contain valid constraint objects",
  type: "TradingRules constraint type is unsupported",
  status: "TradingRules constraint status is unsupported",
  duplicate: "TradingRules constraint types should be unique",
  value: "SUPPORTED TradingRules constraints require a Money or Quantity value",
  unsupportedValue: "Non-SUPPORTED TradingRules constraints must not include a value",
  asset: "TradingRules constraint value should use the Market asset for its type",
  negativeValue: "TradingRules constraint values should be non-negative",
  positiveIncrement: "TradingRules increments should be greater than zero",
}

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const compareDecimalStrings = ({ left, right }) => {
  const [leftWhole, leftFraction = ""] = left.split(".")
  const [rightWhole, rightFraction = ""] = right.split(".")
  const scale = Math.max(leftFraction.length, rightFraction.length)
  const leftValue = BigInt(`${leftWhole}${leftFraction}`) * 10n ** BigInt(scale - leftFraction.length)
  const rightValue = BigInt(`${rightWhole}${rightFraction}`) * 10n ** BigInt(scale - rightFraction.length)

  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

const normalizeConstraint = ({ constraint, market }) => {
  if (!isRecord(constraint)) {
    throw new Error(tradingRulesErrMsgs.constraint)
  }
  const { type, status, value } = constraint

  if (!TRADING_RULE_CONSTRAINT_TYPES.includes(type)) {
    throw new Error(tradingRulesErrMsgs.type)
  }
  if (!TRADING_RULE_STATUSES.includes(status)) {
    throw new Error(tradingRulesErrMsgs.status)
  }

  if (status !== "SUPPORTED") {
    if (value !== undefined) {
      throw new Error(tradingRulesErrMsgs.unsupportedValue)
    }
    return Object.freeze({ type, status })
  }

  const expectedType = moneyConstraintTypes.has(type) ? Money : Quantity
  if (!(value instanceof expectedType)) {
    throw new Error(tradingRulesErrMsgs.value)
  }

  const expectedAsset = moneyConstraintTypes.has(type)
    ? market.quoteAsset
    : market.baseAsset
  if (value.asset.id !== expectedAsset.id) {
    throw new Error(tradingRulesErrMsgs.asset)
  }
  if (value.amount.startsWith("-")) {
    throw new Error(tradingRulesErrMsgs.negativeValue)
  }
  if (incrementConstraintTypes.has(type) && value.amount === "0") {
    throw new Error(tradingRulesErrMsgs.positiveIncrement)
  }

  return Object.freeze({ type, status, value })
}

export class TradingRules {
  #market
  #constraints

  constructor({ market, constraints = [] } = {}) {
    if (!(market instanceof Market)) {
      throw new Error(tradingRulesErrMsgs.market)
    }
    if (
      !Array.isArray(constraints) ||
      Array.from(constraints).some((constraint) => constraint === undefined)
    ) {
      throw new Error(tradingRulesErrMsgs.constraints)
    }

    const normalizedConstraints = constraints.map((constraint) =>
      normalizeConstraint({ constraint, market }),
    )
    const types = normalizedConstraints.map(({ type }) => type)
    if (new Set(types).size !== types.length) {
      throw new Error(tradingRulesErrMsgs.duplicate)
    }

    const supported = new Map(
      normalizedConstraints
        .filter(({ status }) => status === "SUPPORTED")
        .map(({ type, value }) => [type, value.amount]),
    )
    for (const [minimum, maximum] of [
      ["MIN_PRICE", "MAX_PRICE"],
      ["MIN_QUANTITY", "MAX_QUANTITY"],
      ["MIN_NOTIONAL", "MAX_NOTIONAL"],
    ]) {
      if (
        supported.has(minimum) &&
        supported.has(maximum) &&
        compareDecimalStrings({
          left: supported.get(minimum),
          right: supported.get(maximum),
        }) > 0
      ) {
        throw new Error(`TradingRules.${minimum} cannot exceed ${maximum}`)
      }
    }

    this.#market = market
    this.#constraints = Object.freeze(normalizedConstraints)

    Object.freeze(this)
  }

  get market() {
    return this.#market
  }

  get constraints() {
    return this.#constraints
  }

  get value() {
    return {
      market: this.#market.value,
      constraints: this.#constraints.map(({ type, status, value }) => ({
        type,
        status,
        ...(value === undefined ? {} : { value: value.value }),
      })),
    }
  }
}
