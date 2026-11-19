import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { runBitunixDiagnostics } from "./diagnostic-runner.js"
import { sanitizeDiagnosticError } from "./diagnostics.js"
import { publishBitunixDiagnostics } from "./health-publisher.js"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

function printHelp() {
  process.stdout.write([
    "Run read-only Bitunix Spot diagnostics and publish a sanitized report branch.",
    "Run from packages/brokers on a clean develop checkout: node scripts/bitunix-healthcheck.js",
    "Credentials are loaded from packages/brokers/.env.development.",
    "The report branch is pushed to origin and the local checkout returns to develop.",
    "Only redacted diagnostic metadata is committed; local reports stay ignored.",
    "No orders, withdrawals, transfers or other mutations are attempted.",
    "",
  ].join("\n"))
}

function printResult({ result }) {
  const { passed, failed, skipped, total } = result.report.summary
  const lines = [
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
  ]
  process.stdout.write(lines.join("\n"))
}

async function main() {
  if (process.argv.includes("--help")) {
    printHelp()
    return
  }
  process.stdout.write("WARNING: this contacts the configured LIVE Bitunix Spot API using read-only requests.\n")
  const result = await publishBitunixDiagnostics({
    repositoryRoot,
    runDiagnostics: ({ env, onProgress }) => runBitunixDiagnostics({
      env,
      onProgress,
    }),
    env: process.env,
    onProgress: ({ message }) => process.stdout.write(`${message}\n`),
  })
  printResult({ result })
  process.exitCode = result.exitCode
}

const isMainModule = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

export async function runBitunixHealthCheck() {
  try {
    await main()
  } catch (error) {
    const sanitized = sanitizeDiagnosticError({
      error,
      secrets: [process.env.BITUNIX_API_KEY, process.env.BITUNIX_API_SECRET].filter(Boolean),
    })
    process.stderr.write(`Bitunix health check failed: ${JSON.stringify(sanitized)}\n`)
    process.exitCode = 1
  }
}

if (isMainModule) {
  runBitunixHealthCheck()
}
