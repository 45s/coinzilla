import { open, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import {
  assertSuccessfulBitunixBrokerResult,
  BITUNIX_OPERATOR_ORDER_INTENT,
  createBitunixOperatorOrderPreflight,
} from "./bitunix-hypeusdt-order-preflight.js"

const BITUNIX_OPERATOR_ORDER_CONFIRMATION = "SUBMIT ONE LIVE HYPEUSDT BUY LIMIT ORDER"

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
    preflight.order.symbol === BITUNIX_OPERATOR_ORDER_INTENT.symbol &&
    preflight.order.side === BITUNIX_OPERATOR_ORDER_INTENT.side &&
    preflight.order.type === BITUNIX_OPERATOR_ORDER_INTENT.type &&
    preflight.order.price === BITUNIX_OPERATOR_ORDER_INTENT.price &&
    preflight.order.quantity === BITUNIX_OPERATOR_ORDER_INTENT.quantity &&
    preflight.order.notional === BITUNIX_OPERATOR_ORDER_INTENT.notional
  if (!orderMatchesFixedIntent) {
    throw new TypeError("Bitunix operator marker requires the exact fixed HYPEUSDT order intent")
  }
  const marker = {
    createdAt: new Date(now()).toISOString(),
    status: "DISPATCH_STARTED",
    order: BITUNIX_OPERATOR_ORDER_INTENT,
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
    assertSuccessfulBitunixBrokerResult({
      result: marketResult,
      operation: "market catalog",
    })
    const filtersResult = await readBroker.getSymbolFilters({
      symbol: BITUNIX_OPERATOR_ORDER_INTENT.symbol,
    })
    assertSuccessfulBitunixBrokerResult({
      result: filtersResult,
      operation: "symbol metadata",
    })
    const balancesResult = await readBroker.getBalances()
    assertSuccessfulBitunixBrokerResult({
      result: balancesResult,
      operation: "account balances",
    })
    const openOrdersResult = await readBroker.getOpenOrders({
      symbol: BITUNIX_OPERATOR_ORDER_INTENT.symbol,
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
    "Provider: Bitunix Spot",
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
    "The balance is a point-in-time response without an authoritative source timestamp and may change before dispatch.",
    "Bonuses, transfers, other assets, account settings, or exchange behavior may still affect acceptance.",
    "This balance observation does NOT guarantee an insufficient-balance rejection.",
    "A successful or rejected LIVE response is one observation, not a production-readiness guarantee.",
    "If accepted, the 30 USDT limit may be marketable and could fill immediately at the live ask.",
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

