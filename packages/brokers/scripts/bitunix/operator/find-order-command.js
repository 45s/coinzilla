import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Broker } from "../../../src/index.js"
import { parseApiCredentials, redactApiSecrets } from "../helpers/api-credentials.js"

const TARGET_SYMBOL = "HYPEUSDT"

function validateOrderId({ orderId }) {
  if (typeof orderId !== "string" || !/^[0-9]+$/.test(orderId)) {
    throw new TypeError("Bitunix order lookup requires an exact digit-string --order-id value")
  }
  return orderId
}

function createBroker({ credentials, logger }) {
  return new Broker({
    provider: "bitunix",
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    tradingMode: "live",
    logger,
    providerOptions: { allowLiveOrderMutations: false },
  })
}

function safeValue({ value, secrets }) {
  if (Array.isArray(value)) return value.map((item) => safeValue({ value: item, secrets }))
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      /api.?key|secret|sign|nonce|email|phone|address|user.?id|uid/i.test(key)
        ? "[REDACTED]"
        : safeValue({ value: child, secrets }),
    ]))
  }
  return typeof value === "string" ? redactApiSecrets({ message: value, secrets }) : value
}

function serializeError({ error, secrets }) {
  return safeValue({
    secrets,
    value: {
      name: error?.name ?? "Error",
      code: error?.code ?? null,
      kind: error?.kind ?? null,
      exchangeCode: error?.exchangeCode ?? null,
      status: error?.status ?? null,
      path: error?.path ?? null,
      message: error?.message ?? String(error),
      outcomeUnknown: error?.outcomeUnknown ?? false,
    },
  })
}

function serializeResult({ result, secrets }) {
  return safeValue({
    secrets,
    value: {
      ok: result?.ok === true,
      data: result?.data ?? null,
      errors: (result?.errors ?? []).map((error) => serializeError({ error, secrets })),
      mutationOutcome: result?.mutationOutcome ?? null,
      cancellationOutcome: result?.cancellationOutcome ?? null,
      reconciliation: result?.reconciliation ?? null,
    },
  })
}

function createLogger({ stdout, secrets }) {
  return Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [
    level,
    (event) => stdout.write(`${JSON.stringify(safeValue({ value: { level, ...event }, secrets }))}\n`),
  ]))
}

function writeEvent({ stdout, event, secrets }) {
  stdout.write(`${JSON.stringify(safeValue({ value: event, secrets }))}\n`)
}

function createFailure({ operation, error }) {
  return {
    operation,
    ok: false,
    errors: [{
      name: error?.name ?? "Error",
      code: error?.code ?? null,
      kind: error?.kind ?? null,
      exchangeCode: error?.exchangeCode ?? null,
      status: error?.status ?? null,
      path: error?.path ?? null,
      message: error?.message ?? String(error),
    }],
  }
}

/**
 * Scan every active Bitunix Spot market using only the public Broker API.
 * Every pending-order and per-order detail result is recorded; failures do
 * not abort later symbols or orders. No mutation method is called.
 *
 * @param {{env: NodeJS.ProcessEnv, orderId: string, brokerFactory?: Function, stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream, reportDirectory?: string}} input
 * @returns {Promise<{exitCode: number, found: boolean, reportPath: string|null, report: object}>}
 */
export async function runFindBitunixSpotOrder({
  env,
  orderId,
  brokerFactory = ({ credentials, logger }) => createBroker({ credentials, logger }),
  stdout = process.stdout,
  stderr = process.stderr,
  reportDirectory = resolve(process.cwd(), "packages/brokers/.diagnostics"),
} = {}) {
  const normalizedOrderId = validateOrderId({ orderId })
  const credentials = parseApiCredentials({ env })
  const secrets = [credentials.apiKey, credentials.apiSecret]
  const logger = createLogger({ stdout, secrets })
  const report = {
    createdAt: new Date().toISOString(),
    provider: "bitunix",
    product: "spot",
    target: { symbol: TARGET_SYMBOL, orderId: normalizedOrderId },
    readOnly: true,
    stages: [],
    summary: {
      marketCount: 0,
      pendingOrderCount: 0,
      detailReadCount: 0,
      failedRequestCount: 0,
      targetMatches: [],
    },
  }
  let broker
  let connected = false
  let reportPath = null

  const record = (stage) => {
    report.stages.push(stage)
    if (stage.ok === false) report.summary.failedRequestCount += 1
    writeEvent({ stdout, secrets, event: { event: "scan.stage", ...stage } })
  }

  try {
    broker = brokerFactory({ credentials, logger })
    await broker.connect()
    connected = true
    record({ operation: "broker.connect", ok: true })

    let marketsResult
    try {
      marketsResult = await broker.getExchangeMarkets()
      record({
        operation: "broker.getExchangeMarkets",
        ok: marketsResult?.ok === true,
        result: serializeResult({ result: marketsResult, secrets }),
      })
    } catch (error) {
      record({ ...createFailure({ operation: "broker.getExchangeMarkets", error }), thrown: true })
      marketsResult = null
    }

    if (marketsResult?.ok !== true || !Array.isArray(marketsResult.data)) {
      throw new Error("Bitunix Broker API getExchangeMarkets() failed; see diagnostic report")
    }

    const markets = marketsResult.data
    report.summary.marketCount = markets.length
    const symbols = [...new Set(markets.map((market) => market?.symbol).filter(
      (symbol) => typeof symbol === "string" && symbol.length > 0,
    ))]
    record({
      operation: "market.enumeration",
      ok: symbols.length > 0,
      activeMarketCount: markets.length,
      uniqueSymbolCount: symbols.length,
      symbols,
    })
    if (symbols.length === 0) throw new Error("Bitunix Broker API returned no active Spot symbols")

    for (const symbol of symbols) {
      let openOrdersResult
      try {
        writeEvent({ stdout, secrets, event: { event: "pending-orders.fetch.started", symbol } })
        openOrdersResult = await broker.getOpenOrders({ symbol })
        record({
          operation: "broker.getOpenOrders",
          symbol,
          ok: openOrdersResult?.ok === true,
          result: serializeResult({ result: openOrdersResult, secrets }),
        })
      } catch (error) {
        record({ ...createFailure({ operation: "broker.getOpenOrders", error }), symbol, thrown: true })
        continue
      }

      if (openOrdersResult?.ok !== true || !Array.isArray(openOrdersResult.data)) continue
      report.summary.pendingOrderCount += openOrdersResult.data.length

      for (const order of openOrdersResult.data) {
        const identity = { symbol: order?.symbol ?? symbol, orderId: order?.id ?? null }
        if (identity.symbol === TARGET_SYMBOL && identity.orderId === normalizedOrderId) {
          report.summary.targetMatches.push({
            symbol: identity.symbol,
            orderId: identity.orderId,
            pendingOrder: order,
          })
        }

        try {
          writeEvent({ stdout, secrets, event: { event: "order-detail.fetch.started", ...identity } })
          const detailResult = await broker.getOrder({
            symbol: identity.symbol,
            orderId: identity.orderId,
          })
          record({
            operation: "broker.getOrder",
            ...identity,
            ok: detailResult?.ok === true,
            result: serializeResult({ result: detailResult, secrets }),
          })
        } catch (error) {
          record({
            ...createFailure({ operation: "broker.getOrder", error }),
            ...identity,
            thrown: true,
          })
        }
        report.summary.detailReadCount += 1
      }
    }
  } catch (error) {
    report.fatalError = serializeError({ error, secrets })
    stderr.write(`SCAN ERROR: ${report.fatalError.message}\n`)
  } finally {
    if (connected) {
      try {
        await broker.disconnect()
        record({ operation: "broker.disconnect", ok: true })
      } catch (error) {
        record({ ...createFailure({ operation: "broker.disconnect", error }), thrown: true })
      }
    }
    report.summary.targetMatchCount = report.summary.targetMatches.length
    report.completedAt = new Date().toISOString()
    reportPath = resolve(reportDirectory, `bitunix-order-scan-${Date.now()}.json`)
    try {
      await mkdir(reportDirectory, { recursive: true })
      await writeFile(reportPath, `${JSON.stringify(safeValue({ value: report, secrets }), null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      })
      writeEvent({ stdout, secrets, event: { event: "report.saved", reportPath } })
    } catch (error) {
      stderr.write(`REPORT ERROR: ${redactApiSecrets({ message: error?.message ?? String(error), secrets })}\n`)
      reportPath = null
    }
  }

  const hasFailures = report.summary.failedRequestCount > 0 || Boolean(report.fatalError) || reportPath === null
  const found = report.summary.targetMatchCount === 1
  const exitCode = hasFailures ? 1 : found ? 0 : 2
  writeEvent({
    stdout,
    secrets,
    event: {
      event: "scan.completed",
      exitCode,
      found,
      summary: report.summary,
      reportPath,
      mutationsPerformed: false,
    },
  })
  return { exitCode, found, reportPath, report }
}
