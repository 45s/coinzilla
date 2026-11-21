import { readFileSync } from "node:fs"
import { loadEnvFile } from "node:process"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { assertInteractiveTerminal } from "./helpers/validate-order-attempt.js"
import { runOperatorOrderCommand, reportOperatorFailure } from "./operator/run-order-command.js"
import { runHealthcheckWorkflow } from "./workflows/run-healthcheck.js"
import { parseHealthcheckMode } from "./helpers/parse-healthcheck-mode.js"
import { sanitizeDiagnosticError } from "./helpers/sanitize-diagnostic-data.js"
import { resolveCliIdentity } from "./helpers/cli-identity.js"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const brokersRoot = resolve(scriptDirectory, "../..")
const repositoryRoot = resolve(brokersRoot, "../..")
const envPath = resolve(brokersRoot, ".env.development")
const packageMetadata = JSON.parse(readFileSync(resolve(brokersRoot, "package.json"), "utf8"))

function printCliIdentity({ stdout = process.stdout } = {}) {
  const identity = resolveCliIdentity({
    scriptName: "bitunix:healthcheck",
    packageVersion: packageMetadata.version,
    repositoryRoot,
  })
  stdout.write(`${identity}\n`)
}

function printHelp() {
  process.stdout.write([
    "Usage: pnpm --filter @coinzilla/brokers bitunix:healthcheck [--version|--local|--publish|--place-order]",
    "",
    "Default / --publish: run LIVE read-only diagnostics and publish only an allowlisted sanitized report branch.",
    "--local: run LIVE read-only diagnostics and save a private local report without creating or pushing a branch.",
    "--place-order: run read-only health checks, then (only if healthy) the guarded one-shot LIVE HYPEUSDT BUY LIMIT attempt; publish its sanitized result and return to develop.",
    "--version: print package version, source commit, worktree state, and Node version without loading credentials or contacting Bitunix.",
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
  if (mode === "place-order") {
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
    return
  }
  loadLocalEnvironment({ allowMissing: mode === "local" })
  process.exitCode = await runHealthcheckWorkflow({
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
  runHealthcheck({ args }).catch((error) => {
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
