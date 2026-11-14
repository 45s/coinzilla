import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { defaultLogger } from "@coinzilla/utils"
import { createFileOperationalStateStore } from "../src/infrastructure/operational-state/create-file-operational-state-store.js"
import { resolveOperationalStateDirectory } from "../src/infrastructure/operational-state/resolve-operational-state-directory.js"
import { runOfflineMarketRecovery } from "./recovery-market-context.js"

const HELP = `Usage:
  node apps/harvester/scripts/recovery-market.js --context <evidence.json>
  node apps/harvester/scripts/recovery-market.js --context <evidence.json> --confirm

Options:
  --context <path>  Offline evidence bundle (required)
  --confirm         Explicitly append the reviewed coverage fact after a READY audit
  --help            Show this help

The command never connects to Binance, starts Harvester, places/cancels orders,
or initializes the Operational State Store. --confirm requires an existing store at
OPERATIONAL_STATE_DIRECTORY (or the legacy DURABLE_FACTS_DIRECTORY override) and a runtimeSessionId in the evidence bundle.
`

export function parseRecoveryMarketArguments(args = []) {
  if (!Array.isArray(args)) { throw new TypeError("CLI arguments must be an array") }
  const parsed = { confirm: false, help: false, contextPath: undefined }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--help") {
      parsed.help = true
      continue
    }
    if (argument === "--confirm") {
      if (parsed.confirm) { throw new Error("--confirm must not be repeated") }
      parsed.confirm = true
      continue
    }
    if (argument === "--context") {
      if (parsed.contextPath !== undefined) { throw new Error("--context must not be repeated") }
      const value = args[index + 1]
      if (!value || value.startsWith("--")) { throw new Error("--context requires a file path") }
      parsed.contextPath = value
      index += 1
      continue
    }
    throw new Error("Unknown recovery CLI argument: " + argument)
  }
  if (!parsed.help && !parsed.contextPath) { throw new Error("--context is required") }
  return Object.freeze(parsed)
}

function summarizeResult({ result }) {
  if (result?.ok !== true) {
    return {
      ok: false,
      errors: (result?.errors ?? [new Error("Offline market recovery failed")]).map((error) => ({
        code: error?.code,
        message: error?.message ?? String(error),
      })),
    }
  }
  return { ok: true, data: result.data }
}

/**
 * Execute the offline recovery CLI with injectable I/O for deterministic tests.
 */
export async function runRecoveryMarketCommand({
  args = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  readContext = readFile,
  writeOutput = (value) => process.stdout.write(value + "\n"),
  writeError = (value) => defaultLogger.error({ message: "Offline market recovery CLI failed", error: value }),
} = {}) {
  let parsed
  try {
    parsed = parseRecoveryMarketArguments(args)
    if (parsed.help) {
      writeOutput(HELP)
      return 0
    }
    const contextPath = path.resolve(cwd, parsed.contextPath)
    const raw = await readContext(contextPath, "utf8")
    const context = JSON.parse(raw)
    let durableFactsStore
    if (parsed.confirm) {
      let directory
      try {
        directory = resolveOperationalStateDirectory({ env })
      } catch (cause) {
        throw new Error("--confirm requires a valid OPERATIONAL_STATE_DIRECTORY (or legacy DURABLE_FACTS_DIRECTORY) directory", { cause })
      }
      if (typeof context.runtimeSessionId !== "string" || !context.runtimeSessionId.trim()) {
        throw new Error("--confirm requires a non-empty runtimeSessionId in the offline evidence bundle")
      }
      durableFactsStore = createFileOperationalStateStore({
        directory,
        runtimeSessionId: context.runtimeSessionId,
      })
    }

    const result = await runOfflineMarketRecovery({
      context,
      confirm: parsed.confirm,
      durableFactsStore,
    })
    const summary = summarizeResult({ result })
    writeOutput(JSON.stringify(summary, null, 2))
    if (!summary.ok) { return 1 }
    if (parsed.confirm) { return summary.data.confirmation?.confirmed === true ? 0 : 2 }
    return summary.data.reconciliation?.ready === true ? 0 : 2
  } catch (error) {
    writeError(error?.message ?? String(error))
    return 1
  }
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url

if (isDirectExecution) {
  process.exitCode = await runRecoveryMarketCommand()
}
