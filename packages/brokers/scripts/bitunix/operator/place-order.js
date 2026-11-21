import { open, mkdir, readFile, rename, writeFile } from "node:fs/promises"
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
  return markerPath
}

/**
 * Persist a minimal, allowlisted terminal outcome to the existing one-shot marker.
 * If the process dies before this completes, DISPATCH_STARTED remains fail-closed.
 *
 * @param {{markerPath: string, outcome: string, error?: object, now?: () => number}} input
 */
export async function persistOneShotMarkerOutcome({
  markerPath,
  outcome,
  error = null,
  now = Date.now,
} = {}) {
  const allowedOutcomes = new Set(["CONFIRMED", "REJECTED", "NOT_SENT", "OUTCOME_UNKNOWN"])
  const finalOutcome = allowedOutcomes.has(outcome) ? outcome : "OUTCOME_UNKNOWN"
  const marker = JSON.parse(await readFile(markerPath, "utf8"))
  if (marker.status !== "DISPATCH_STARTED") {
    throw new Error("Bitunix one-shot marker is not awaiting an outcome")
  }
  const safeValue = (value) => {
    if (typeof value !== "string" && typeof value !== "number") {
      return undefined
    }
    const normalized = String(value)
    return /^[A-Za-z0-9_.:-]{1,80}$/.test(normalized) ? normalized : undefined
  }
  const metadata = {}
  for (const [key, value] of [
    ["brokerCode", error?.code],
    ["exchangeCode", error?.exchangeCode],
    ["httpStatus", error?.status],
    ["errorKind", error?.kind],
  ]) {
    const safe = safeValue(value)
    if (safe !== undefined) {
      metadata[key] = safe
    }
  }
  marker.status = finalOutcome
  marker.completedAt = new Date(now()).toISOString()
  if (Object.keys(metadata).length > 0) {
    marker.result = metadata
  }
  const temporaryPath = `${markerPath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  })
  await rename(temporaryPath, markerPath)
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

async function dispatchOrderAndPersistOutcome({ orderBroker, preflight, markerPath, writeLine }) {
  let result
  try {
    result = await orderBroker.createOrder({
      symbol: preflight.order.symbol,
      side: preflight.order.side,
      type: preflight.order.type,
      quantity: preflight.order.quantity,
      price: preflight.order.price,
    })
  } catch (error) {
    try {
      await persistOneShotMarkerOutcome({
        markerPath,
        outcome: "OUTCOME_UNKNOWN",
        error,
      })
    } catch (persistError) {
      writeLine(`WARNING: could not persist OUTCOME_UNKNOWN to the one-shot marker: ${persistError.message}`)
    }
    throw error
  }
  const validOutcomes = ["CONFIRMED", "REJECTED", "NOT_SENT", "OUTCOME_UNKNOWN"]
  const outcome = validOutcomes.includes(result?.mutationOutcome)
    ? result.mutationOutcome
    : "OUTCOME_UNKNOWN"
  try {
    await persistOneShotMarkerOutcome({
      markerPath,
      outcome,
      error: result?.errors?.[0],
    })
  } catch (error) {
    writeLine(`WARNING: could not persist ${outcome} to the one-shot marker: ${error.message}`)
  }
  writeLine(formatOrderMutationResult({ result }))
  return result
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
    const markerPath = await createMarker({
      preflight,
    })
    return await dispatchOrderAndPersistOutcome({
      orderBroker,
      preflight,
      markerPath,
      writeLine,
    })
  } finally {
    try {
      await orderBroker.disconnect()
    } catch (error) {
      writeLine(`Warning: mutation Broker disconnect failed after the placement attempt: ${error.message}`)
    }
  }
}

