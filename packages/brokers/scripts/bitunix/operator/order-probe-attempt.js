import { open, readFile, rename, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { BitunixRestClient } from "../../../src/infrastructure/bitunix/spot/api/rest-client.js"
import { BITUNIX_SPOT_ORDER_API } from "../../../src/infrastructure/bitunix/spot/adapters/order-requests.js"
import { redactApiSecrets } from "../helpers/api-credentials.js"
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
      if (parsedUrl.pathname !== BITUNIX_SPOT_ORDER_API.placeOrder) {
        return fetchFn(url, options)
      }
      capture.request = {
        method: options.method,
        path: parsedUrl.pathname,
        body: options.body ?? null,
      }
      let response
      try {
        response = await fetchFn(url, options)
      } catch (error) {
        capture.transportError = {
          name: error?.name ?? "Error",
          message: String(error?.message ?? error).slice(0, 500),
        }
        throw error
      }
      try {
        capture.response = {
          httpStatus: response.status,
          httpOk: response.ok,
          body: await response.clone().text(),
        }
      } catch (error) {
        capture.responseReadError = {
          name: error?.name ?? "Error",
          message: String(error?.message ?? error).slice(0, 500),
        }
      }
      return response
    },
  })
}

function assertProbeAttemptDependencies({ readBroker, createOrderBroker, confirm, createMarker, writeLine }) {
  const readMethods = ["connect", "getExchangeMarkets", "getSymbolFilters", "getBalances", "getOpenOrders", "disconnect"]
  if (!readBroker || readMethods.some((method) => typeof readBroker[method] !== "function")) {
    throw new TypeError("Bitunix order probe requires a read-only Broker with market, filter, balance and open-order methods")
  }
  for (const [name, value] of [
    ["createOrderBroker", createOrderBroker],
    ["confirm", confirm],
    ["createMarker", createMarker],
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
    `HYPE balance: free ${preflight.freeBaseBalance}; locked ${preflight.lockedBaseBalance}`,
    `USDT balance: free ${preflight.freeQuoteBalance}; locked ${preflight.lockedQuoteBalance}`,
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
  marker.capture = {
    ...capture,
    ...(capture.response?.body === undefined ? {} : {
      response: {
        ...capture.response,
        body: redactApiSecrets({
          message: capture.response.body,
          secrets,
        }),
      },
    }),
    ...(capture.transportError?.message === undefined ? {} : {
      transportError: {
        ...capture.transportError,
        message: redactApiSecrets({
          message: capture.transportError.message,
          secrets,
        }),
      },
    }),
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
export async function runBitunixOrderProbeAttempt({
  probeId,
  readBroker,
  createOrderBroker,
  confirm,
  createMarker,
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
    writeLine,
  })
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
  const orderBroker = createOrderBroker({
    capture,
  })
  assertOrderMutationBroker({
    broker: orderBroker,
  })
  let connected = false
  let markerPath
  let result
  try {
    await orderBroker.connect()
    connected = true
    markerPath = await createMarker({
      preflight,
    })
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
