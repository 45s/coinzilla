import { toResult } from "@coinzilla/utils"

const WORKING_TREE_STATES = new Set(["clean", "dirty", "unknown"])
const BUILD_METADATA_SOURCES = new Set(["git", "environment", "unavailable"])

function normalizeNullableText({ value, field, maxLength } = {}) {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string or null`)
  }
  return value.trim().replace(/[\r\n]+/g, " ").slice(0, maxLength)
}

function validateProcessIdentityEnvelope({ processIdentity, runtimeSessionId } = {}) {
  if (!processIdentity || typeof processIdentity !== "object" || Array.isArray(processIdentity)) {
    throw new TypeError("recordProcessStarted processIdentity must be an object")
  }
  const { application, version, processId, startedAt } = processIdentity
  if (application !== "harvester" ||
      processIdentity.runtimeSessionId !== runtimeSessionId ||
      typeof version !== "string" || !version.trim() ||
      !Number.isSafeInteger(processId) || processId <= 0) {
    throw new TypeError("recordProcessStarted processIdentity must identify this Harvester runtime and process")
  }
  if (typeof startedAt !== "string") {
    throw new TypeError("recordProcessStarted processIdentity.startedAt must be a canonical UTC timestamp")
  }
  const startedAtDate = new Date(startedAt)
  if (Number.isNaN(startedAtDate.getTime()) || startedAtDate.toISOString() !== startedAt) {
    throw new TypeError("recordProcessStarted processIdentity.startedAt must be a canonical UTC timestamp")
  }
  return {
    version: version.trim().slice(0, 80),
    processId,
    startedAt,
  }
}

function mapDurableProcessIdentitySource({ source = {} } = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("recordProcessStarted processIdentity.source must be an object")
  }
  const commit = normalizeNullableText({
    value: source.commit,
    field: "processIdentity.source.commit",
    maxLength: 64,
  })
  if (commit !== null && !/^[a-f0-9]{40,64}$/i.test(commit)) {
    throw new TypeError("recordProcessStarted processIdentity.source.commit must be a Git SHA or null")
  }
  const workingTree = WORKING_TREE_STATES.has(source.workingTree) ? source.workingTree : "unknown"
  const metadataSource = BUILD_METADATA_SOURCES.has(source.metadataSource)
    ? source.metadataSource
    : "unavailable"
  return {
    branch: normalizeNullableText({
      value: source.branch,
      field: "processIdentity.source.branch",
      maxLength: 160,
    }),
    commit: commit?.toLowerCase() ?? null,
    workingTree,
    metadataSource,
  }
}

function mapDurableProcessIdentity({ processIdentity, runtimeSessionId }) {
  const identity = validateProcessIdentityEnvelope({
    processIdentity,
    runtimeSessionId,
  })
  const source = mapDurableProcessIdentitySource({ source: processIdentity.source ?? {} })
  return {
    application: "harvester",
    version: identity.version,
    runtimeSessionId,
    processId: identity.processId,
    startedAt: identity.startedAt,
    source,
  }
}


function validateProcessStart({ operationalStateStore, configurationFingerprint, strategyName, markets, tradingEnabled }) {
  const sessionId = operationalStateStore?.runtimeSessionId
  if (typeof operationalStateStore?.append !== "function" ||
      typeof sessionId !== "string" || !sessionId.trim()) {
    throw new TypeError("recordProcessStarted requires an initialized store runtime session")
  }
  if (typeof configurationFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(configurationFingerprint)) {
    throw new TypeError("recordProcessStarted requires a SHA-256 configuration fingerprint")
  }
  if (typeof strategyName !== "string" || !strategyName.trim() || typeof tradingEnabled !== "boolean" ||
      !Array.isArray(markets) || markets.length === 0 ||
      markets.some((market) => typeof market !== "string" || !/^[A-Z0-9]{3,30}$/.test(market))) {
    throw new TypeError("recordProcessStarted requires a strategy name and canonical configured markets")
  }
  return sessionId
}

export async function recordProcessStarted(options = {}) {
  try {
    const { operationalStateStore, configurationFingerprint, strategyName, markets, tradingEnabled, processIdentity } = options
    const sessionId = validateProcessStart(options)
    let durableProcessIdentity
    if (processIdentity !== undefined) {
      durableProcessIdentity = mapDurableProcessIdentity({
        processIdentity,
        runtimeSessionId: sessionId,
      })
    }
    const result = await operationalStateStore.append({
      factId: `process-started:${sessionId}`,
      factType: "PROCESS_STARTED",
      data: {
        configurationFingerprint,
        strategyName,
        markets: [...markets].sort(),
        tradingEnabled,
        ...(durableProcessIdentity === undefined
          ? {}
          : { processIdentity: durableProcessIdentity }),
      },
    })
    if (result?.ok !== true || result.data?.durable !== true) {
      return toResult({
        errors: result?.errors?.length
          ? result.errors
          : [new Error("Process-start append did not confirm durable commitment")],
      })
    }
    return result
  } catch (error) {
    return toResult({ error })
  }
}
