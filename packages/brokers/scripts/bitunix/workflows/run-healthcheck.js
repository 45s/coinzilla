import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { BitunixRestClient } from "../../../src/infrastructure/bitunix/spot/api/rest-client.js"
import { runDiagnostics } from "../diagnostics/run-diagnostics.js"
import { publishHealthReport } from "./publish-health-report.js"
import { evaluateReadOnlyHealthCheck } from "../helpers/health-report.js"
import { appendOrderAttemptResult } from "../helpers/append-order-attempt-result.js"

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

async function runLocalDiagnostics({ brokersRoot, env, stdout }) {
  stdout.write("WARNING: this contacts the configured LIVE Bitunix Spot account using read-only requests.\n")
  const report = await runDiagnostics({
    env,
    brokerApiRestClientFactory: (options) => new BitunixRestClient(options),
  })
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

function printPublishedResult({ result, stdout }) {
  const { passed, failed, skipped, total } = result.report.summary
  const operatorAttempt = result.report.results.find((entry) => entry.operation === "operator order attempt")
  stdout.write([
    "Bitunix Spot health check completed.",
    `Checks: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total).`,
    `Overall: ${result.exitCode === 0 ? "HEALTHY" : "FAILED"}`,
    ...(operatorAttempt ? [`Operator order attempt: ${operatorAttempt.status.toUpperCase()}`] : []),
    ...(result.healthCheck.missingRequiredOperations.length > 0
      ? [`Required checks not passed: ${result.healthCheck.missingRequiredOperations.join(", ")}`]
      : []),
    `Report branch: ${result.branch}`,
    `Report commit: ${result.commitSha ?? "not created"}`,
    `Published report: ${result.reportPath}`,
    `Local report: ${result.localReportPath}`,
    "Returned to develop.",
    ...(result.pushError ? [`Push failed: ${result.pushError}`] : []),
    "",
  ].join("\n"))
}

async function runDiagnosticsWithOperatorAttempt({
  env,
  onProgress,
  runDiagnostics,
  runOperatorOrder,
}) {
  const report = await runDiagnostics({
    env,
    onProgress,
    brokerApiRestClientFactory: (options) => new BitunixRestClient(options),
  })
  if (!runOperatorOrder) {
    return report
  }
  if (!evaluateReadOnlyHealthCheck({ report }).healthy) {
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
  onProgress?.({
    message: "      Read-only health checks passed; starting the guarded HYPEUSDT operator attempt",
  })
  const startedAt = Date.now()
  let operatorResult
  try {
    operatorResult = await runOperatorOrder({ env })
  } catch (error) {
    operatorResult = {
      ok: false,
      mutationOutcome: "OUTCOME_UNKNOWN",
      errors: [error],
    }
  }
  return appendOrderAttemptResult({
    report,
    operatorResult,
    durationMs: Date.now() - startedAt,
    secrets: [env.BITUNIX_API_KEY, env.BITUNIX_API_SECRET].filter(Boolean),
  })
}

async function runPublishedHealthCheck({
  repositoryRoot,
  env,
  stdout,
  runDiagnostics,
  publishDiagnostics,
  runOperatorOrder,
}) {
  stdout.write(runOperatorOrder
    ? "WARNING: this mode runs LIVE read-only diagnostics, then may submit one fixed LIVE HYPEUSDT order after the health check and operator preflight pass.\n"
    : "WARNING: this contacts the configured LIVE Bitunix Spot API using read-only requests.\n")
  const result = await publishDiagnostics({
    repositoryRoot,
    runDiagnostics: (input) => runDiagnosticsWithOperatorAttempt({
      ...input,
      runDiagnostics,
      runOperatorOrder,
    }),
    env,
    onProgress: ({ message }) => stdout.write(`${message}\n`),
  })
  printPublishedResult({
    result,
    stdout,
  })
  return result.exitCode
}

/**
 * Run a read-only health-check mode or the guarded order mode inside the report workflow.
 *
 * @param {{mode: "local"|"publish"|"place-order", brokersRoot: string, repositoryRoot: string, env: NodeJS.ProcessEnv, stdout?: NodeJS.WriteStream, runOperatorOrder?: (input: {env: NodeJS.ProcessEnv}) => Promise<object>}} input
 * @returns {Promise<number>} Process exit code.
 */
export async function runHealthcheckWorkflow({
  mode,
  brokersRoot,
  repositoryRoot,
  env,
  stdout = process.stdout,
  runDiagnostics = runDiagnostics,
  publishDiagnostics = publishHealthReport,
  runOperatorOrder,
} = {}) {
  if (mode === "local") {
    return runLocalDiagnostics({
      brokersRoot,
      env,
      stdout,
    })
  }
  if (mode === "publish" || mode === "place-order") {
    if (mode === "place-order" && typeof runOperatorOrder !== "function") {
      throw new TypeError("The Bitunix place-order mode requires an operator order runner")
    }
    return runPublishedHealthCheck({
      repositoryRoot,
      env,
      stdout,
      runDiagnostics,
      publishDiagnostics,
      runOperatorOrder,
    })
  }
  throw new TypeError(`Unsupported Bitunix health-check mode: ${mode}`)
}
