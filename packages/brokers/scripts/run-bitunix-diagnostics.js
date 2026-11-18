import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { runBitunixDiagnostics } from "./bitunix-diagnostic-runner.js"
import { sanitizeDiagnosticError } from "./bitunix-diagnostics.js"

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
  process.stdout.write([
    "Bitunix read-only diagnostics completed.",
    `Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total).`,
    `Report: ${outputPath}`,
    "No order or withdrawal operations were attempted.",
    "",
  ].join("\n"))
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write([
      "Run read-only Bitunix Spot REST and authenticated WebSocket RPC diagnostics.",
      "BITUNIX_API_KEY and BITUNIX_API_SECRET are optional for public-only REST checks.",
      "Configure both credentials to enable private account reads and authenticated WebSocket RPC.",
      "BITUNIX_DIAGNOSTICS_DEPTH_PRECISION is optional; without it, depth RPC is skipped.",
      "Live-read confirmation and other diagnostic defaults are source constants.",
      "See packages/brokers/README.md for configuration and safety details.",
      "",
    ].join("\n"))
    return
  }
  process.stdout.write("WARNING: this contacts the configured LIVE Bitunix Spot API account using read-only requests.\n")
  const report = await runBitunixDiagnostics()
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
