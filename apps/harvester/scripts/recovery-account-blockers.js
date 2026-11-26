import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { defaultLogger } from "@coinzilla/utils"
import { createFileOperationalStateStore } from "../src/infrastructure/operational-state/create-file-store.js"
import { resolveOperationalStateDirectory } from "../src/infrastructure/operational-state/resolve-directory.js"
import { runOfflineAccountBlockerResolution } from "./recovery-account-blockers-context.js"

const HELP = `Usage:
  node apps/harvester/scripts/recovery-account-blockers.js --context <account-evidence.json> --operator-id <id> --action-id <unique-id> --cause-fixed

Options:
  --context <path>    Shared account evidence plus per-market coverage/trade-history evidence (required)
  --operator-id <id>  Operator identity recorded in the durable resolution fact (required)
  --action-id <id>    Unique operator action ID for idempotent audit correlation (required)
  --cause-fixed       Explicitly attest that the underlying account cause has been fixed (required)
  --help              Show this help

The command requires the matching Harvester process to be cleanly stopped and an existing
Operational State Store. It runs the production offline account/order/fill audit for every
configured market, then appends durable resolution facts and verifies readback. It does not
connect to an exchange, place/cancel/replace orders, restart Harvester, clear runtime flags,
or reopen trading. After success, perform a controlled restart and require a fresh authoritative
account snapshot before trading admission can reopen.
`

export function parseRecoveryAccountBlockerArguments(args = []) {
  if (!Array.isArray(args)) {
    throw new TypeError("CLI arguments must be an array")
  }
  const parsed = {
    contextPath: undefined,
    operatorId: undefined,
    actionId: undefined,
    causeFixed: false,
    help: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--help") {
      parsed.help = true
      continue
    }
    if (argument === "--cause-fixed") {
      if (parsed.causeFixed) {
        throw new Error("--cause-fixed must not be repeated")
      }
      parsed.causeFixed = true
      continue
    }
    if (["--context", "--operator-id", "--action-id"].includes(argument)) {
      const value = args[index + 1]
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`)
      }
      const key = {
        "--context": "contextPath",
        "--operator-id": "operatorId",
        "--action-id": "actionId",
      }[argument]
      if (parsed[key] !== undefined) {
        throw new Error(`${argument} must not be repeated`)
      }
      parsed[key] = value
      index += 1
      continue
    }
    throw new Error(`Unknown account blocker recovery argument: ${argument}`)
  }
  if (!parsed.help) {
    if (!parsed.contextPath) {
      throw new Error("--context is required")
    }
    if (!parsed.operatorId || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{2,127}$/.test(parsed.operatorId)) {
      throw new Error("--operator-id must be 3-128 canonical characters")
    }
    if (!parsed.actionId || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{7,127}$/.test(parsed.actionId)) {
      throw new Error("--action-id must be a unique 8-128 character token")
    }
    if (parsed.causeFixed !== true) {
      throw new Error("--cause-fixed is required to confirm the underlying cause is fixed")
    }
  }
  return Object.freeze(parsed)
}

function createResolutionStore({ context, env }) {
  if (typeof context.runtimeSessionId !== "string" || !context.runtimeSessionId.trim()) {
    throw new Error("Account evidence bundle requires the stopped runtimeSessionId")
  }
  let directory
  try {
    directory = resolveOperationalStateDirectory({ env })
  } catch (cause) {
    throw new Error("Account blocker resolution requires a valid OPERATIONAL_STATE_DIRECTORY", { cause })
  }
  return createFileOperationalStateStore({
    directory,
    runtimeSessionId: context.runtimeSessionId,
  })
}

function summarizeResult(result) {
  if (result?.ok !== true) {
    return {
      ok: false,
      errors: (result?.errors ?? [new Error("Offline account blocker resolution failed")]).map((error) => ({
        code: error?.code,
        message: error?.message ?? String(error),
      })),
    }
  }
  return {
    ok: true,
    data: {
      resolvedBlockerIds: result.data.resolvedBlockerIds,
      evidenceDigest: result.data.evidenceDigest,
      durableReadbackVerified: result.data.durableReadbackVerified,
      readiness: result.data.readiness,
      requiresControlledRestart: result.data.requiresControlledRestart,
      runtimeStateReset: result.data.runtimeStateReset,
      recoverySellerStopReset: result.data.recoverySellerStopReset,
    },
  }
}

export async function runRecoveryAccountBlockerCommand({
  args = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  readContext = readFile,
  writeOutput = (value) => process.stdout.write(`${value}\n`),
  writeError = (value) => defaultLogger.error({
    message: "Offline account blocker recovery CLI failed",
    error: value,
  }),
} = {}) {
  try {
    const parsed = parseRecoveryAccountBlockerArguments(args)
    if (parsed.help) {
      writeOutput(HELP)
      return 0
    }
    const contextPath = path.resolve(cwd, parsed.contextPath)
    const context = JSON.parse(await readContext(contextPath, "utf8"))
    const operationalStateStore = createResolutionStore({ context, env })
    const result = await runOfflineAccountBlockerResolution({
      context,
      operationalStateStore,
      operatorId: parsed.operatorId,
      actionId: parsed.actionId,
      causeFixed: parsed.causeFixed,
    })
    const summary = summarizeResult(result)
    writeOutput(JSON.stringify(summary, null, 2))
    return summary.ok && summary.data.durableReadbackVerified === true ? 0 : 1
  } catch (error) {
    writeError(error)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runRecoveryAccountBlockerCommand()
  process.exitCode = exitCode
}
