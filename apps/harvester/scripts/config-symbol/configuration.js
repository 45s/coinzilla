import {
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  normalizeDecimalString,
  roundDecimalToIncrement,
} from "@coinzilla/utils"
import { validateAppConfig } from "../../src/domain/app-config.js"

const ZERO = "0"
const HUNDRED = "100"
const ORDER_QUANTITY_SCALE = 18

/**
 * Normalize and validate an operator-entered Binance Spot symbol.
 *
 * @param {unknown} value - Raw terminal input.
 * @returns {string} Uppercase symbol containing 5–20 ASCII letters or digits.
 * @throws {TypeError} If the input is not a supported symbol.
 */
export function normalizeSymbolInput(value) {
  if (typeof value !== "string") {
    throw new TypeError("symbol must be a string")
  }
  const symbol = value.trim().toUpperCase()
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    throw new TypeError("symbol must contain 5–20 ASCII letters or digits")
  }
  return symbol
}

/**
 * Parse a non-negative plain decimal CLI value without converting through Number.
 *
 * @param {unknown} value - Raw terminal input.
 * @param {string} field - Field name included in validation errors.
 * @param {{exclusiveMin?: boolean}} [options] - Whether zero is invalid.
 * @returns {string} Canonical exact decimal text.
 * @throws {TypeError|RangeError} If the value is malformed or violates its minimum.
 */
export function parseDecimalInput(value, field, { exclusiveMin = false } = {}) {
  if (typeof value !== "string") {
    throw new TypeError(field + " must be entered as a decimal number")
  }
  let normalized
  try {
    normalized = normalizeDecimalString({ value: value.trim(), allowNegative: false, field })
  } catch (cause) {
    throw new TypeError(field + " must be a non-negative plain decimal number", { cause })
  }
  const comparison = compareDecimal({ left: normalized, right: ZERO })
  if (comparison < 0 || (exclusiveMin && comparison === 0)) {
    throw new RangeError(field + (exclusiveMin ? " must be greater than zero" : " must be zero or greater"))
  }
  return normalized
}

/**
 * Normalize the exchange environment used to retrieve Binance metadata.
 *
 * @param {unknown} value - Raw environment prompt input.
 * @returns {"testnet"|"live"} Selected Binance Spot environment.
 * @throws {TypeError} If the environment is not testnet or live.
 */
export function normalizeTradingEnvironment(value) {
  if (typeof value !== "string") {
    throw new TypeError("environment must be either testnet or live")
  }
  const environment = value.trim().toLowerCase()
  if (environment !== "testnet" && environment !== "live") {
    throw new TypeError("environment must be either testnet or live")
  }
  return environment
}

/** Return the effective decimal places required by a positive exchange increment. */
export function decimalPlaces(value) {
  let normalized
  try {
    normalized = normalizeDecimalString({ value, allowNegative: false, field: "exchange increment" })
  } catch (cause) {
    throw new TypeError("exchange increment must be a positive decimal", { cause })
  }
  if (compareDecimal({ left: normalized, right: ZERO }) <= 0) {
    throw new RangeError("exchange increment must be positive")
  }
  const fraction = normalized.split(".")[1] ?? ""
  return fraction.replace(/0+$/, "").length
}

function toConfigNumber(value, field) {
  const number = Number(value)
  if (!Number.isFinite(number) || compareDecimal({ left: String(number), right: value }) !== 0) {
    throw new RangeError(field + " cannot be represented exactly by the existing numeric app-config contract")
  }
  return number
}

/**
 * Calculate the largest order quantity within the quote budget and exchange limits.
 *
 * @param {object} options
 * @param {string} options.investment - Quote-asset budget as decimal text.
 * @param {string} options.price - Current public reference price as decimal text.
 * @param {string} options.stepSize - Binance LOT_SIZE increment.
 * @param {string} options.minQuantity - Binance LOT_SIZE minimum.
 * @param {string} options.maxQuantity - Binance LOT_SIZE maximum.
 * @param {string} options.minNotional - Strictest applicable quote notional minimum.
 * @returns {string} Quantity rounded down to the exchange increment.
 * @throws {TypeError|RangeError} If exchange values are invalid or no valid quantity fits the budget.
 */
export function calculateOrderQuantity({
  investment,
  price,
  stepSize,
  minQuantity,
  maxQuantity,
  minNotional,
  maxNotional,
} = {}) {
  const inputs = { investment, price, stepSize, minQuantity, maxQuantity, minNotional }
  for (const [field, value] of Object.entries(inputs)) {
    if (typeof value !== "string") {
      throw new TypeError(field + " must be an exact decimal string")
    }
  }
  const normalizedInvestment = parseDecimalInput(investment, "investment", { exclusiveMin: true })
  const normalizedPrice = parseDecimalInput(price, "reference price", { exclusiveMin: true })
  const normalizedStep = parseDecimalInput(stepSize, "stepSize", { exclusiveMin: true })
  const normalizedMinimum = parseDecimalInput(minQuantity, "minQuantity", { exclusiveMin: true })
  const normalizedMaximum = parseDecimalInput(maxQuantity, "maxQuantity", { exclusiveMin: true })
  const normalizedNotional = parseDecimalInput(minNotional, "minNotional", { exclusiveMin: true })
  const normalizedMaximumNotional = maxNotional === undefined || maxNotional === null
    ? undefined
    : parseDecimalInput(maxNotional, "maxNotional", { exclusiveMin: true })

  if (compareDecimal({ left: normalizedInvestment, right: normalizedNotional }) < 0) {
    throw new RangeError("investment is below exchange MIN_NOTIONAL")
  }

  const budgetQuantity = divideDecimal({
    left: normalizedInvestment,
    right: normalizedPrice,
    scale: ORDER_QUANTITY_SCALE,
    rounding: "toward-zero",
  })
  let boundedQuantity = compareDecimal({ left: budgetQuantity, right: normalizedMaximum }) > 0
    ? normalizedMaximum
    : budgetQuantity
  if (normalizedMaximumNotional) {
    const notionalQuantity = divideDecimal({
      left: normalizedMaximumNotional,
      right: normalizedPrice,
      scale: ORDER_QUANTITY_SCALE,
      rounding: "toward-zero",
    })
    if (compareDecimal({ left: notionalQuantity, right: boundedQuantity }) < 0) {
      boundedQuantity = notionalQuantity
    }
  }
  const quantity = roundDecimalToIncrement({
    value: boundedQuantity,
    increment: normalizedStep,
    direction: "down",
  })

  if (compareDecimal({ left: quantity, right: normalizedMinimum }) < 0) {
    throw new RangeError("investment cannot satisfy exchange MIN_QUANTITY at the current reference price")
  }

  const orderNotional = multiplyDecimal({ left: quantity, right: normalizedPrice })
  if (compareDecimal({ left: orderNotional, right: normalizedNotional }) < 0) {
    throw new RangeError("calculated order quantity is below exchange MIN_NOTIONAL at the current reference price")
  }
  if (normalizedMaximumNotional && compareDecimal({ left: orderNotional, right: normalizedMaximumNotional }) > 0) {
    throw new RangeError("calculated order quantity exceeds exchange MAX_NOTIONAL at the current reference price")
  }

  return quantity
}

/**
 * Normalize and validate all operator-owned pair settings before any exchange request.
 *
 * @param {object} inputs - Operator-provided pair settings.
 * @returns {Readonly<object>} Validated decimal-string settings.
 * @throws {TypeError|RangeError} If any required setting or boundary is invalid.
 */
export function normalizePairInputs(inputs) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw new TypeError("inputs must be an object")
  }
  const normalized = {
    investment: parseDecimalInput(inputs.investment, "investment", { exclusiveMin: true }),
    keepQuantity: parseDecimalInput(inputs.keepQuantity, "keepQuantity"),
    makerPercent: parseDecimalInput(inputs.makerPercent, "makerPercent"),
    takerPercent: parseDecimalInput(inputs.takerPercent, "takerPercent"),
    minProfit: parseDecimalInput(inputs.minProfit, "minProfit", { exclusiveMin: true }),
    priceStepPercent: parseDecimalInput(inputs.priceStepPercent, "priceStepPercent", { exclusiveMin: true }),
  }
  for (const [field, value] of [["makerPercent", normalized.makerPercent], ["takerPercent", normalized.takerPercent]]) {
    if (compareDecimal({ left: value, right: HUNDRED }) >= 0) {
      throw new RangeError(field + " must be less than 100 percent")
    }
  }
  if (compareDecimal({ left: normalized.priceStepPercent, right: HUNDRED }) >= 0) {
    throw new RangeError("priceStepPercent must be less than 100 percent")
  }
  if (compareDecimal({ left: normalized.minProfit, right: "0.01" }) < 0) {
    throw new RangeError("minProfit must be at least 0.01 in the pair quote asset")
  }
  return Object.freeze(normalized)
}

/**
 * Create the complete pair object accepted by Harvester's current app-config schema.
 *
 * @param {{inputs: object, metadata: object}} options - Operator inputs and Binance metadata.
 * @returns {Readonly<object>} Runtime-valid, disabled-by-default pair configuration.
 * @throws {TypeError|RangeError|Error} If sizing, exchange constraints, or order-type support is invalid.
 */
export function createPairConfig({ inputs, metadata } = {}) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw new TypeError("inputs must be an object")
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("metadata must be an object")
  }

  const normalizedInputs = normalizePairInputs(inputs)
  const { investment, keepQuantity, makerPercent, takerPercent, minProfit, priceStepPercent } = normalizedInputs

  const normalizedStepSize = parseDecimalInput(metadata.stepSize, "stepSize", { exclusiveMin: true })
  const alignedKeepQuantity = roundDecimalToIncrement({
    value: keepQuantity,
    increment: normalizedStepSize,
    direction: "down",
  })
  if (compareDecimal({ left: alignedKeepQuantity, right: keepQuantity }) !== 0) {
    throw new RangeError("keepQuantity must align exactly with the exchange LOT_SIZE stepSize")
  }

  const orderQuantity = calculateOrderQuantity({
    investment,
    price: metadata.price,
    stepSize: normalizedStepSize,
    minQuantity: metadata.minQuantity,
    maxQuantity: metadata.maxQuantity,
    minNotional: metadata.minNotional,
    maxNotional: metadata.maxNotional,
  })
  const pricePrecision = decimalPlaces(metadata.tickSize)
  const quantityPrecision = decimalPlaces(normalizedStepSize)
  const supportedOrderTypes = metadata.supportedOrderTypes
  if (!Array.isArray(supportedOrderTypes)) {
    throw new TypeError("metadata.supportedOrderTypes must be an array")
  }
  const requiredOrderType = compareDecimal({ left: makerPercent, right: ZERO }) === 0
    ? "LIMIT_MAKER"
    : "LIMIT"
  if (!supportedOrderTypes.includes(requiredOrderType)) {
    throw new Error("Binance Spot symbol does not support required " + requiredOrderType + " orders")
  }

  return Object.freeze({
    enabled: false,
    investment: toConfigNumber(investment, "investment"),
    orderQuantity: toConfigNumber(orderQuantity, "orderQuantity"),
    keepQuantity: toConfigNumber(keepQuantity, "keepQuantity"),
    minProfit: toConfigNumber(minProfit, "minProfit"),
    priceStepPercent: toConfigNumber(priceStepPercent, "priceStepPercent"),
    pricePrecision,
    quantityPrecision,
    makerPercent: toConfigNumber(makerPercent, "makerPercent"),
    takerPercent: toConfigNumber(takerPercent, "takerPercent"),
  })
}

/**
 * Add a pair immutably to the one canonical Harvester application configuration.
 *
 * @param {{appConfig: object, symbol: string, pairConfig: object}} options - Existing config and generated pair.
 * @returns {object} A cloned, runtime-validated application configuration.
 * @throws {TypeError|Error} If the config shape is invalid or the symbol already exists.
 */
export function addPairToAppConfig({ appConfig, symbol, pairConfig } = {}) {
  if (!appConfig || typeof appConfig !== "object" || Array.isArray(appConfig)) {
    throw new TypeError("appConfig must be an object")
  }
  const normalizedSymbol = normalizeSymbolInput(symbol)
  const pairs = appConfig.strategies?.CG_coinGrabber?.pairs
  if (!pairs || typeof pairs !== "object" || Array.isArray(pairs)) {
    throw new TypeError("appConfig must contain strategies.CG_coinGrabber.pairs")
  }
  const existingSymbol = Object.keys(pairs).find((candidate) => candidate.trim().toUpperCase() === normalizedSymbol)
  if (existingSymbol) {
    throw new Error("Pair " + normalizedSymbol + " already exists in config.json; refusing to overwrite it")
  }
  const updated = structuredClone(appConfig)
  updated.strategies.CG_coinGrabber.pairs[normalizedSymbol] = structuredClone(pairConfig)
  validateAppConfig(updated)
  return updated
}
