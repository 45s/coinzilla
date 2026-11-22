import { open, readFile, rename, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { BitunixRestClient } from "../../../src/infrastructure/bitunix/spot/api/rest-client.js"
import { BITUNIX_SPOT_ORDER_API } from "../../../src/infrastructure/bitunix/spot/adapters/order-requests.js"
import { redactApiSecrets } from "../helpers/api-credentials.js"
import { sanitizeDiagnosticValue } from "../helpers/sanitize-diagnostic-data.js"
import { createBitunixOrderProbePreflight } from "./order-probe-preflight.js"
import { getBitunixOrderProbe } from "./order-probe-matrix.js"

function createCaptureRestClientFactory({ capture, fetchFn = fetch }) {
  return (config) => new BitunixRestClient({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    baseUrl: config.baseUrl,
    requestTimeout: config.requestTimeout,
    fetchFn: async (url, options) => {
      const parsedUrl = new URL(url)
      const path = parsedUrl.pathname
      const isPlacement = path === BITUNIX_SPOT_ORDER_API.placeOrder
      const isOrderDetail = path === BITUNIX_SPOT_ORDER_API.orderDetail
      if (!isPlacement && !isOrderDetail) {
        return fetchFn(url, options)
      }
      const request = {
        method: options.method,
        path,
        ...(isPlacement ? { body: options.body ?? null } : {}),
      }
      capture.requests ??= []
      capture.requests.push(request)
      if (isPlacement) {
        capture.request = request
      }
      let response
      try {
        response = await fetchFn(url, options)
      } catch (error) {
        const transportError = {
          name: error?.name ?? "Error",
          message: String(error?.message ?? error).slice(0, 500),
          path,
        }
        capture.transportErrors ??= []
        capture.transportErrors.push(transportError)
        if (isPlacement) {
          capture.transportError = transportError
        }
        throw error
      }
      try {
        const responseText = await response.clone().text()
        const responseRecord = {
          path,
          httpStatus: response.status,
          httpOk: response.ok,
        }
        if (isPlacement) {
          responseRecord.body = responseText
          capture.response = responseRecord
        } else {
          try {
            responseRecord.body = sanitizeDiagnosticValue({
              value: JSON.parse(responseText),
            })
          } catch {
            responseRecord.body = "[non-JSON order-detail response withheld]"
            responseRecord.bodyLength = responseText.length
          }
          capture.followUpResponses ??= []
          capture.followUpResponses.push(responseRecord)
        }
      } catch (error) {
        const responseReadError = {
          name: error?.name ?? "Error",
          message: String(error?.message ?? error).slice(0, 500),
          path,
        }
        capture.responseReadErrors ??= []
        capture.responseReadErrors.push(responseReadError)
      }
      return response
    },
  })
}

function assertProbeAttemptDependencies({
  readBroker,
  createOrderBroker,
  confirm,
  createMarker,
  assertMatrixCanContinue,
  writeLine,
}) {
  const readMethods = ["connect", "getExchangeMarkets", "getSymbolFilters", "getBalances", "getOpenOrders", "disconnect"]
  if (!readBroker || readMethods.some((method) => typeof readBroker[method] !== "function")) {
    throw new TypeError("Bitunix order probe requires a read-only Broker with market, filter, balance and open-order methods")
  }
  for (const [name, value] of [
    ["createOrderBroker", createOrderBroker],
    ["confirm", confirm],
    ["createMarker", createMarker],
    ["assertMatrixCanContinue", assertMatrixCanContinue],
    ["writeLine", writeLine],
  ]) {
    if (typeof value !== "function") {
      throw new TypeError(`Bitunix order probe requires ${name}()`)
    }
  }
}

function assertOrderMutationBroker({ broker }) {
  if (!broker || typeof broker.connect !== "function" ||
      typeof broker.createOrder !== "function" || typeof broker.disconnect !== "function") {
    throw new TypeError("Bitunix order probe requires a mutation Broker with createOrder()")
  }
}

async function readOrderProbePreflight({ readBroker, probeId }) {
  await readBroker.connect()
  try {
    const [marketResult, filtersResult, balancesResult, openOrdersResult] = await Promise.all([
      readBroker.getExchangeMarkets(),
      readBroker.getSymbolFilters({ symbol: "HYPEUSDT" }),
      readBroker.getBalances(),
      readBroker.getOpenOrders({ symbol: "HYPEUSDT" }),
    ])
    return createBitunixOrderProbePreflight({
      probeId,
      marketResult,
      filtersResult,
      balancesResult,
      openOrdersResult,
    })
  } finally {
    await readBroker.disconnect()
  }
}

function formatOrderProbePreflight({ preflight }) {
  const { probe } = preflight
  return [
    "BITUNIX SPOT — LIVE ORDER PROBE",
    "Endpoint: https://openapi.bitunix.com (LIVE)",
    `Probe: ${probe.id}`,
    `Order: ${probe.side} ${probe.type} ${probe.symbol}`,
    `Coinzilla input: ${probe.quantity === undefined ? `quoteQuantity ${probe.quoteQuantity} USDT` : `quantity ${probe.quantity} HYPE`}`,
    `Price: ${probe.price ?? "omitted (MARKET wire price is 0)"}`,
    `Expected wire body: ${JSON.stringify(preflight.wireRequest)}`,
    `Exchange minimum quantity (minVolume): ${preflight.minimumQuantity} HYPE`,
    `Exchange minimum notional (minPrice): ${preflight.minimumNotional} USDT`,
    `Probe below minimum quantity: ${preflight.belowMinimumQuantity}`,
    `Probe below minimum notional: ${preflight.belowMinimumNotional}`,
    `HYPE balance: free ${preflight.freeBaseBalance ?? "not returned"}; locked ${preflight.lockedBaseBalance ?? "not returned"}`,
    `USDT balance: free ${preflight.freeQuoteBalance ?? "not returned"}; locked ${preflight.lockedQuoteBalance ?? "not returned"}`,
    `HYPEUSDT open orders returned: ${preflight.openOrderCount}`,
    "Official English and Chinese Spot docs disagree on MARKET/LIMIT volume denomination; this probe is intended to collect observed behavior.",
    "Price tick and quantity step are not established by the available metadata.",
    "Balances are point-in-time and have no authoritative source timestamp. An insufficient balance observation does not guarantee rejection.",
    "This is a real LIVE order. If Bitunix accepts it, it may rest or fill immediately. No cancel or retry will follow.",
  ].join("\n")
}

function formatOrderProbeResult({ result, capture, secrets = [] }) {
  const error = result?.errors?.[0]
  const lines = [
    `Broker result: ${result?.ok === true ? "success" : "not successful"}`,
    `Mutation outcome: ${result?.mutationOutcome ?? "OUTCOME_UNKNOWN"}`,
    ...(error?.code ? [`Broker error code: ${error.code}`] : []),
    ...(error?.exchangeCode ? [`Bitunix exchange code: ${error.exchangeCode}`] : []),
    ...(error?.status ? [`HTTP status: ${error.status}`] : []),
    ...(error?.message ? [`Message: ${redactApiSecrets({ message: error.message, secrets })}`] : []),
    ...(capture.response?.body ? [`Raw place-order response: ${redactApiSecrets({ message: capture.response.body, secrets })}`] : []),
    ...(result?.mutationOutcome === "OUTCOME_UNKNOWN"
      ? ["STOP: outcome unknown. Do not run another probe until manually investigated."]
      : []),
    ...(result?.mutationOutcome === "CONFIRMED"
      ? ["STOP: Bitunix accepted the order. Do not run another probe."]
      : []),
  ]
  return lines.join("\n")
}

async function createProbeMarker({ markerPath, preflight, now = Date.now }) {
  await mkdir(dirname(markerPath), {
    recursive: true,
    mode: 0o700,
  })
  const marker = {
    createdAt: new Date(now()).toISOString(),
    status: "DISPATCH_STARTED",
    probe: preflight.probe,
    request: preflight.wireRequest,
  }
  const file = await open(markerPath, "wx", 0o600)
  try {
    await file.writeFile(`${JSON.stringify(marker, null, 2)}\n`, "utf8")
    await file.sync()
  } finally {
    await file.close()
  }
  return markerPath
}

async function persistProbeOutcome({ markerPath, outcome, capture, result, error, secrets = [], now = Date.now }) {
  const marker = JSON.parse(await readFile(markerPath, "utf8"))
  if (marker.status !== "DISPATCH_STARTED") {
    throw new Error("Bitunix order probe marker is not awaiting a result")
  }
  marker.status = ["CONFIRMED", "REJECTED", "NOT_SENT", "OUTCOME_UNKNOWN"].includes(outcome)
    ? outcome
    : "OUTCOME_UNKNOWN"
  marker.completedAt = new Date(now()).toISOString()
  marker.capture = sanitizeDiagnosticValue({
    value: capture,
    secrets,
  })
  if (result) {
    marker.brokerResult = {
      ok: result.ok === true,
      mutationOutcome: result.mutationOutcome ?? marker.status,
      ...(result.data === undefined ? {} : {
        data: sanitizeDiagnosticValue({
          value: result.data,
          secrets,
        }),
      }),
      errors: Array.isArray(result.errors)
        ? result.errors.map((item) => ({
          name: item?.name ?? "Error",
          message: redactApiSecrets({
            message: String(item?.message ?? item).slice(0, 500),
            secrets,
          }),
          code: item?.code ?? null,
          exchangeCode: item?.exchangeCode ?? null,
          status: item?.status ?? null,
          kind: item?.kind ?? null,
        }))
        : [],
    }
  }
  const sourceError = error ?? result?.errors?.[0]
  if (sourceError) {
    marker.error = {
      name: sourceError.name ?? "Error",
      message: redactApiSecrets({
        message: String(sourceError.message ?? sourceError).slice(0, 500),
        secrets,
      }),
      code: sourceError.code ?? null,
      exchangeCode: sourceError.exchangeCode ?? null,
      status: sourceError.status ?? null,
      kind: sourceError.kind ?? null,
    }
  }
  const temporaryPath = `${markerPath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  })
  await rename(temporaryPath, markerPath)
}

/**
 * Run exactly one human-confirmed Bitunix Spot order probe.
 *
 * @param {object} input Dependencies and the reviewed probe identifier.
 * @returns {Promise<object>} Broker mutation result or explicit NOT_SENT decline.
 */
function createNotSentProbeError({ error }) {
  const notSentError = new Error(
    error?.message ?? "Bitunix order probe stopped before dispatch",
    { cause: error },
  )
  notSentError.name = "BitunixOrderProbeNotSentError"
  notSentError.mutationOutcome = "NOT_SENT"
  for (const field of ["code", "exchangeCode", "status", "kind"]) {
    if (error?.[field] !== undefined && error[field] !== null) {
      notSentError[field] = error[field]
    }
  }
  return notSentError
}

/**
 * Run exactly one human-confirmed Bitunix Spot order probe.
 *
 * @param {object} input Dependencies and the reviewed probe identifier.
 * @returns {Promise<object>} Broker mutation result or explicit NOT_SENT decline.
 */
export async function runBitunixOrderProbeAttempt({
  probeId,
  readBroker,
  createOrderBroker,
  confirm,
  createMarker,
  assertMatrixCanContinue,
  writeLine,
  capture = {},
  secrets = [],
} = {}) {
  getBitunixOrderProbe({ probeId })
  assertProbeAttemptDependencies({
    readBroker,
    createOrderBroker,
    confirm,
    createMarker,
    assertMatrixCanContinue,
    writeLine,
  })
  let orderBroker = null
  let connected = false
  let markerPath
  let dispatchStarted = false
  let result
  try {
    await assertMatrixCanContinue({ probeId })
    const preflight = await readOrderProbePreflight({
      readBroker,
      probeId,
    })
    writeLine(formatOrderProbePreflight({
      preflight,
    }))
    const approved = await confirm({
      preflight,
    })
    if (approved !== true) {
      writeLine("Operator declined. No order was sent.")
      return Object.freeze({
        ok: false,
        mutationOutcome: "NOT_SENT",
        declined: true,
      })
    }
    orderBroker = createOrderBroker({
      capture,
    })
    assertOrderMutationBroker({
      broker: orderBroker,
    })
    await orderBroker.connect()
    connected = true
    markerPath = await createMarker({
      preflight,
    })
    dispatchStarted = true
    result = await orderBroker.createOrder(preflight.orderInput)
    const outcome = result?.mutationOutcome ?? "OUTCOME_UNKNOWN"
    await persistProbeOutcome({
      markerPath,
      outcome,
      capture,
      result,
      secrets,
    })
    writeLine(formatOrderProbeResult({
      result,
      capture,
      secrets,
    }))
    writeLine(`Private probe evidence: ${markerPath}`)
    return result
  } catch (error) {
    if (!dispatchStarted) {
      throw createNotSentProbeError({
        error,
      })
    }
    if (markerPath) {
      try {
        await persistProbeOutcome({
          markerPath,
          outcome: "OUTCOME_UNKNOWN",
          capture,
          result,
          error,
          secrets,
        })
      } catch {
        // The exclusive DISPATCH_STARTED marker remains the fail-closed record.
      }
    }
    throw error
  } finally {
    if (connected) {
      try {
        await orderBroker.disconnect()
      } catch (error) {
        writeLine(`Warning: mutation Broker disconnect failed after probe: ${error.message}`)
      }
    }
  }
}

export { createCaptureRestClientFactory, createProbeMarker }
