import { open, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import {
  assertSuccessfulBrokerResult,
  HYPEUSDT_ORDER_INTENT,
  createHypeUsdtOrderPreflight,
} from "../helpers/create-hypeusdt-order-preflight.js"
import {
  assertMutationBroker,
  assertOrderAttemptDependencies,
} from "../helpers/validate-order-attempt.js"
import {
  formatOrderMutationResult,
  formatOrderPreflightSummary,
} from "../helpers/format-order-attempt.js"

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
    preflight.order.symbol === HYPEUSDT_ORDER_INTENT.symbol &&
    preflight.order.side === HYPEUSDT_ORDER_INTENT.side &&
    preflight.order.type === HYPEUSDT_ORDER_INTENT.type &&
    preflight.order.price === HYPEUSDT_ORDER_INTENT.price &&
    preflight.order.quantity === HYPEUSDT_ORDER_INTENT.quantity &&
    preflight.order.notional === HYPEUSDT_ORDER_INTENT.notional
  if (!orderMatchesFixedIntent) {
    throw new TypeError("Bitunix operator marker requires the exact fixed HYPEUSDT order intent")
  }
  const marker = {
    createdAt: new Date(now()).toISOString(),
    status: "DISPATCH_STARTED",
    order: HYPEUSDT_ORDER_INTENT,
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
    assertSuccessfulBrokerResult({
      result: marketResult,
      operation: "market catalog",
    })
    const filtersResult = await readBroker.getSymbolFilters({
      symbol: HYPEUSDT_ORDER_INTENT.symbol,
    })
    assertSuccessfulBrokerResult({
      result: filtersResult,
      operation: "symbol metadata",
    })
    const balancesResult = await readBroker.getBalances()
    assertSuccessfulBrokerResult({
      result: balancesResult,
      operation: "account balances",
    })
    const openOrdersResult = await readBroker.getOpenOrders({
      symbol: HYPEUSDT_ORDER_INTENT.symbol,
    })
    return createHypeUsdtOrderPreflight({
      marketResult,
      filtersResult,
      balancesResult,
      openOrdersResult,
    })
  } finally {
    await readBroker.disconnect()
  }
}

/**
 * Run read-only preflight, require human approval, then submit exactly one order.
 *
 * @param {object} input
 * @param {object} input.readBroker Broker instance with live mutations disabled.
 * @param {() => object} input.createOrderBroker Factory for the mutation-enabled Broker.
 * @param {(input: object) => Promise<boolean>} input.confirm Final approval for the exact displayed order.
 * @param {(input: object) => Promise<void>} input.createMarker Exclusive marker writer.
 * @param {(message: string) => void} input.writeLine Local terminal output callback.
 * @returns {Promise<object>} The original Broker placement result or NOT_SENT decline result.
 */
export async function runGuardedHypeUsdtOrderAttempt({
  readBroker,
  createOrderBroker,
  confirm,
  createMarker,
  writeLine,
} = {}) {
  assertOrderAttemptDependencies({
    readBroker,
    createOrderBroker,
    confirm,
    createMarker,
    writeLine,
  })
  const preflight = await readHypeUsdtOperatorPreflight({
    readBroker,
  })
  writeLine(formatOrderPreflightSummary({
    preflight,
  }))
  const approved = await confirm({
    preflight,
    order: preflight.order,
  })
  if (approved !== true) {
    writeLine("Operator did not confirm the displayed order. No order was sent.")
    return Object.freeze({
      ok: false,
      mutationOutcome: "NOT_SENT",
      declined: true,
    })
  }
  const orderBroker = createOrderBroker()
  assertMutationBroker({
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
    writeLine(formatOrderMutationResult({
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

