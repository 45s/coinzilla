import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { BitunixRestClient } from "../../../src/infrastructure/bitunix/spot/api/rest-client.js"
import { runBitunixDiagnostics } from "./diagnostic-runner.js"
import { publishBitunixDiagnostics } from "./health-publisher.js"

function createLocalReportPath({ brokersRoot, now }) {
  const timestamp = new Date(now()).toISOString().replaceAll(/[:.]/g, "-")
  return resolve(brokersRoot, ".diagnostics", `bitunix-${timestamp}.json`)
}

async function writeLocalReport({ report, outputPath }) {
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

function printLocalSummary({ report, outputPath, stdout }) {
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
  const report = await runBitunixDiagnostics({
    env,
    brokerApiRestClientFactory: (options) => new BitunixRestClient(options),
  })
  const outputPath = createLocalReportPath({
    brokersRoot,
    now: Date.now,
  })
  await writeLocalReport({
    report,
    outputPath,
  })
  printLocalSummary({
    report,
    outputPath,
    stdout,
  })
  return report.summary.failed > 0 ? 1 : 0
}

function printPublishedResult({ result, stdout }) {
  const { passed, failed, skipped, total } = result.report.summary
  stdout.write([
    "Bitunix Spot health check completed.",
    `Checks: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total).`,
    `Overall: ${result.exitCode === 0 ? "HEALTHY" : "FAILED"}`,
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

async function runPublishedHealthCheck({ repositoryRoot, env, stdout }) {
  stdout.write("WARNING: this contacts the configured LIVE Bitunix Spot API using read-only requests.\n")
  const result = await publishBitunixDiagnostics({
    repositoryRoot,
    runDiagnostics: ({ env: diagnosticEnv, onProgress }) => runBitunixDiagnostics({
      env: diagnosticEnv,
      onProgress,
      brokerApiRestClientFactory: (options) => new BitunixRestClient(options),
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
 * Run one of the two read-only health-check modes.
 *
 * @param {{mode: "local"|"publish", brokersRoot: string, repositoryRoot: string, env: NodeJS.ProcessEnv, stdout?: NodeJS.WriteStream}} input
 * @returns {Promise<number>} Process exit code.
 */
export async function runBitunixHealthcheckDiagnostics({
  mode,
  brokersRoot,
  repositoryRoot,
  env,
  stdout = process.stdout,
} = {}) {
  if (mode === "local") {
    return runLocalDiagnostics({
      brokersRoot,
      env,
      stdout,
    })
  }
  if (mode === "publish") {
    return runPublishedHealthCheck({
      repositoryRoot,
      env,
      stdout,
    })
  }
  throw new TypeError(`Unsupported read-only Bitunix health-check mode: ${mode}`)
}
