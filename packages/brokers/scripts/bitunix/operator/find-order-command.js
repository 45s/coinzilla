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
    providerOptions: {
      allowLiveOrderMutations: false,
    },
  })
}

function safeValue({ value, secrets }) {
  if (Array.isArray(value)) {
    return value.map((item) => safeValue({ value: item, secrets }))
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      isPrivateField({ key })
        ? "[REDACTED]"
        : safeValue({ value: child, secrets }),
    ]))
  }
  if (typeof value !== "string") {
    return value
  }
  return redactApiSecrets({
    message: value,
    secrets,
  })
}

function isPrivateField({ key }) {
  return /api.?key|secret|sign|nonce|email|phone|address|user.?id|uid/i.test(key)
}

function serializeError({ error, secrets }) {
  const details = {
    name: error?.name,
    code: error?.code,
    kind: error?.kind,
    exchangeCode: error?.exchangeCode,
    status: error?.status,
    path: error?.path,
    message: error?.message ?? String(error),
    outcomeUnknown: error?.outcomeUnknown,
  }
  return safeValue({
    value: details,
    secrets,
  })
}

function serializeResult({ result, secrets }) {
  const errors = (result?.errors ?? []).map((error) => serializeError({
    error,
    secrets,
  }))
  return safeValue({
    value: {
      ok: result?.ok === true,
      data: result?.data ?? null,
      errors,
      mutationOutcome: result?.mutationOutcome ?? null,
      cancellationOutcome: result?.cancellationOutcome ?? null,
      reconciliation: result?.reconciliation ?? null,
    },
    secrets,
  })
}

function createLogger({ stdout, secrets, report }) {
  const levels = ["debug", "info", "warn", "error"]
  return Object.fromEntries(levels.map((level) => [
    level,
    (event) => {
      const safeEvent = safeValue({
        value: {
          level,
          ...event,
        },
        secrets,
      })
      report.diagnostics.push(safeEvent)
      stdout.write(`${JSON.stringify(safeEvent)}\n`)
    },
  ]))
}

function writeEvent({ stdout, event, secrets }) {
  const safeEvent = safeValue({
    value: event,
    secrets,
  })
  stdout.write(`${JSON.stringify(safeEvent)}\n`)
}

function createFailure({ operation, error, secrets }) {
  return {
    operation,
    ok: false,
    errors: [serializeError({
      error,
      secrets,
    })],
  }
}

function recordStage({ report, stdout, secrets, stage }) {
  report.stages.push(stage)
  if (stage.ok === false) {
    report.summary.failedRequestCount += 1
  }
  writeEvent({
    stdout,
    secrets,
    event: {
      event: "scan.stage",
      ...stage,
    },
  })
}

async function connectBroker({ broker, report, stdout, secrets }) {
  recordStage({
    report,
    stdout,
    secrets,
    stage: {
      operation: "broker.connect",
      started: true,
      ok: null,
    },
  })
  try {
    await broker.connect()
    return true
  } catch (error) {
    recordStage({
      report,
      stdout,
      secrets,
      stage: {
        ...createFailure({
          operation: "broker.connect",
          error,
          secrets,
        }),
        thrown: true,
      },
    })
    throw error
  }
}

async function fetchPendingOrders({ broker, report, stdout, secrets }) {
  try {
    const result = await broker.getOpenOrders()
    recordStage({
      report,
      stdout,
      secrets,
      stage: {
        operation: "broker.getOpenOrders",
        scope: "ALL_ACTIVE_SPOT_SYMBOLS",
        ok: result?.ok === true,
        result: serializeResult({
          result,
          secrets,
        }),
      },
    })
    return Array.isArray(result?.data) ? result.data : null
  } catch (error) {
    recordStage({
      report,
      stdout,
      secrets,
      stage: {
        ...createFailure({
          operation: "broker.getOpenOrders",
          error,
          secrets,
        }),
        scope: "ALL_ACTIVE_SPOT_SYMBOLS",
        thrown: true,
      },
    })
    return null
  }
}

function recordTargetMatch({ order, symbol, orderId, report }) {
  if (symbol !== TARGET_SYMBOL || order?.id !== orderId) {
    return
  }
  report.summary.targetMatches.push({
    symbol,
    orderId,
    pendingOrder: order,
  })
}

async function fetchOrderDetail({ broker, order, fallbackSymbol, report, stdout, secrets }) {
  const symbol = order?.symbol ?? fallbackSymbol
  const orderId = order?.id ?? null
  try {
    const result = await broker.getOrder({
      symbol,
      orderId,
    })
    recordStage({
      report,
      stdout,
      secrets,
      stage: {
        operation: "broker.getOrder",
        symbol,
        orderId,
        ok: result?.ok === true,
        result: serializeResult({
          result,
          secrets,
        }),
      },
    })
  } catch (error) {
    recordStage({
      report,
      stdout,
      secrets,
      stage: {
        ...createFailure({
          operation: "broker.getOrder",
          error,
          secrets,
        }),
        symbol,
        orderId,
        thrown: true,
      },
    })
  }
  report.summary.detailReadCount += 1
}

async function scanOpenOrders({ broker, orderId, report, stdout, secrets }) {
  writeEvent({
    stdout,
    secrets,
    event: {
      event: "pending-orders.account-wide.fetch.started",
    },
  })
  const orders = await fetchPendingOrders({
    broker,
    report,
    stdout,
    secrets,
  })
  if (orders === null) {
    return
  }
  report.summary.pendingOrderCount = orders.length
  for (const order of orders) {
    recordTargetMatch({
      order,
      symbol: order?.symbol ?? null,
      orderId,
      report,
    })
    await fetchOrderDetail({
      broker,
      order,
      fallbackSymbol: order?.symbol,
      report,
      stdout,
      secrets,
    })
  }
}

async function disconnectBroker({ broker, report, stdout, secrets }) {
  try {
    await broker.disconnect()
    recordStage({
      report,
      stdout,
      secrets,
      stage: {
        operation: "broker.disconnect",
        ok: true,
      },
    })
  } catch (error) {
    recordStage({
      report,
      stdout,
      secrets,
      stage: {
        ...createFailure({
          operation: "broker.disconnect",
          error,
          secrets,
        }),
        thrown: true,
      },
    })
  }
}

async function saveReport({ report, reportDirectory, stdout, stderr, secrets }) {
  const reportPath = resolve(
    reportDirectory,
    `bitunix-order-scan-${Date.now()}.json`,
  )
  try {
    await mkdir(reportDirectory, {
      recursive: true,
    })
    await writeFile(
      reportPath,
      `${JSON.stringify(safeValue({ value: report, secrets }), null, 2)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
      },
    )
    writeEvent({
      stdout,
      secrets,
      event: {
        event: "report.saved",
        reportPath,
      },
    })
    return reportPath
  } catch (error) {
    stderr.write(`REPORT ERROR: ${redactApiSecrets({
      message: error?.message ?? String(error),
      secrets,
    })}\n`)
    return null
  }
}


async function executeScan({ context }) {
  const {
    report,
    stdout,
    stderr,
    secrets,
  } = context
  try {
    context.broker = context.brokerFactory({
      credentials: context.credentials,
      logger: context.logger,
    })
    context.connected = await connectBroker({
      broker: context.broker,
      report,
      stdout,
      secrets,
    })
    await scanOpenOrders({
      broker: context.broker,
      orderId: context.orderId,
      report,
      stdout,
      secrets,
    })
  } catch (error) {
    report.fatalError = serializeError({
      error,
      secrets,
    })
    stderr.write(`SCAN ERROR: ${report.fatalError.message}\n`)
  } finally {
    if (context.connected && context.broker) {
      await disconnectBroker({
        broker: context.broker,
        report,
        stdout,
        secrets,
      })
    }
  }
}

async function finalizeScan({ context }) {
  const {
    report,
    reportDirectory,
    stdout,
    stderr,
    secrets,
  } = context
  const marketScan = report.diagnostics.find((event) =>
    event.event === "getOpenOrders.accountWide.completed",
  )
  report.summary.marketCount = marketScan?.marketCount ?? 0
  report.summary.targetMatchCount = report.summary.targetMatches.length
  report.completedAt = new Date().toISOString()
  const reportPath = await saveReport({
    report,
    reportDirectory,
    stdout,
    stderr,
    secrets,
  })
  const hasFailures = report.summary.failedRequestCount > 0 ||
    Boolean(report.fatalError) ||
    reportPath === null
  const found = report.summary.targetMatchCount === 1
  let exitCode = 2
  if (hasFailures) {
    exitCode = 1
  } else if (found) {
    exitCode = 0
  }
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
  return {
    exitCode,
    found,
    reportPath,
    report,
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
  brokerFactory = ({ credentials, logger }) => createBroker({
    credentials,
    logger,
  }),
  stdout = process.stdout,
  stderr = process.stderr,
  reportDirectory = resolve(import.meta.dirname, "../../../.diagnostics"),
} = {}) {
  const normalizedOrderId = validateOrderId({ orderId })
  const credentials = parseApiCredentials({ env })
  const secrets = [credentials.apiKey, credentials.apiSecret]
  const report = createScanReport({ orderId: normalizedOrderId })
  const logger = createLogger({
    stdout,
    secrets,
    report,
  })
  const context = {
    broker: null,
    brokerFactory,
    credentials,
    logger,
    orderId: normalizedOrderId,
    stdout,
    stderr,
    secrets,
    reportDirectory,
    connected: false,
    report,
  }
  await executeScan({ context })
  return finalizeScan({ context })
}

function createScanReport({ orderId }) {
  return {
    createdAt: new Date().toISOString(),
    provider: "bitunix",
    product: "spot",
    target: {
      symbol: TARGET_SYMBOL,
      orderId,
    },
    readOnly: true,
    stages: [],
    diagnostics: [],
    summary: {
      marketCount: 0,
      pendingOrderCount: 0,
      detailReadCount: 0,
      failedRequestCount: 0,
      targetMatches: [],
    },
  }
}
