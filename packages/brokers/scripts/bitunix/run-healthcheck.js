import { loadEnvFile } from "node:process"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { assertInteractiveTerminal } from "./helpers/validate-order-attempt.js"
import { runOperatorOrderCommand, reportOperatorFailure } from "./operator/run-order-command.js"
import { runOperatorOrderProbeCommand, reportOrderProbeFailure } from "./operator/run-order-probe-command.js"
import { getBitunixOrderProbe } from "./operator/order-probe-matrix.js"
import { runHealthcheckWorkflow } from "./workflows/run-healthcheck.js"
import { parseHealthcheckMode } from "./helpers/parse-healthcheck-mode.js"
import { sanitizeDiagnosticError } from "./helpers/sanitize-diagnostic-data.js"
import { printCliIdentity } from "../../../../scripts/cli-identity.js"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const brokersRoot = resolve(scriptDirectory, "../..")
const repositoryRoot = resolve(brokersRoot, "../..")
const envPath = resolve(brokersRoot, ".env.development")

function printHelp() {
  process.stdout.write([
    "Usage: pnpm --filter @coinzilla/brokers bitunix:healthcheck [--version|--local|--publish|--full-diagnostics|--place-order|--cancel-existing-order|--probe-order=<probe-id>]",
    "",
    "Default / --publish: run only the LIVE read-only order scan (getOpenOrders, then getOrder for every discovered order) and publish a sanitized report branch.",
    "--local: run only the LIVE read-only order scan and save a private local report without creating or pushing a branch.",
    "--full-diagnostics: run the broader existing account, REST, and WebSocket diagnostics in addition to the order scan.",
    "--place-order: run the existing read-only health checks, then (only if healthy) the guarded one-shot LIVE HYPEUSDT BUY LIMIT attempt.",
    "--probe-order=<id>: run targeted read-only HYPEUSDT preflight and one separately confirmed LIVE order probe; publish its sanitized result and return to develop.",
    "--probe-order=limit-buy-11-usdt: BUY HYPEUSDT LIMIT at 30 USDT, spend up to 11 USDT; quantity is calculated from live basePrecision. Confirm with y/N.",
    "--cancel-existing-order: cancel only the recorded HYPEUSDT order once, record the result, then run the existing read-only order scan.",
    "--version: print package version, source commit, worktree state, and Node version without loading credentials or contacting Bitunix.",
    "--help: show this help without loading credentials or contacting Bitunix.",
    "",
    "The default mode never places or cancels orders, transfers funds, or withdraws.",
    "Cancellation mode is an explicit one-shot LIVE mutation; ambiguous outcomes are never retried.",
    "The order-read scan records the complete getOpenOrders result and every getOrder result/error; order IDs come from getOpenOrders data, never CLI arguments.",
    "The broader diagnostics remain implemented and tested; they are not deleted, only skipped by default.",
    "LIVE order modes are human-only and must never be invoked by AI agents, tests, CI, or scheduled jobs.",
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

async function runProbeOrderMode({ args }) {
  const probeId = args[0].slice("--probe-order=".length)
  getBitunixOrderProbe({ probeId })
  assertInteractiveTerminal({
    stdin: process.stdin,
    stdout: process.stdout,
  })
  loadLocalEnvironment()
  process.exitCode = await runHealthcheckWorkflow({
    mode: "probe-order",
    probeId,
    brokersRoot,
    repositoryRoot,
    env: process.env,
    runOperatorProbe: async ({ env, probeId: selectedProbeId }) => {
      try {
        return await runOperatorOrderProbeCommand({
          env,
          brokersRoot,
          probeId: selectedProbeId,
        })
      } catch (error) {
        reportOrderProbeFailure({
          error,
          env,
        })
        throw error
      }
    },
  })
}

async function runFixedOrderMode() {
  assertInteractiveTerminal({
    stdin: process.stdin,
    stdout: process.stdout,
  })
  loadLocalEnvironment()
  process.exitCode = await runHealthcheckWorkflow({
    mode: "place-order",
    brokersRoot,
    repositoryRoot,
    env: process.env,
    runOperatorOrder: async ({ env }) => {
      try {
        return await runOperatorOrderCommand({
          env,
          brokersRoot,
        })
      } catch (error) {
        reportOperatorFailure({
          error,
          env,
        })
        throw error
      }
    },
  })
}

async function runReadOnlyMode({ mode, includeGeneralDiagnostics = false }) {
  loadLocalEnvironment({
    allowMissing: mode === "local",
  })
  process.exitCode = await runHealthcheckWorkflow({
    mode,
    includeGeneralDiagnostics,
    brokersRoot,
    repositoryRoot,
    env: process.env,
  })
}

async function runHealthcheck({ args = process.argv.slice(2) } = {}) {
  printCliIdentity({
    packageRoot: brokersRoot,
    repositoryRoot,
    scriptName: "bitunix:healthcheck",
  })
  const mode = parseHealthcheckMode({ args })
  if (mode === "help") {
    printHelp()
    return
  }
  if (mode === "version") {
    return
  }
  if (mode === "full-diagnostics") {
    await runReadOnlyMode({
      mode: "publish",
      includeGeneralDiagnostics: true,
    })
    return
  }
  if (mode === "cancel-existing-order") {
    assertInteractiveTerminal({
      stdin: process.stdin,
      stdout: process.stdout,
    })
    loadLocalEnvironment()
    process.exitCode = await runHealthcheckWorkflow({
      mode,
      brokersRoot,
      repositoryRoot,
      env: process.env,
    })
    return
  }
  if (mode === "probe-order") {
    await runProbeOrderMode({ args })
    return
  }
  if (mode === "place-order") {
    await runFixedOrderMode()
    return
  }
  await runReadOnlyMode({ mode })
}

const isMainModule = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMainModule) {
  const args = process.argv.slice(2)
  runHealthcheck({ args }).catch((error) => {
    if (args.some((argument) => argument.startsWith("--probe-order="))) {
      reportOrderProbeFailure({
        error,
        env: process.env,
      })
      process.exitCode = 1
      return
    }
    if (args.includes("--place-order")) {
      reportOperatorFailure({
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
