import { loadEnvFile } from "node:process"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { assertBitunixOperatorInteractiveTerminal } from "./operator/order-attempt.js"
import { runBitunixOperatorOrderCommand, reportBitunixOperatorFailure } from "./operator/order-command.js"
import { runBitunixHealthcheckDiagnostics } from "./diagnostics/healthcheck-command.js"
import { parseBitunixHealthcheckMode } from "./helpers/parse-healthcheck-mode.js"
import { sanitizeDiagnosticError } from "./helpers/diagnostic-values.js"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const brokersRoot = resolve(scriptDirectory, "../..")
const repositoryRoot = resolve(brokersRoot, "../..")
const envPath = resolve(brokersRoot, ".env.development")

function printHelp() {
  process.stdout.write([
    "Usage: pnpm --filter @coinzilla/brokers bitunix:healthcheck [--local|--publish|--place-order]",
    "",
    "Default / --publish: run LIVE read-only diagnostics and publish only an allowlisted sanitized report branch.",
    "--local: run LIVE read-only diagnostics and save a private local report without creating or pushing a branch.",
    "--place-order: run read-only health checks, then (only if healthy) the guarded one-shot LIVE HYPEUSDT BUY LIMIT attempt; publish its sanitized result and return to develop.",
    "--help: show this help without loading credentials or contacting Bitunix.",
    "",
    "The default mode never places or cancels orders, transfers funds, or withdraws.",
    "The LIVE order mode is human-only and must never be invoked by AI agents, tests, CI, or scheduled jobs.",
    "",
  ].join("\n"))
}

function loadLocalEnvironment({ allowMissing = false } = {}) {
  try {
    loadEnvFile(envPath)
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") {
      return
    }
    throw new Error("Bitunix health check requires packages/brokers/.env.development. Create it with BITUNIX_API_KEY and BITUNIX_API_SECRET.", {
      cause: error,
    })
  }
}

async function runBitunixHealthcheck({ args = process.argv.slice(2) } = {}) {
  const mode = parseBitunixHealthcheckMode({ args })
  if (mode === "help") {
    printHelp()
    return
  }
  if (mode === "place-order") {
    assertBitunixOperatorInteractiveTerminal({
      stdin: process.stdin,
      stdout: process.stdout,
    })
    loadLocalEnvironment()
    process.exitCode = await runBitunixHealthcheckDiagnostics({
      mode,
      brokersRoot,
      repositoryRoot,
      env: process.env,
      runOperatorOrder: async ({ env }) => {
        try {
          return await runBitunixOperatorOrderCommand({
            env,
            brokersRoot,
          })
        } catch (error) {
          reportBitunixOperatorFailure({
            error,
            env,
          })
          throw error
        }
      },
    })
    return
  }
  loadLocalEnvironment({ allowMissing: mode === "local" })
  process.exitCode = await runBitunixHealthcheckDiagnostics({
    mode,
    brokersRoot,
    repositoryRoot,
    env: process.env,
  })
}

const isMainModule = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMainModule) {
  const args = process.argv.slice(2)
  runBitunixHealthcheck({ args }).catch((error) => {
    if (args.includes("--place-order")) {
      reportBitunixOperatorFailure({
        error,
        env: process.env,
      })
      process.exitCode = 1
      return
    }
    const sanitized = sanitizeDiagnosticError({
      error,
      secrets: [process.env.BITUNIX_API_KEY, process.env.BITUNIX_API_SECRET].filter(Boolean),
    })
    process.stderr.write(`Bitunix health check failed: ${JSON.stringify(sanitized)}\n`)
    process.exitCode = 1
  })
}
