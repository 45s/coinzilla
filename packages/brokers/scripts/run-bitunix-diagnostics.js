import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { BitunixRestClient } from "../src/infrastructure/bitunix/api/rest-client.js"
import { runBitunixDiagnostics } from "./diagnostic-runner.js"
import { sanitizeDiagnosticError } from "./diagnostics.js"

function createOutputPath({ now }) {
  const timestamp = new Date(now()).toISOString().replaceAll(/[:.]/g, "-")
  return resolve(process.cwd(), ".diagnostics", `bitunix-${timestamp}.json`)
}

async function writeReport({ report, outputPath }) {
  await mkdir(resolve(outputPath, ".."), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  })
}

function printSummary({
    report,
    outputPath,
  }) {
  const { passed, failed, skipped, total } = report.summary
  const configuration = report.results.find((entry) => entry.operation === "diagnostic configuration")
  const missingCredentials = configuration?.response?.missingCredentialVariables ?? []
  const lines = [
    "Bitunix read-only diagnostics completed.",
    `Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total).`,
    ...(missingCredentials.length > 0
      ? [`Authenticated checks skipped. Configure both BITUNIX_API_KEY and BITUNIX_API_SECRET (missing: ${missingCredentials.join(", ")}).`]
      : []),
    `Report: ${outputPath}`,
    "No order placement/cancellation, withdrawal, or transfer operations were attempted.",
    "",
  ]
  process.stdout.write(lines.join("\n"))
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write([
      "Run read-only Bitunix Spot REST and authenticated WebSocket RPC diagnostics.",
      "Public-only mode runs unsigned REST and public Broker API checks; authenticated REST, Broker API, and WebSocket RPC checks are skipped unless both credentials are set.",
      "BITUNIX_API_KEY and BITUNIX_API_SECRET are optional for public-only REST checks.",
      "Configure both credentials to enable private account, open-order, order-history, and authenticated WebSocket RPC reads.",
      "BITUNIX_DIAGNOSTICS_DEPTH_PRECISION is optional; without it, REST and WebSocket depth checks are skipped.",
      "Read-only Broker API checks use the same public constructor as applications; response schema observations report field names and types only.",
      "Live-read confirmation and other diagnostic defaults are source constants.",
      "See packages/brokers/README.md for configuration and safety details.",
      "",
    ].join("\n"))
    return
  }
  process.stdout.write("WARNING: this contacts the configured LIVE Bitunix Spot API account using read-only requests.\n")
  const report = await runBitunixDiagnostics({
    brokerApiRestClientFactory: (options) => new BitunixRestClient(options),
  })
  const outputPath = createOutputPath({ now: Date.now })
  await writeReport({
    report,
    outputPath,
  })
  printSummary({
    report,
    outputPath,
  })
  if (report.summary.failed > 0) {
    process.exitCode = 1
  }
}

const isMainModule = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMainModule) {
  main().catch((error) => {
    const sanitized = sanitizeDiagnosticError({
      error,
      secrets: [process.env.BITUNIX_API_KEY, process.env.BITUNIX_API_SECRET].filter(Boolean),
    })
    process.stderr.write(`Bitunix diagnostics failed: ${JSON.stringify(sanitized)}\n`)
    process.exitCode = 1
  })
}
