import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { captureBuildMetadata, defaultLogger } from "@coinzilla/utils"
import packageMetadata from "../package.json" with { type: "json" }
import {
  authenticateLocalOperator,
  hasControlCharacters,
  LOCAL_OPERATOR_ID_PATTERN,
} from "../src/infrastructure/security/local-operator-identity.js"
import { createFileOperationalStateStore } from "../src/infrastructure/operational-state/create-file-store.js"
import { resolveOperationalStateDirectory } from "../src/infrastructure/operational-state/resolve-directory.js"
import { runOfflineAccountBlockerResolution } from "../src/use-cases/resolve-offline-user-data-account-blockers.js"

const PACKAGE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const HELP = [
  "Usage: node scripts/recovery-account-blockers.js --context <path> --operator-id <current-os-user> --action-id <unique-id> --resolution-reason <text> --cause-fixed",
  "",
  "The operator ID must exactly match the authenticated operating-system account.",
  "The context file must contain one independently reviewed, complete offline account evidence bundle.",
  "The action ID is unique and may only be replayed with the same operator, reason, blocker set and evidence.",
  "This command is offline-only. It does not call an exchange or mutate account balances or orders.",
  "",
  "Options:",
  "  --context <path>             Reviewed account evidence bundle (JSON).",
  "  --operator-id <id>           Authenticated local operating-system account name.",
  "  --action-id <id>             Unique idempotency key for this resolution action.",
  "  --resolution-reason <text>   Operator's explicit explanation of why the cause is fixed.",
  "  --cause-fixed                Explicitly acknowledge that the underlying cause is fixed.",
  "  --version                    Print application/build identity and exit.",
  "  --help                       Print this help and exit.",
].join("\n")

const VALUE_ARGUMENT_KEYS = Object.freeze({
  "--context": "contextPath",
  "--operator-id": "operatorId",
  "--action-id": "actionId",
  "--resolution-reason": "resolutionReason",
})

function createRecoveryIdentity({ env = process.env } = {}) {
  const metadata = captureBuildMetadata({
    application: "harvester-account-blocker-recovery",
    version: packageMetadata.version,
    cwd: PACKAGE_DIRECTORY,
    env,
  })
  const { source } = metadata
  return [
    `${metadata.application} ${metadata.version}`,
    `commit ${source.commit ?? "unknown"}`,
    `worktree ${source.workingTree}`,
    `node ${process.version}`,
  ].join(" | ")
}

function consumeRecoveryArgument({ args, index, parsed }) {
  const argument = args[index]
  if (argument === "--help" || argument === "-h") {
    parsed.help = true
    return index
  }
  if (argument === "--version") {
    parsed.version = true
    return index
  }
  if (argument === "--cause-fixed") {
    if (parsed.causeFixed) {
      throw new Error("--cause-fixed must not be repeated")
    }
    parsed.causeFixed = true
    return index
  }
  const key = VALUE_ARGUMENT_KEYS[argument]
  if (!key) {
    throw new Error(`Unknown recovery argument: ${argument}`)
  }
  const value = args[index + 1]
  if (typeof value !== "string" || value.trim() === "" || value.startsWith("--")) {
    throw new Error(`${argument} requires a value`)
  }
  if (parsed[key] !== undefined) {
    throw new Error(`${argument} must not be repeated`)
  }
  parsed[key] = value
  return index + 1
}

function validateParsedArguments(parsed) {
  if (parsed.help || parsed.version) {
    return
  }
  if (typeof parsed.contextPath !== "string" || parsed.contextPath.trim() === "") {
    throw new Error("--context is required")
  }
  if (!LOCAL_OPERATOR_ID_PATTERN.test(parsed.operatorId ?? "")) {
    throw new Error("--operator-id must match a canonical 3-128 character OS account name")
  }
  if (typeof parsed.actionId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@-]{7,127}$/.test(parsed.actionId)) {
    throw new Error("--action-id must be a unique 8-128 character token")
  }
  if (typeof parsed.resolutionReason !== "string" ||
      parsed.resolutionReason.trim() !== parsed.resolutionReason ||
      parsed.resolutionReason.length < 8 ||
      parsed.resolutionReason.length > 512 ||
      hasControlCharacters(parsed.resolutionReason)) {
    throw new Error("--resolution-reason must contain 8-512 printable characters")
  }
  if (parsed.causeFixed !== true) {
    throw new Error("--cause-fixed is required to confirm the underlying cause is fixed")
  }
}

export function parseRecoveryAccountBlockerArguments(args = []) {
  if (!Array.isArray(args)) {
    throw new TypeError("CLI arguments must be an array")
  }
  const parsed = {
    contextPath: undefined,
    operatorId: undefined,
    actionId: undefined,
    resolutionReason: undefined,
    causeFixed: false,
    help: false,
    version: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    index = consumeRecoveryArgument({
      args,
      index,
      parsed,
    })
  }
  if (parsed.version && args.length !== 1) {
    throw new Error("--version must be used by itself")
  }
  validateParsedArguments(parsed)
  return Object.freeze(parsed)
}

function createResolutionStore({ context, env }) {
  if (typeof context?.runtimeSessionId !== "string" || !context.runtimeSessionId.trim()) {
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

function summarizeRecoveryResult({ result, parsed, operatorIdentity }) {
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
      operatorId: parsed.operatorId,
      operatorAuthMethod: operatorIdentity.authMethod,
      actionId: parsed.actionId,
      resolutionReason: parsed.resolutionReason,
      resolvedBlockerIds: result.data.resolvedBlockerIds,
      evidenceDigest: result.data.evidenceDigest,
      durableReadbackVerified: result.data.durableReadbackVerified,
      readiness: result.data.readiness,
      requiresControlledRestart: result.data.requiresControlledRestart,
      runtimeStateReset: result.data.runtimeStateReset,
      recoverySellerStopReset: result.data.recoverySellerStopReset,
      idempotentReplay: result.data.idempotentReplay === true,
    },
  }
}

async function executeRecoveryCommand({
  parsed,
  operatorIdentity,
  cwd,
  env,
  readContext,
  createStore,
  runResolution,
}) {
  const contextPath = path.resolve(cwd, parsed.contextPath)
  const context = JSON.parse(await readContext(contextPath, "utf8"))
  const operationalStateStore = await createStore({
    context,
    env,
  })
  const result = await runResolution({
    context,
    operationalStateStore,
    operatorId: parsed.operatorId,
    operatorIdentity,
    actionId: parsed.actionId,
    resolutionReason: parsed.resolutionReason,
    causeFixed: parsed.causeFixed,
  })
  return summarizeRecoveryResult({
    result,
    parsed,
    operatorIdentity,
  })
}

function parseCommandArguments({ args, writeError }) {
  try {
    return parseRecoveryAccountBlockerArguments(args)
  } catch (error) {
    writeError(error.message)
    return undefined
  }
}

function getCommandEarlyExit({ parsed, writeOutput }) {
  if (parsed.version) {
    return 0
  }
  if (parsed.help) {
    writeOutput(HELP)
    return 0
  }
  return undefined
}

function authenticateCommandOperator({ parsed, getUserInfo, writeError }) {
  try {
    return authenticateLocalOperator({
      operatorId: parsed.operatorId,
      getUserInfo,
    })
  } catch (error) {
    writeError(error.message)
    return undefined
  }
}

async function executeAuthenticatedCommand(options) {
  try {
    const summary = await executeRecoveryCommand(options)
    options.writeOutput(JSON.stringify(summary, null, 2))
    return summary.ok && summary.data.durableReadbackVerified === true ? 0 : 1
  } catch (error) {
    options.writeError(error.message)
    return 1
  }
}

export async function runRecoveryAccountBlockerCommand({
  args = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  getUserInfo = os.userInfo,
  readContext = readFile,
  writeOutput = (value) => process.stdout.write(`${value}\n`),
  writeError = (message) => defaultLogger.error({
    message: "Offline account blocker recovery CLI failed",
    error: message,
  }),
  createStore = createResolutionStore,
  runResolution = runOfflineAccountBlockerResolution,
} = {}) {
  writeOutput(createRecoveryIdentity({ env }))
  const parsed = parseCommandArguments({
    args,
    writeError,
  })
  if (!parsed) {
    return 1
  }
  const earlyExit = getCommandEarlyExit({
    parsed,
    writeOutput,
  })
  if (earlyExit !== undefined) {
    return earlyExit
  }
  const operatorIdentity = authenticateCommandOperator({
    parsed,
    getUserInfo,
    writeError,
  })
  if (!operatorIdentity) {
    return 1
  }
  return executeAuthenticatedCommand({
    parsed,
    operatorIdentity,
    cwd,
    env,
    readContext,
    createStore,
    runResolution,
    writeOutput,
    writeError,
  })
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runRecoveryAccountBlockerCommand()
}
