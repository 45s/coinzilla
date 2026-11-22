import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { BitunixRestClient } from "../../../src/infrastructure/bitunix/spot/api/rest-client.js"
import { Broker } from "../../../src/index.js"
import { sanitizeDiagnosticError, sanitizeDiagnosticValue } from "../helpers/sanitize-diagnostic-data.js"
import { runDiagnostics as runReadOnlyDiagnostics } from "../diagnostics/run-diagnostics.js"
import { publishHealthReport } from "./publish-health-report.js"
import { evaluateReadOnlyHealthCheck, evaluateOperatorOrderProbeHealthCheck } from "../helpers/health-report.js"
import { appendOrderAttemptResult } from "../helpers/append-order-attempt-result.js"
import { createDiagnosticReport } from "../helpers/create-diagnostic-report.js"

function createLocalDiagnosticReportPath({ brokersRoot, now }) {
  const timestamp = new Date(now()).toISOString().replaceAll(/[:.]/g, "-")
  return resolve(brokersRoot, ".diagnostics", `bitunix-${timestamp}.json`)
}

async function writeLocalDiagnosticReport({ report, outputPath }) {
  await mkdir(dirname(outputPath), {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  })
}

function printLocalDiagnosticSummary({ report, outputPath, stdout }) {
  const { passed, failed, skipped, total } = report.summary
  const configuration = report.results.find((entry) => entry.operation === "diagnostic configuration")
  const missingCredentials = configuration?.response?.missingCredentialVariables ?? []
  stdout.write([
    "Bitunix read-only diagnostics completed.",
    `Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total).`,
    ...(missingCredentials.length > 0
      ? [`Authenticated checks skipped. Configure both BITUNIX_API_KEY and BITUNIX_API_SECRET (missing: ${missingCredentials.join(", ")}).`]
      : []),
    `Report: ${outputPath}`,
    "No order placement/cancellation, withdrawal, or transfer operations were attempted.",
    "",
  ].join("\n"))
}

async function runBitunixOrderReadScan({
  env,
  report,
  stdout,
  brokerFactory = (options) => new Broker(options),
}) {
  const secrets = [env.BITUNIX_API_KEY, env.BITUNIX_API_SECRET].filter(Boolean)
  const record = (operation, result, extra = {}) => {
    const entry = {
      operation,
      status: result?.ok === true ? "passed" : "failed",
      durationMs: extra.durationMs ?? null,
      request: extra.request ?? null,
      response: sanitizeDiagnosticValue({
        value: result,
        secrets,
      }),
      ...(result?.errors?.length
        ? {
          errors: result.errors.map((error) => sanitizeDiagnosticError({
            error,
            secrets,
          })),
        }
        : {}),
    }
    report.results.push(entry)
    report.summary.total += 1
    report.summary[entry.status] += 1
    stdout.write(`      ${operation}: ${entry.status.toUpperCase()}\\n`)
  }
  const logger = Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [
    level,
    (event) => report.events.push(sanitizeDiagnosticValue({
      value: {
        timestamp: new Date().toISOString(),
        level,
        ...event,
      },
      secrets,
    })),
  ]))
  const broker = brokerFactory({
    provider: "bitunix",
    apiKey: env.BITUNIX_API_KEY,
    apiSecret: env.BITUNIX_API_SECRET,
    tradingMode: "live",
    logger,
    providerOptions: {
      allowLiveOrderMutations: false,
    },
  })
  let connected = false
  try {
    await broker.connect()
    connected = true
    const started = Date.now()
    let openOrdersResult
    try {
      openOrdersResult = await broker.getOpenOrders()
      record("Broker API getOpenOrders", openOrdersResult, {
        durationMs: Date.now() - started,
        request: {
          method: "getOpenOrders",
          arguments: [],
        },
      })
    } catch (error) {
      record("Broker API getOpenOrders", {
        ok: false,
        errors: [error],
      }, {
        durationMs: Date.now() - started,
        request: {
          method: "getOpenOrders",
          arguments: [],
        },
      })
      return
    }
    if (!openOrdersResult?.ok) {
      return
    }
    for (const order of openOrdersResult.data ?? []) {
      const detailStarted = Date.now()
      const request = {
        method: "getOrder",
        arguments: [{
          symbol: order.symbol,
          orderId: order.id,
        }],
      }
      try {
        const detailResult = await broker.getOrder({
          symbol: order.symbol,
          orderId: order.id,
        })
        record("Broker API getOrder", detailResult, {
          durationMs: Date.now() - detailStarted,
          request,
        })
      } catch (error) {
        record("Broker API getOrder", {
          ok: false,
          errors: [error],
        }, {
          durationMs: Date.now() - detailStarted,
          request,
        })
      }
    }
  } catch (error) {
    record("Broker API order-read scan", {
      ok: false,
      errors: [error],
    }, {
      request: {
        method: "Broker.connect",
      },
    })
  } finally {
    if (connected) {
      try {
        await broker.disconnect()
      } catch (error) {
        record("Broker API disconnect", {
          ok: false,
          errors: [error],
        })
      }
    }
  }
}

async function runLocalDiagnostics({ brokersRoot, env, stdout, brokerFactory }) {
  stdout.write("WARNING: this contacts the configured LIVE Bitunix Spot account using read-only requests.\n")
  const report = await runReadOnlyDiagnostics({
    env,
    brokerApiRestClientFactory: (options) => new BitunixRestClient(options),
  })
  await runBitunixOrderReadScan({ env, report, stdout, brokerFactory })
  const outputPath = createLocalDiagnosticReportPath({
    brokersRoot,
    now: Date.now,
  })
  await writeLocalDiagnosticReport({
    report,
    outputPath,
  })
  printLocalDiagnosticSummary({
    report,
    outputPath,
    stdout,
  })
  return report.summary.failed > 0 ? 1 : 0
}

function createPublishedStatusLines({ result, operatorAttempt, probeMode }) {
  const lines = [
    probeMode
      ? "General diagnostics: SKIPPED (focused order-probe mode)"
      : `Diagnostics: ${result.report.summary.failed === 0 ? "HEALTHY" : "DEGRADED"}`,
    probeMode
      ? `Operator probe gate: ${result.healthCheck.healthy ? "READY" : "BLOCKED"}`
      : `Diagnostic safety/configuration gate: ${result.healthCheck.healthy ? "READY" : "BLOCKED"}`,
  ]
  if (probeMode) {
    lines.push("The selected probe uses its own fresh Broker preflight; general diagnostics do not gate dispatch.")
  }
  if (operatorAttempt?.probeId) {
    lines.push(`Order probe: ${operatorAttempt.probeId}`)
  }
  if (operatorAttempt) {
    lines.push(`${probeMode ? "Operator order probe" : "Operator order attempt"}: ${operatorAttempt.status.toUpperCase()}`)
  }
  if (result.healthCheck.missingRequiredOperations.length > 0) {
    lines.push(`Required gate checks not passed: ${result.healthCheck.missingRequiredOperations.join(", ")}`)
  }
  return lines
}

function createPublishedReportLines({ result }) {
  return [
    `Workflow result: ${result.exitCode === 0 ? "SUCCESS" : "FAILED"}`,
    `Report branch: ${result.branch}`,
    `Report commit: ${result.commitSha ?? "not created"}`,
    `Published report: ${result.reportPath}`,
    `Local report: ${result.localReportPath}`,
    "Returned to develop.",
    ...(result.pushError ? [`Push failed: ${result.pushError}`] : []),
  ]
}

function printPublishedResult({ result, stdout, probeMode = false }) {
  const { passed, failed, skipped, total } = result.report.summary
  const operatorAttempt = result.report.results.find((entry) =>
    entry.operation === "operator order attempt" || entry.operation === "operator order probe")
  const lines = [
    "Bitunix Spot workflow completed.",
    `Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total).`,
    ...createPublishedStatusLines({
      result,
      operatorAttempt,
      probeMode,
    }),
    ...createPublishedReportLines({
      result,
    }),
    "",
  ]
  stdout.write(lines.join("\n"))
}

function createEmptyProbeReport({ startedAt }) {
  const timestamp = new Date(startedAt).toISOString()
  return createDiagnosticReport({
    startedAt: timestamp,
    finishedAt: timestamp,
    runtime: {
      node: process.version,
      platform: process.platform,
    },
    results: [],
    events: [],
  })
}

function createHealthCheckSkippedResult({ report, env }) {
  return appendOrderAttemptResult({
    report,
    operatorResult: {
      ok: false,
      mutationOutcome: "NOT_SENT",
      skipped: true,
      skipCode: "HEALTHCHECK_NOT_HEALTHY",
    },
    durationMs: 0,
    secrets: [env.BITUNIX_API_KEY, env.BITUNIX_API_SECRET].filter(Boolean),
  })
}

async function runSelectedOperator({ runOperatorOrder, runOperatorProbe, env, probeId }) {
  try {
    if (runOperatorProbe) {
      return await runOperatorProbe({
        env,
        probeId,
      })
    }
    return await runOperatorOrder({ env })
  } catch (error) {
    return {
      ok: false,
      mutationOutcome: error?.mutationOutcome === "NOT_SENT"
        ? "NOT_SENT"
        : "OUTCOME_UNKNOWN",
      errors: [error],
    }
  }
}

function appendSelectedOperatorResult({
  report,
  operatorResult,
  startedAt,
  env,
  runOperatorProbe,
  probeId,
}) {
  return appendOrderAttemptResult({
    report,
    operatorResult,
    durationMs: Date.now() - startedAt,
    probeId: runOperatorProbe ? probeId : undefined,
    probeMode: Boolean(runOperatorProbe),
    secrets: [env.BITUNIX_API_KEY, env.BITUNIX_API_SECRET].filter(Boolean),
  })
}

async function runDiagnosticsWithOperatorAttempt({
  env,
  onProgress,
  runDiagnostics,
  runOperatorOrder,
  runOperatorProbe,
  probeId,
  brokerFactory,
}) {
  const startedAt = Date.now()
  const report = runOperatorProbe
    ? createEmptyProbeReport({ startedAt })
    : await runDiagnostics({
      env,
      onProgress,
      brokerApiRestClientFactory: (options) => new BitunixRestClient(options),
    })
  if (!runOperatorProbe) {
    await runBitunixOrderReadScan({
      env,
      report,
      stdout: {
        write: (message) => onProgress?.({ message: message.trim() }),
      },
      brokerFactory,
    })
  }
  if (!runOperatorOrder && !runOperatorProbe) {
    return report
  }
  if (runOperatorOrder && !evaluateReadOnlyHealthCheck({ report }).healthy) {
    return createHealthCheckSkippedResult({
      report,
      env,
    })
  }
  onProgress?.({
    message: runOperatorProbe
      ? `      General diagnostics skipped; running focused HYPEUSDT preflight for ${probeId}`
      : "      Read-only health checks passed; starting the guarded HYPEUSDT operator attempt",
  })
  const operatorResult = await runSelectedOperator({
    runOperatorOrder,
    runOperatorProbe,
    env,
    probeId,
  })
  const appendedReport = appendSelectedOperatorResult({
    report,
    operatorResult,
    startedAt,
    env,
    runOperatorProbe,
    probeId,
  })
  return runOperatorProbe
    ? {
      ...appendedReport,
      finishedAt: new Date().toISOString(),
    }
    : appendedReport
}

function createOperatorWarning({ runOperatorOrder, runOperatorProbe, probeId }) {
  if (runOperatorProbe) {
    return `WARNING: this mode runs a targeted LIVE read-only HYPEUSDT preflight, then may submit exactly one separately confirmed ${probeId} order probe.\n`
  }
  if (runOperatorOrder) {
    return "WARNING: this mode runs LIVE read-only diagnostics, then may submit one fixed LIVE HYPEUSDT order after the health check and operator preflight pass.\n"
  }
  return "WARNING: this contacts the configured LIVE Bitunix Spot API using read-only requests.\n"
}

async function runPublishedHealthCheck({
  repositoryRoot,
  env,
  stdout,
  runDiagnostics,
  publishDiagnostics,
  runOperatorOrder,
  runOperatorProbe,
  probeId,
  brokerFactory,
}) {
  stdout.write(createOperatorWarning({
    runOperatorOrder,
    runOperatorProbe,
    probeId,
  }))
  const result = await publishDiagnostics({
    repositoryRoot,
    healthCheckEvaluator: runOperatorProbe
      ? evaluateOperatorOrderProbeHealthCheck
      : evaluateReadOnlyHealthCheck,
    runDiagnostics: (input) => runDiagnosticsWithOperatorAttempt({
      ...input,
      runDiagnostics,
      runOperatorOrder,
      runOperatorProbe,
      probeId,
      brokerFactory,
    }),
    env,
    onProgress: ({ message }) => stdout.write(`${message}\n`),
  })
  printPublishedResult({
    result,
    stdout,
    probeMode: Boolean(runOperatorProbe),
  })
  return result.exitCode
}

/**
 * Run a read-only health-check mode or a human-controlled order mode inside the report workflow.
 *
 * @param {{mode: "local"|"publish"|"place-order"|"probe-order", probeId?: string, brokersRoot: string, repositoryRoot: string, env: NodeJS.ProcessEnv, stdout?: NodeJS.WriteStream, runOperatorOrder?: (input: {env: NodeJS.ProcessEnv}) => Promise<object>, runOperatorProbe?: (input: {env: NodeJS.ProcessEnv, probeId: string}) => Promise<object>}} input
 * @returns {Promise<number>} Process exit code.
 */
export async function runHealthcheckWorkflow({
  mode,
  probeId,
  brokersRoot,
  repositoryRoot,
  env,
  stdout = process.stdout,
  runDiagnostics = runReadOnlyDiagnostics,
  publishDiagnostics = publishHealthReport,
  runOperatorOrder,
  runOperatorProbe,
  brokerFactory,
} = {}) {
  if (mode === "local") {
    return runLocalDiagnostics({
      brokersRoot,
      env,
      stdout,
      brokerFactory,
    })
  }
  if (mode === "publish" || mode === "place-order" || mode === "probe-order") {
    if (mode === "place-order" && typeof runOperatorOrder !== "function") {
      throw new TypeError("The Bitunix place-order mode requires an operator order runner")
    }
    if (mode === "probe-order" &&
        (typeof runOperatorProbe !== "function" || typeof probeId !== "string" || !probeId.trim())) {
      throw new TypeError("The Bitunix probe-order mode requires a probe id and operator probe runner")
    }
    return runPublishedHealthCheck({
      repositoryRoot,
      env,
      stdout,
      runDiagnostics,
      publishDiagnostics,
      runOperatorOrder,
      runOperatorProbe,
      probeId,
      brokerFactory,
    })
  }
  throw new TypeError(`Unsupported Bitunix health-check mode: ${mode}`)
}
