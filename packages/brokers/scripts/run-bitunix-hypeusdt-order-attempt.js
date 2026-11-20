import { open, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { assertDecimalString, compareDecimal, multiplyDecimal } from "@coinzilla/utils"

const HYPEUSDT_ORDER_DETAILS = Object.freeze({
  symbol: "HYPEUSDT",
  side: "BUY",
  type: "LIMIT",
  price: "30",
  quantity: "0.4",
})
const HYPEUSDT_ORDER_NOTIONAL = multiplyDecimal({
  left: HYPEUSDT_ORDER_DETAILS.price,
  right: HYPEUSDT_ORDER_DETAILS.quantity,
})
const HYPEUSDT_ORDER = Object.freeze({
  ...HYPEUSDT_ORDER_DETAILS,
  notional: HYPEUSDT_ORDER_NOTIONAL,
})
const PROVISIONAL_HYPEUSDT_NOTIONAL_FLOOR = "11"

export const BITUNIX_OPERATOR_ORDER_CONFIRMATION = "SUBMIT ONE LIVE HYPEUSDT BUY LIMIT ORDER"

function requireSuccessfulBrokerResult({ result, operation }) {
  if (!result || result.ok !== true) {
    const cause = result?.errors?.[0]
    const reason = cause?.code ?? cause?.message ?? "unsuccessful broker result"
    throw new Error(`Bitunix operator preflight ${operation} failed: ${reason}`, {
      cause,
    })
  }
  return result.data
}

function requireBrokerArrayResultData({ value, operation }) {
  if (!Array.isArray(value)) {
    throw new TypeError(`Bitunix operator preflight ${operation} must return an array`)
  }
  return value
}

function requireNonNegativeExactDecimal({ value, field }) {
  const amount = assertDecimalString({
    value,
    field: `Bitunix Spot ${field}`,
  })
  if (compareDecimal({
    left: amount,
    right: "0",
  }) < 0) {
    throw new RangeError(`Bitunix Spot ${field} must be non-negative`)
  }
  return amount
}

function validateHypeUsdtActiveMarket({ markets }) {
  const market = markets.find(({ symbol }) => symbol === HYPEUSDT_ORDER.symbol)
  if (!market) {
    throw new Error("Bitunix operator preflight requires HYPEUSDT to be explicitly open in the market catalog")
  }
  if (market.baseAsset?.code !== "HYPE" || market.quoteAsset?.code !== "USDT") {
    throw new TypeError("Bitunix HYPEUSDT market catalog base and quote assets do not match the requested pair")
  }
}

function validateHypeUsdtSymbolFilters({ symbolFilters }) {
  if (!symbolFilters || typeof symbolFilters !== "object" || Array.isArray(symbolFilters)) {
    throw new TypeError("Bitunix operator preflight requires HYPEUSDT symbol metadata")
  }
  if (symbolFilters.symbol !== HYPEUSDT_ORDER.symbol ||
      symbolFilters.base !== "HYPE" ||
      symbolFilters.quote !== "USDT") {
    throw new TypeError("Bitunix HYPEUSDT symbol metadata base and quote identity do not match the requested pair")
  }
  if (symbolFilters.isOpen !== "1" && symbolFilters.isOpen !== 1) {
    throw new Error("Bitunix HYPEUSDT symbol metadata is not explicitly open")
  }
  const minimumQuantity = requireNonNegativeExactDecimal({
    value: symbolFilters.minVolume,
    field: "minVolume",
  })
  const minimumNotional = requireNonNegativeExactDecimal({
    value: symbolFilters.minPrice,
    field: "minPrice",
  })
  if (compareDecimal({
    left: HYPEUSDT_ORDER.quantity,
    right: minimumQuantity,
  }) < 0) {
    throw new RangeError("Bitunix HYPEUSDT order quantity is below the documented minimum quantity")
  }
  if (compareDecimal({
    left: HYPEUSDT_ORDER.notional,
    right: minimumNotional,
  }) < 0) {
    throw new RangeError("Bitunix HYPEUSDT order notional is below the documented minimum notional")
  }
  if (compareDecimal({
    left: HYPEUSDT_ORDER.notional,
    right: PROVISIONAL_HYPEUSDT_NOTIONAL_FLOOR,
  }) < 0) {
    throw new RangeError("Bitunix HYPEUSDT order notional is below the provisional local safety floor")
  }
  return {
    minimumQuantity,
    minimumNotional,
  }
}

function findUsdtQuoteBalance({ balances }) {
  const balance = balances.find(({ free }) => free?.asset?.code === "USDT")
  if (!balance) {
    throw new Error("Bitunix operator preflight requires an explicit USDT balance row")
  }
  const freeQuoteBalance = requireNonNegativeExactDecimal({
    value: balance.free.amount,
    field: "free USDT balance",
  })
  const lockedQuoteBalance = requireNonNegativeExactDecimal({
    value: balance.locked?.amount,
    field: "locked USDT balance",
  })
  if (compareDecimal({
    left: freeQuoteBalance,
    right: HYPEUSDT_ORDER.notional,
  }) >= 0) {
    throw new Error("Bitunix operator preflight stopped: free USDT is at least 12 and could cover the order")
  }
  return {
    freeQuoteBalance,
    lockedQuoteBalance,
  }
}

/**
 * Build the read-only preflight summary for the fixed HYPEUSDT order attempt.
 *
 * @param {object} input
 * @param {object} input.marketResult Successful getExchangeMarkets() result.
 * @param {object} input.filtersResult Successful getSymbolFilters() result.
 * @param {object} input.balancesResult Successful getBalances() result.
 * @param {object} input.openOrdersResult Successful symbol-scoped getOpenOrders() result.
 * @returns {object} Validated order intent and sanitized preflight values.
 */
export function createBitunixOperatorOrderPreflight({
  marketResult,
  filtersResult,
  balancesResult,
  openOrdersResult,
} = {}) {
  const markets = requireBrokerArrayResultData({
    value: requireSuccessfulBrokerResult({
      result: marketResult,
      operation: "market catalog",
    }),
    operation: "market catalog",
  })
  validateHypeUsdtActiveMarket({
    markets,
  })
  const symbolFilters = requireSuccessfulBrokerResult({
    result: filtersResult,
    operation: "symbol metadata",
  })
  const { minimumQuantity, minimumNotional } = validateHypeUsdtSymbolFilters({
    symbolFilters,
  })
  const balances = requireBrokerArrayResultData({
    value: requireSuccessfulBrokerResult({
      result: balancesResult,
      operation: "account balances",
    }),
    operation: "account balances",
  })
  const { freeQuoteBalance, lockedQuoteBalance } = findUsdtQuoteBalance({
    balances,
  })
  const openOrders = requireBrokerArrayResultData({
    value: requireSuccessfulBrokerResult({
      result: openOrdersResult,
      operation: "symbol-scoped open orders",
    }),
    operation: "symbol-scoped open orders",
  })
  if (openOrders.length > 0) {
    throw new Error("Bitunix operator preflight stopped: an existing HYPEUSDT open order was found")
  }
  return Object.freeze({
    order: HYPEUSDT_ORDER,
    notional: HYPEUSDT_ORDER.notional,
    minimumQuantity,
    minimumNotional,
    provisionalNotionalFloor: PROVISIONAL_HYPEUSDT_NOTIONAL_FLOOR,
    freeQuoteBalance,
    lockedQuoteBalance,
    openOrderCount: openOrders.length,
  })
}

/**
 * Require a real interactive terminal for the local LIVE operator command.
 *
 * @param {{stdin: {isTTY?: boolean}, stdout: {isTTY?: boolean}}} input
 * @returns {void}
 */
export function assertBitunixOperatorInteractiveTerminal({ stdin, stdout } = {}) {
  if (stdin?.isTTY !== true || stdout?.isTTY !== true) {
    throw new Error("Bitunix LIVE order attempt requires an interactive terminal; non-interactive execution is refused")
  }
}

/**
 * Persist an exclusive one-shot marker before dispatching the order request.
 *
 * @param {object} input
 * @param {string} input.markerPath Local gitignored marker path.
 * @param {object} input.preflight Validated order preflight.
 * @param {() => number} [input.now] Clock for deterministic tests.
 * @returns {Promise<void>}
 */
export async function createOneShotMarker({
  markerPath,
  preflight,
  now = Date.now,
} = {}) {
  if (typeof markerPath !== "string" || markerPath.trim() === "") {
    throw new TypeError("Bitunix operator marker path must be a non-empty string")
  }
  const orderMatchesFixedIntent = preflight?.order &&
    preflight.order.symbol === HYPEUSDT_ORDER.symbol &&
    preflight.order.side === HYPEUSDT_ORDER.side &&
    preflight.order.type === HYPEUSDT_ORDER.type &&
    preflight.order.price === HYPEUSDT_ORDER.price &&
    preflight.order.quantity === HYPEUSDT_ORDER.quantity &&
    preflight.order.notional === HYPEUSDT_ORDER.notional
  if (!orderMatchesFixedIntent) {
    throw new TypeError("Bitunix operator marker requires the exact fixed HYPEUSDT order intent")
  }
  const marker = {
    createdAt: new Date(now()).toISOString(),
    status: "DISPATCH_STARTED",
    order: HYPEUSDT_ORDER,
  }
  await mkdir(dirname(markerPath), {
    recursive: true,
    mode: 0o700,
  })
  const file = await open(markerPath, "wx", 0o600)
  try {
    await file.writeFile(`${JSON.stringify(marker, null, 2)}\n`, "utf8")
    await file.sync()
  } finally {
    await file.close()
  }
}

async function readHypeUsdtOperatorPreflight({ readBroker }) {
  await readBroker.connect()
  try {
    const marketResult = await readBroker.getExchangeMarkets()
    requireSuccessfulBrokerResult({
      result: marketResult,
      operation: "market catalog",
    })
    const filtersResult = await readBroker.getSymbolFilters({
      symbol: HYPEUSDT_ORDER.symbol,
    })
    requireSuccessfulBrokerResult({
      result: filtersResult,
      operation: "symbol metadata",
    })
    const balancesResult = await readBroker.getBalances()
    requireSuccessfulBrokerResult({
      result: balancesResult,
      operation: "account balances",
    })
    const openOrdersResult = await readBroker.getOpenOrders({
      symbol: HYPEUSDT_ORDER.symbol,
    })
    return createBitunixOperatorOrderPreflight({
      marketResult,
      filtersResult,
      balancesResult,
      openOrdersResult,
    })
  } finally {
    await readBroker.disconnect()
  }
}

function formatHypeUsdtPreflightSummary({ preflight }) {
  const { order } = preflight
  return [
    "BITUNIX SPOT — LIVE OPERATOR ORDER ATTEMPT",
    "Endpoint: https://openapi.bitunix.com (LIVE)",
    `Order: ${order.side} ${order.type} ${order.symbol}`,
    `Limit price: ${order.price} USDT`,
    `Base quantity: ${order.quantity} HYPE`,
    `Order notional: ${order.notional} USDT`,
    `Exchange minimum quantity (minVolume): ${preflight.minimumQuantity} HYPE`,
    `Exchange minimum notional (minPrice): ${preflight.minimumNotional} USDT`,
    `Provisional local notional floor: ${preflight.provisionalNotionalFloor} USDT (not an exchange guarantee)`,
    `USDT balance: free ${preflight.freeQuoteBalance}; locked ${preflight.lockedQuoteBalance}`,
    `HYPEUSDT open orders returned by the symbol-scoped query: ${preflight.openOrderCount}`,
    "Open-order response completeness is not established; an empty result is not proof of account-wide absence.",
    "Price tick and quantity step remain UNKNOWN; the exchange may reject the submitted price or quantity.",
    "Free USDT is below the order notional, but other exchange-side credits or account settings may still affect acceptance.",
    "This balance observation does NOT guarantee an insufficient-balance rejection.",
    "Exactly one placement call will be made. No retry, cancel, transfer, or second mutation will follow.",
  ].join("\n")
}

function formatHypeUsdtMutationResult({ result }) {
  const outcome = result?.mutationOutcome ?? "UNREPORTED"
  const orderId = result?.data?.id
  const errorMessage = result?.errors?.[0]?.message
  return [
    `Broker result: ${result?.ok === true ? "success" : "not successful"}; mutation outcome: ${outcome}.`,
    ...(orderId ? [`Exchange order ID: ${orderId}`] : []),
    ...(errorMessage ? [`Broker message: ${errorMessage}`] : []),
    ...(outcome === "OUTCOME_UNKNOWN"
      ? ["WARNING: outcome is unknown. Do not retry; reconcile manually before any further action."]
      : []),
  ].join("\n")
}

function assertBitunixMutationBroker({ broker }) {
  const requiredMethods = ["connect", "createOrder", "disconnect"]
  if (!broker || requiredMethods.some((method) => typeof broker[method] !== "function")) {
    throw new TypeError("Bitunix operator attempt requires a mutation Broker with createOrder()")
  }
}

function assertBitunixOperatorAttemptDependencies({
  readBroker,
  createOrderBroker,
  confirm,
  createMarker,
  writeLine,
}) {
  const requiredReadMethods = [
    "connect",
    "getExchangeMarkets",
    "getSymbolFilters",
    "getBalances",
    "getOpenOrders",
    "disconnect",
  ]
  if (!readBroker || requiredReadMethods.some((method) => typeof readBroker[method] !== "function")) {
    throw new TypeError("Bitunix operator attempt requires a read Broker with market, balance, and open-order queries")
  }
  for (const [name, dependency] of [
    ["createOrderBroker", createOrderBroker],
    ["confirm", confirm],
    ["createMarker", createMarker],
    ["writeLine", writeLine],
  ]) {
    if (typeof dependency !== "function") {
      throw new TypeError(`Bitunix operator attempt requires ${name}()`)
    }
  }
}

/**
 * Run read-only preflight, require human approval, then submit exactly one order.
 *
 * @param {object} input
 * @param {object} input.readBroker Broker instance with live mutations disabled.
 * @param {() => object} input.createOrderBroker Factory for the mutation-enabled Broker.
 * @param {(input: object) => Promise<boolean>} input.confirm Exact operator confirmation.
 * @param {(input: object) => Promise<void>} input.createMarker Exclusive marker writer.
 * @param {(message: string) => void} input.writeLine Local terminal output callback.
 * @returns {Promise<object>} The original Broker placement result or NOT_SENT decline result.
 */
export async function runBitunixOperatorOrderAttempt({
  readBroker,
  createOrderBroker,
  confirm,
  createMarker,
  writeLine,
} = {}) {
  assertBitunixOperatorAttemptDependencies({
    readBroker,
    createOrderBroker,
    confirm,
    createMarker,
    writeLine,
  })
  const preflight = await readHypeUsdtOperatorPreflight({
    readBroker,
  })
  writeLine(formatHypeUsdtPreflightSummary({
    preflight,
  }))
  const approved = await confirm({
    preflight,
    confirmationPhrase: BITUNIX_OPERATOR_ORDER_CONFIRMATION,
  })
  if (approved !== true) {
    writeLine("Operator declined or did not enter the exact confirmation phrase. No order was sent.")
    return Object.freeze({
      ok: false,
      mutationOutcome: "NOT_SENT",
      declined: true,
    })
  }
  const orderBroker = createOrderBroker()
  assertBitunixMutationBroker({
    broker: orderBroker,
  })
  await orderBroker.connect()
  try {
    await createMarker({
      preflight,
    })
    const result = await orderBroker.createOrder({
      symbol: preflight.order.symbol,
      side: preflight.order.side,
      type: preflight.order.type,
      quantity: preflight.order.quantity,
      price: preflight.order.price,
    })
    writeLine(formatHypeUsdtMutationResult({
      result,
    }))
    return result
  } finally {
    try {
      await orderBroker.disconnect()
    } catch (error) {
      writeLine(`Warning: mutation Broker disconnect failed after the placement attempt: ${error.message}`)
    }
  }
}
