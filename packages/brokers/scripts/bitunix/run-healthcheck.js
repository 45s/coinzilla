import { mkdir, writeFile } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { loadEnvFile } from "node:process"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Broker } from "../../src/index.js"
import { BitunixRestClient } from "../../src/infrastructure/bitunix/spot/api/rest-client.js"
import { runBitunixDiagnostics } from "./diagnostics/diagnostic-runner.js"
import { publishBitunixDiagnostics } from "./diagnostics/health-publisher.js"
import { assertBitunixOperatorInteractiveTerminal, createOneShotMarker, runBitunixOperatorOrderAttempt } from "./operator/order-attempt.js"
import { parseBitunixHealthcheckMode } from "./helpers/parse-healthcheck-mode.js"
import { sanitizeDiagnosticError } from "./helpers/diagnostic-values.js"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const brokersRoot = resolve(scriptDirectory, "../..")
const repositoryRoot = resolve(brokersRoot, "../..")
const envPath = resolve(brokersRoot, ".env.development")
const markerPath = resolve(brokersRoot, ".diagnostics/bitunix-hypeusdt-buy-limit-attempt.json")

function printHelp() {
  process.stdout.write([
    "Usage: pnpm --filter @coinzilla/brokers bitunix:healthcheck [--local|--publish|--place-order]",
    "",
    "Default / --publish: run LIVE read-only diagnostics and publish only an allowlisted sanitized report branch.",
    "--local: run LIVE read-only diagnostics and save a private local report without creating or pushing a branch.",
    "--place-order: run the fixed, one-shot LIVE HYPEUSDT BUY LIMIT operator attempt after all preflight guards and final Enter approval.",
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

function readBitunixApiCredentials({ env }) {
  const apiKey = env.BITUNIX_API_KEY?.trim()
  const apiSecret = env.BITUNIX_API_SECRET?.trim()
  if (!apiKey || !apiSecret) {
    throw new Error("Set BITUNIX_API_KEY and BITUNIX_API_SECRET in packages/brokers/.env.development")
  }
  return { apiKey, apiSecret }
}

function createBitunixBroker({ credentials, allowLiveOrderMutations }) {
  return new Broker({
    provider: "bitunix",
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
    tradingMode: "live",
    providerOptions: { allowLiveOrderMutations },
  })
}

function createLocalReportPath({ now }) {
  const timestamp = new Date(now()).toISOString().replaceAll(/[:.]/g, "-")
  return resolve(brokersRoot, ".diagnostics", `bitunix-${timestamp}.json`)
}

async function writeLocalReport({ report, outputPath }) {
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  })
}

function printLocalSummary({ report, outputPath }) {
  const { passed, failed, skipped, total } = report.summary
  const configuration = report.results.find((entry) => entry.operation === "diagnostic configuration")
  const missingCredentials = configuration?.response?.missingCredentialVariables ?? []
  process.stdout.write([
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

async function runLocalDiagnostics() {
  process.stdout.write("WARNING: this contacts the configured LIVE Bitunix Spot account using read-only requests.\n")
  const report = await runBitunixDiagnostics({
    env: process.env,
    brokerApiRestClientFactory: (options) => new BitunixRestClient(options),
  })
  const outputPath = createLocalReportPath({ now: Date.now })
  await writeLocalReport({ report, outputPath })
  printLocalSummary({ report, outputPath })
  if (report.summary.failed > 0) {
    process.exitCode = 1
  }
}

function printPublishedResult({ result }) {
  const { passed, failed, skipped, total } = result.report.summary
  process.stdout.write([
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

async function runPublishedHealthCheck() {
  process.stdout.write("WARNING: this contacts the configured LIVE Bitunix Spot API using read-only requests.\n")
  const result = await publishBitunixDiagnostics({
    repositoryRoot,
    runDiagnostics: ({ env, onProgress }) => runBitunixDiagnostics({
      env,
      onProgress,
      brokerApiRestClientFactory: (options) => new BitunixRestClient(options),
    }),
    env: process.env,
    onProgress: ({ message }) => process.stdout.write(`${message}\n`),
  })
  printPublishedResult({ result })
  process.exitCode = result.exitCode
}

async function askForBitunixOrderConfirmation({ order }) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    const answer = await readline.question(
      `Press ENTER to submit this LIVE ${order.side} ${order.type} ${order.symbol} order (${order.quantity} HYPE at ${order.price} USDT; ${order.notional} USDT notional), or type anything to decline: `,
    )
    return answer === ""
  } finally {
    readline.close()
  }
}

function redactBitunixApiSecrets({ message, secrets }) {
  let safeMessage = String(message)
  for (const secret of secrets) {
    if (secret) {
      safeMessage = safeMessage.replaceAll(secret, "[REDACTED]")
    }
  }
  return safeMessage
}

async function runOperatorOrderAttempt() {
  assertBitunixOperatorInteractiveTerminal({
    stdin: process.stdin,
    stdout: process.stdout,
  })
  const credentials = readBitunixApiCredentials({ env: process.env })
  process.stdout.write(
    "WARNING: this command can submit one real Bitunix Spot LIVE order. Review every preflight value before pressing ENTER.\n",
  )
  const readBroker = createBitunixBroker({
    credentials,
    allowLiveOrderMutations: false,
  })
  const result = await runBitunixOperatorOrderAttempt({
    readBroker,
    createOrderBroker: () => createBitunixBroker({
      credentials,
      allowLiveOrderMutations: true,
    }),
    confirm: askForBitunixOrderConfirmation,
    createMarker: ({ preflight }) => createOneShotMarker({
      markerPath,
      preflight,
    }),
    writeLine: (message) => process.stdout.write(`${redactBitunixApiSecrets({
      message,
      secrets: [credentials.apiKey, credentials.apiSecret],
    })}\n`),
  })
  if (!result.declined && (result.ok !== true || result.mutationOutcome !== "CONFIRMED")) {
    process.exitCode = 1
  }
}

function reportOperatorFailure({ error }) {
  const message = redactBitunixApiSecrets({
    message: error?.message ?? error,
    secrets: [process.env.BITUNIX_API_KEY, process.env.BITUNIX_API_SECRET],
  })
  process.stderr.write(`Bitunix operator order attempt stopped: ${message}\n`)
  process.stderr.write(
    "If the one-shot marker exists or dispatch may have started, do not rerun; reconcile manually first.\n",
  )
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
    await runOperatorOrderAttempt()
    return
  }
  loadLocalEnvironment({ allowMissing: mode === "local" })
  if (mode === "local") {
    await runLocalDiagnostics()
    return
  }
  await runPublishedHealthCheck()
}

const isMainModule = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMainModule) {
  const args = process.argv.slice(2)
  runBitunixHealthcheck({ args }).catch((error) => {
    if (args.includes("--place-order")) {
      reportOperatorFailure({ error })
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
