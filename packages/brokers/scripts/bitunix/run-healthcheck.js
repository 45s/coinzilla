import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
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
import { formatCliIdentity } from "./helpers/cli-identity.js"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const brokersRoot = resolve(scriptDirectory, "../..")
const repositoryRoot = resolve(brokersRoot, "../..")
const envPath = resolve(brokersRoot, ".env.development")
const packageMetadata = JSON.parse(readFileSync(resolve(brokersRoot, "package.json"), "utf8"))

function readGitOutput({ args }) {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return null
  }
}

function printCliIdentity({ stdout = process.stdout } = {}) {
  const commitSha = readGitOutput({
    args: ["rev-parse", "HEAD"],
  })
  const worktreeStatus = readGitOutput({
    args: ["status", "--porcelain"],
  })
  let worktree = "unknown"
  if (worktreeStatus !== null) {
    worktree = worktreeStatus.length === 0 ? "clean" : "dirty"
  }
  const identity = formatCliIdentity({
    packageName: packageMetadata.name,
    scriptName: "bitunix:healthcheck",
    packageVersion: packageMetadata.version,
    commitSha,
    worktree,
    nodeVersion: process.version,
  })
  stdout.write(`${identity}\n`)
}

function printHelp() {
  process.stdout.write([
    "Usage: pnpm --filter @coinzilla/brokers bitunix:healthcheck [--version|--local|--publish|--place-order|--probe-order=<probe-id>]",
    "",
    "Default / --publish: run LIVE read-only diagnostics, fetch all open orders through Broker.getOpenOrders(), read each returned order through Broker.getOrder(), and publish a sanitized report branch.",
    "--local: run LIVE read-only diagnostics and save a private local report without creating or pushing a branch.",
    "--place-order: run read-only health checks, then (only if healthy) the guarded one-shot LIVE HYPEUSDT BUY LIMIT attempt.",
    "--probe-order=<id>: run targeted read-only HYPEUSDT preflight and one separately confirmed LIVE order probe; publish its sanitized result and return to develop.",
    "--probe-order=limit-buy-11-usdt: BUY HYPEUSDT LIMIT at 30 USDT, spend up to 11 USDT; quantity is calculated from live basePrecision. Confirm with y/N.",
    "--version: print package version, source commit, worktree state, and Node version without loading credentials or contacting Bitunix.",
    "--help: show this help without loading credentials or contacting Bitunix.",
    "",
    "The default mode never places or cancels orders, transfers funds, or withdraws.",
    "The order-read scan records the complete getOpenOrders result and every getOrder result/error; order IDs come from getOpenOrders data, never CLI arguments."
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

async function runReadOnlyMode({ mode }) {
  loadLocalEnvironment({
    allowMissing: mode === "local",
  })
  process.exitCode = await runHealthcheckWorkflow({
    mode,
    brokersRoot,
    repositoryRoot,
    env: process.env,
  })
}

async function runHealthcheck({ args = process.argv.slice(2) } = {}) {
  printCliIdentity()
  const mode = parseHealthcheckMode({ args })
  if (mode === "help") {
    printHelp()
    return
  }
  if (mode === "version") {
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
