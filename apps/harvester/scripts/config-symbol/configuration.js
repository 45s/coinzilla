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
 * Validate an operator-selected per-order quantity against Binance filters and pair budget.
 *
 * @param {object} options
 * @param {string} options.orderQuantity - Base-asset quantity for each individual order.
 * @param {string} options.investment - Total quote-asset allocation for this pair.
 * @param {string} options.price - Current public reference price.
 * @param {string} options.stepSize - Binance LOT_SIZE increment.
 * @param {string} options.minQuantity - Binance LOT_SIZE minimum.
 * @param {string} options.maxQuantity - Binance LOT_SIZE maximum.
 * @param {string} options.minNotional - Strictest applicable quote notional minimum.
 * @param {string} [options.maxNotional] - Active maximum quote notional.
 * @returns {string} The validated per-order quantity.
 */
export function validateOrderQuantity({
  orderQuantity,
  investment,
  price,
  stepSize,
  minQuantity,
  maxQuantity,
  minNotional,
  maxNotional,
} = {}) {
  const values = { orderQuantity, investment, price, stepSize, minQuantity, maxQuantity, minNotional }
  for (const [field, value] of Object.entries(values)) {
    if (typeof value !== "string") {throw new TypeError(field + " must be an exact decimal string")}
  }
  const quantity = parseDecimalInput(orderQuantity, "orderQuantity", { exclusiveMin: true })
  const budget = parseDecimalInput(investment, "investment", { exclusiveMin: true })
  const referencePrice = parseDecimalInput(price, "reference price", { exclusiveMin: true })
  const step = parseDecimalInput(stepSize, "stepSize", { exclusiveMin: true })
  const minimum = parseDecimalInput(minQuantity, "minQuantity", { exclusiveMin: true })
  const maximum = parseDecimalInput(maxQuantity, "maxQuantity", { exclusiveMin: true })
  const minQuote = parseDecimalInput(minNotional, "minNotional", { exclusiveMin: true })
  const maxQuote = maxNotional === undefined || maxNotional === null
    ? undefined
    : parseDecimalInput(maxNotional, "maxNotional", { exclusiveMin: true })

  if (compareDecimal({ left: roundDecimalToIncrement({ value: quantity, increment: step, direction: "down" }), right: quantity }) !== 0) {
    throw new RangeError("orderQuantity must align exactly with the exchange LOT_SIZE stepSize")
  }
  if (compareDecimal({ left: quantity, right: minimum }) < 0) {throw new RangeError("orderQuantity is below exchange MIN_QUANTITY")}
  if (compareDecimal({ left: quantity, right: maximum }) > 0) {throw new RangeError("orderQuantity exceeds exchange MAX_QUANTITY")}

  const notional = multiplyDecimal({ left: quantity, right: referencePrice })
  if (compareDecimal({ left: notional, right: minQuote }) < 0) {throw new RangeError("orderQuantity is below exchange MIN_NOTIONAL at the current reference price")}
  if (maxQuote && compareDecimal({ left: notional, right: maxQuote }) > 0) {throw new RangeError("orderQuantity exceeds exchange MAX_NOTIONAL at the current reference price")}
  if (compareDecimal({ left: notional, right: budget }) >= 0) {
    throw new RangeError("orderQuantity must be smaller than the total investment so the pair allocation can be split across multiple orders")
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
    orderQuantity: parseDecimalInput(inputs.orderQuantity, "orderQuantity", { exclusiveMin: true }),
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
 * @returns {Readonly<object>} Runtime-valid pair configuration ready to add to the strategy.
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
  const { investment, orderQuantity: requestedOrderQuantity, keepQuantity, makerPercent, takerPercent, minProfit, priceStepPercent } = normalizedInputs

  const normalizedStepSize = parseDecimalInput(metadata.stepSize, "stepSize", { exclusiveMin: true })
  const alignedKeepQuantity = roundDecimalToIncrement({
    value: keepQuantity,
    increment: normalizedStepSize,
    direction: "down",
  })
  if (compareDecimal({ left: alignedKeepQuantity, right: keepQuantity }) !== 0) {
    throw new RangeError("keepQuantity must align exactly with the exchange LOT_SIZE stepSize")
  }

  const orderQuantity = validateOrderQuantity({
    orderQuantity: requestedOrderQuantity,
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
    enabled: true,
    enableVolatilityProtection: true,
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
