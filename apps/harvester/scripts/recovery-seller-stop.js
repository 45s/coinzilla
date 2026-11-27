import os from "node:os"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defaultLogger } from "@coinzilla/utils"
import {
  authenticateLocalOperator,
  hasControlCharacters,
} from "../src/infrastructure/security/local-operator-identity.js"
import { createFileOperationalStateStore } from "../src/infrastructure/operational-state/create-file-store.js"
import { resolveOperationalStateDirectory } from "../src/infrastructure/operational-state/resolve-directory.js"
import { createRecoverySellerStopWorkflow } from "../src/use-cases/create-recovery-seller-stop-workflow.js"

const VALUE_OPTIONS = Object.freeze({
  "--context": "contextPath",
  "--operator-id": "operatorId",
  "--action-id": "actionId",
  "--resolution-reason": "resolutionReason",
})

const HELP = [
  "Usage: node scripts/recovery-seller-stop.js --context <evidence.json> --operator-id <local-user> --action-id <unique-id> --resolution-reason <text> --cause-fixed",
  "",
  "Offline-only durable Recovery Seller STOP resolution.",
  "Does not query exchanges, restart processes, clear admission gates, or resume trading.",
].join("\n")

function validateCommandMetadata({ actionId, resolutionReason }) {
  const validActionId = typeof actionId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]{7,127}$/.test(actionId)
  const validReason = typeof resolutionReason === "string" &&
    resolutionReason.trim() === resolutionReason &&
    resolutionReason.length >= 8 &&
    resolutionReason.length <= 512 &&
    !hasControlCharacters(resolutionReason)
  if (!validActionId || !validReason) {
    throw new TypeError("STOP resolution requires a unique action ID and printable resolution reason")
  }
}

export function parseRecoverySellerStopArguments(args = []) {
  const parsed = {
    contextPath: null,
    operatorId: null,
    actionId: null,
    resolutionReason: null,
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
        throw new Error("Duplicate --cause-fixed argument")
      }
      parsed.causeFixed = true
      continue
    }
    const key = VALUE_OPTIONS[argument]
    if (!key) {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = args[index + 1]
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`)
    }
    if (parsed[key] !== null) {
      throw new Error(`Duplicate argument: ${argument}`)
    }
    parsed[key] = value
    index += 1
  }
  if (parsed.help) {
    return parsed
  }
  for (const key of ["contextPath", "operatorId", "actionId", "resolutionReason"]) {
    if (!parsed[key]) {
      throw new Error(`Missing required argument: ${key}`)
    }
  }
  if (!parsed.causeFixed) {
    throw new Error("Explicit --cause-fixed confirmation is required")
  }
  validateCommandMetadata(parsed)
  return parsed
}

function validateResolutionContext(context) {
  const validSession = typeof context?.runtimeSessionId === "string" &&
    context.runtimeSessionId.trim().length > 0
  const validBlocker = typeof context?.blockerId === "string" &&
    /^[a-f0-9]{64}$/.test(context.blockerId)
  const validEvidence = context?.reconciliation &&
    typeof context.reconciliation === "object" &&
    context?.accounting &&
    typeof context.accounting === "object"
  if (!validSession || !validBlocker || !validEvidence) {
    throw new TypeError("STOP resolution context requires runtime session, exact blocker ID, reconciliation, and accounting evidence")
  }
}

function createResolutionStore({ context, env }) {
  const directory = resolveOperationalStateDirectory({ env })
  return createFileOperationalStateStore({
    directory,
    runtimeSessionId: context.runtimeSessionId,
  })
}

async function verifyResolutionReadback({
  operationalStateStore,
  blockerId,
  operatorId,
  actionId,
  resolutionReason,
  evidenceDigest,
}) {
  const read = await operationalStateStore.readAll()
  if (read?.ok !== true || !Array.isArray(read.data?.records)) {
    throw new Error("STOP resolution readback requires a verified Operational State Store snapshot")
  }
  const resolvedRecord = read.data.records.find((entry) =>
    entry.factType === "SAFETY_BLOCKER_RESOLVED" &&
    entry.data?.blockerId === blockerId &&
    entry.data?.actionId === actionId
  )
  const exactReadback = resolvedRecord?.data?.operatorId === operatorId &&
    resolvedRecord.data.operatorAuthMethod === "OS_ACCOUNT" &&
    resolvedRecord.data.resolutionReason === resolutionReason &&
    resolvedRecord.data.evidenceDigest === evidenceDigest &&
    Array.isArray(resolvedRecord.data.actionBlockerIds) &&
    resolvedRecord.data.actionBlockerIds.length === 1 &&
    resolvedRecord.data.actionBlockerIds[0] === blockerId
  if (!exactReadback) {
    throw new Error("STOP resolution did not persist the exact authenticated operator action")
  }
  return resolvedRecord
}

async function executeResolution({
  parsed,
  operatorIdentity,
  env,
  cwd,
  readContext,
  createStore,
  createWorkflow,
  writeOutput,
}) {
  const contextText = await readContext(path.resolve(cwd, parsed.contextPath), "utf8")
  const context = JSON.parse(contextText)
  validateResolutionContext(context)
  const operationalStateStore = await createStore({ context, env })
  const workflowResult = await createWorkflow({ operationalStateStore })
  if (workflowResult?.ok !== true) {
    throw new Error(workflowResult?.errors?.[0]?.message ?? "Recovery Seller STOP workflow could not be created")
  }
  const workflow = workflowResult.data
  if (workflow.getBlockerId() !== context.blockerId) {
    throw new Error("STOP resolution context blocker ID does not match the active durable STOP")
  }
  const reconciliation = {
    ...context.reconciliation,
    operatorId: parsed.operatorId,
    operatorAuthMethod: operatorIdentity.authMethod,
    actionId: parsed.actionId,
    resolutionReason: parsed.resolutionReason,
    blockerIds: [context.blockerId],
  }
  const result = await workflow.resolve({
    operatorIdentity,
    operatorId: parsed.operatorId,
    actionId: parsed.actionId,
    resolutionReason: parsed.resolutionReason,
    causeFixed: true,
    reconciliation,
    accounting: context.accounting,
  })
  if (result?.ok !== true) {
    throw new Error(result?.errors?.[0]?.message ?? "Recovery Seller STOP resolution failed")
  }
  const resolvedRecord = await verifyResolutionReadback({
    operationalStateStore,
    blockerId: context.blockerId,
    operatorId: parsed.operatorId,
    actionId: parsed.actionId,
    resolutionReason: parsed.resolutionReason,
    evidenceDigest: result.data.evidenceDigest,
  })
  const requiresControlledRestart = workflow.requiresControlledRestart?.() === true
  const admissionBlocked = {
    buy: workflow.isBuyAdmissionBlocked?.() === true,
    sell: workflow.isSellAdmissionBlocked?.() === true,
  }
  if (!requiresControlledRestart || !admissionBlocked.buy || !admissionBlocked.sell) {
    throw new Error("STOP resolution must leave both in-process admission gates blocked for controlled restart")
  }
  const summary = {
    ok: true,
    data: {
      blockerId: context.blockerId,
      operatorId: parsed.operatorId,
      operatorAuthMethod: operatorIdentity.authMethod,
      actionId: parsed.actionId,
      resolutionRecordId: resolvedRecord.factId ?? null,
      durableReadbackVerified: true,
      readiness: "BLOCKED",
      requiresControlledRestart,
      admissionBlocked,
      runtimeStateReset: false,
      tradingResumed: false,
    },
  }
  writeOutput(JSON.stringify(summary, null, 2))
  return 0
}

export async function runRecoverySellerStopCommand({
  args = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  getUserInfo = os.userInfo,
  readContext = readFile,
  createStore = createResolutionStore,
  createWorkflow = createRecoverySellerStopWorkflow,
  writeOutput = (value) => process.stdout.write(`${value}\n`),
  writeError = (value) => defaultLogger.error(value),
} = {}) {
  let parsed
  try {
    parsed = parseRecoverySellerStopArguments(args)
  } catch (error) {
    writeError(error.message)
    return 1
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
    return await executeResolution({
      parsed,
      operatorIdentity,
      env,
      cwd,
      readContext,
      createStore,
      createWorkflow,
      writeOutput,
    })
  } catch (error) {
    writeError(error.message)
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runRecoverySellerStopCommand()
}
