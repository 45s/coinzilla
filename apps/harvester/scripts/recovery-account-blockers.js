import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { captureBuildMetadata } from "@coinzilla/utils"
import packageMetadata from "../package.json" with { type: "json" }
import { authenticateLocalOperator, LOCAL_OPERATOR_ID_PATTERN } from "../src/infrastructure/security/local-operator-identity.js"
import { createOperationalStateStore } from "../src/infrastructure/operational-state/create-operational-state-store.js"
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

const VALUE_ARGUMENT_KEYS = new Set([
  "--context",
  "--operator-id",
  "--action-id",
  "--resolution-reason",
])

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

function validateParsedArguments(parsed) {
  if (typeof parsed.contextPath !== "string" || parsed.contextPath.trim() === "" ||
      !LOCAL_OPERATOR_ID_PATTERN.test(parsed.operatorId ?? "") ||
      typeof parsed.actionId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@-]{7,127}$/.test(parsed.actionId) ||
      typeof parsed.resolutionReason !== "string" ||
      parsed.resolutionReason.trim() !== parsed.resolutionReason ||
      parsed.resolutionReason.length < 8 ||
      parsed.resolutionReason.length > 512 ||
      /[\\u0000-\\u001F\\u007F]/.test(parsed.resolutionReason) ||
      parsed.causeFixed !== true) {
    throw new TypeError("Account-blocker recovery requires context, authenticated operator, unique action ID, resolution reason, and --cause-fixed")
  }
}

/**
 * @param {string[]} args
 * @returns {{contextPath?: string, operatorId?: string, actionId?: string, resolutionReason?: string, causeFixed: boolean, help: boolean, version: boolean}}
 */
export function parseRecoveryAccountBlockerArguments(args = []) {
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
    const argument = args[index]
    if (argument === "--help" || argument === "-h") {
      parsed.help = true
      continue
    }
    if (argument === "--version") {
      parsed.version = true
      continue
    }
    if (argument === "--cause-fixed") {
      parsed.causeFixed = true
      continue
    }
    if (!VALUE_ARGUMENT_KEYS.has(argument)) {
      throw new TypeError(`Unknown recovery argument: ${argument}`)
    }
    const value = args[index + 1]
    if (typeof value !== "string" || value.trim() === "" || value.startsWith("--")) {
      throw new TypeError(`Recovery argument ${argument} requires a value`)
    }
    index += 1
    if (argument === "--context") {
      parsed.contextPath = value
    } else if (argument === "--operator-id") {
      parsed.operatorId = value
    } else if (argument === "--action-id") {
      parsed.actionId = value
    } else if (argument === "--resolution-reason") {
      parsed.resolutionReason = value
    }
  }
  if (parsed.version && args.length !== 1) {
    throw new TypeError("--version must be used by itself")
  }
  if (!parsed.help && !parsed.version) {
    validateParsedArguments(parsed)
  }
  return parsed
}

async function readContextFile({ filePath }) {
  return readFile(path.resolve(filePath), "utf8")
}

/**
 * Run the offline-only account blocker recovery command.
 *
 * @param {object} options
 * @returns {Promise<number>} Process exit code.
 */
export async function runRecoveryAccountBlockerCommand({
  args = process.argv.slice(2),
  env = process.env,
  getUserInfo = os.userInfo,
  readContext = readContextFile,
  createStore = ({ env: storeEnv } = {}) => createOperationalStateStore({ env: storeEnv }),
  runResolution = runOfflineAccountBlockerResolution,
  writeOutput = (message) => process.stdout.write(`${message}\n`),
  writeError = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  writeOutput(createRecoveryIdentity({ env }))
  let parsed
  try {
    parsed = parseRecoveryAccountBlockerArguments(args)
  } catch (error) {
    writeError(error.message)
    return 1
  }
  if (parsed.version) {
    return 0
  }
  if (parsed.help) {
    writeOutput(HELP)
    return 0
  }

  let operatorIdentity
  try {
    operatorIdentity = authenticateLocalOperator({
      operatorId: parsed.operatorId,
      getUserInfo,
    })
  } catch (error) {
    writeError(error.message)
    return 1
  }

  try {
    const contextContent = await readContext({
      filePath: parsed.contextPath,
    })
    const context = typeof contextContent === "string"
      ? JSON.parse(contextContent)
      : contextContent
    const store = await createStore({ env })
    const result = await runResolution({
      ...parsed,
      operatorIdentity,
      context,
      operationalStateStore: store,
    })
    if (result?.ok !== true) {
      const error = result?.errors?.[0] ?? new Error("Account-blocker recovery was not durably confirmed")
      writeError(error.message)
      return 1
    }
    writeOutput(JSON.stringify({
      ok: true,
      data: {
        resolvedBlockerIds: result.data.resolvedBlockerIds,
        evidenceDigest: result.data.evidenceDigest,
        durableReadbackVerified: result.data.durableReadbackVerified,
        readiness: result.data.readiness,
        requiresControlledRestart: result.data.requiresControlledRestart,
        runtimeStateReset: result.data.runtimeStateReset,
        recoverySellerStopReset: result.data.recoverySellerStopReset,
        idempotentReplay: result.data.idempotentReplay === true,
      },
    }))
    return 0
  } catch (error) {
    writeError(error.message)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runRecoveryAccountBlockerCommand()
}
