import { hasControlCharacters } from "../../security/local-operator-identity.js"
import {
  requireNonEmptyString,
  sha256OperationalStateValue,
} from "../operational-state-canonical.js"
import {
  DEFAULT_SCHEMA_VERSION,
  MAX_FACT_ID_LENGTH,
  SHA256_PATTERN,
} from "./operational-state-fact-schema.js"

export function validateOperatorMarketControlFact({ factType, canonicalData, factId }) {
  if (factType === "OPERATOR_MARKET_PAUSED" || factType === "OPERATOR_MARKET_RESUMED") {
    const allowedFields = new Set(["requestId", "actorId", "symbol"])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Operator market-control fact contains unsupported fields")
    }
    const requestId = requireNonEmptyString({ value: canonicalData.requestId,
field: "data.requestId",
maxLength: MAX_FACT_ID_LENGTH })
    requireNonEmptyString({ value: canonicalData.actorId,
field: "data.actorId",
maxLength: MAX_FACT_ID_LENGTH })
    if (typeof canonicalData.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol)) {
      throw new TypeError("Operator market-control symbol must be canonical uppercase alphanumeric")
    }
    if (factId !== `operator-control:${  requestId}`) {
      throw new TypeError("Operator market-control factId must match its stable requestId")
    }
  }
}

export function validateOperatorBuyControlFact({ factType, canonicalData, factId }) {
  const globalTypes = new Set([
    "OPERATOR_ALL_BUYS_PAUSED",
    "OPERATOR_ALL_BUYS_RESUMED",
  ])
  const marketTypes = new Set([
    "OPERATOR_MARKET_BUYS_PAUSED",
    "OPERATOR_MARKET_BUYS_RESUMED",
  ])
  const isMarketScoped = marketTypes.has(factType)
  if (!globalTypes.has(factType) && !isMarketScoped) {
    return
  }
  const allowedFields = isMarketScoped
    ? new Set(["requestId", "actorId", "symbol"])
    : new Set(["requestId", "actorId"])
  if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Operator BUY-control fact contains unsupported fields")
  }
  const requestId = requireNonEmptyString({
    value: canonicalData.requestId,
    field: "data.requestId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
  requireNonEmptyString({
    value: canonicalData.actorId,
    field: "data.actorId",
    maxLength: MAX_FACT_ID_LENGTH,
  })
  if (isMarketScoped &&
      (typeof canonicalData.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol))) {
    throw new TypeError("Operator BUY-control symbol must be canonical uppercase alphanumeric")
  }
  if (factId !== `operator-control:${requestId}`) {
    throw new TypeError("Operator BUY-control factId must match its stable requestId")
  }
}

function hasOnlyStrategyPauseErrorFields(error) {
  const allowedFields = new Set(["name", "message", "code"])
  return Object.keys(error).every((key) => allowedFields.has(key))
}

function isValidStrategyPauseErrorName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 80
}

function isValidStrategyPauseErrorMessage(message) {
  return typeof message === "string" && message.length <= 240
}

function isValidStrategyPauseErrorCode(code) {
  return code === undefined ||
    (typeof code === "string" && code.length <= 80) ||
    Number.isSafeInteger(code)
}

function validateStrategyPauseErrorEvidence({ factType, error } = {}) {
  if (error === undefined) {
    return
  }
  if (factType !== "STRATEGY_MARKET_PAUSED") {
    throw new TypeError("Strategy pause error evidence must be a bounded sanitized name/message/code object")
  }
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    throw new TypeError("Strategy pause error evidence must be a bounded sanitized name/message/code object")
  }
  const { name, message, code } = error
  if (!hasOnlyStrategyPauseErrorFields(error) ||
      !isValidStrategyPauseErrorName(name) ||
      !isValidStrategyPauseErrorMessage(message) ||
      !isValidStrategyPauseErrorCode(code)) {
    throw new TypeError("Strategy pause error evidence must be a bounded sanitized name/message/code object")
  }
}

export function validateStrategyMarketControlFact({ factType, canonicalData, factId }) {
  if (factType === "STRATEGY_MARKET_PAUSED" || factType === "STRATEGY_MARKET_RESUMED") {
    const allowedFields = new Set(["symbol", "reason", "error"])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Strategy market-control fact contains unsupported fields")
    }
    if (typeof canonicalData.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol)) {
      throw new TypeError("Strategy market-control symbol must be canonical uppercase alphanumeric")
    }
    requireNonEmptyString({ value: canonicalData.reason,
      field: "data.reason",
      maxLength: 256 })
    const { error } = canonicalData
    validateStrategyPauseErrorEvidence({
      factType,
      error,
    })
    const prefix = factType === "STRATEGY_MARKET_PAUSED" ? "strategy-market-paused:" : "strategy-market-resumed:"
    if (!factId.startsWith(prefix) || factId.length === prefix.length) {
      throw new TypeError("Strategy market-control factId must include its unique transition identity")
    }
  }
}

function validateSafetyBlockerScope({ canonicalData }) {
  if (canonicalData.scope !== "ACCOUNT" && canonicalData.scope !== "MARKET") {
    throw new TypeError("Safety-blocker scope must be ACCOUNT or MARKET")
  }
  if (canonicalData.scope === "ACCOUNT" && canonicalData.symbol !== null) {
    throw new TypeError("Account-scoped safety blockers must not name a market symbol")
  }
  if (canonicalData.scope === "MARKET" &&
      (typeof canonicalData.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol))) {
    throw new TypeError("Market-scoped safety blockers require a canonical symbol")
  }
}

function validateSafetyBlockerReason({ reason }) {
  if (!/^[A-Z][A-Z0-9_]{1,127}$/.test(reason)) {
    throw new TypeError("Safety-blocker reason must be a canonical uppercase reason code")
  }
}

function validateSafetyBlockerIdentity({ canonicalData, factId, reason }) {
  if (typeof canonicalData.evidenceDigest !== "string" || !SHA256_PATTERN.test(canonicalData.evidenceDigest)) {
    throw new TypeError("Safety-blocker evidenceDigest must be a SHA-256 digest")
  }
  const expectedBlockerId = sha256OperationalStateValue([
    canonicalData.scope,
    canonicalData.symbol ?? "",
    reason,
    canonicalData.evidenceDigest,
  ].join("\0"))
  if (canonicalData.blockerId !== expectedBlockerId ||
      factId !== `safety-blocker-raised:${expectedBlockerId}`) {
    throw new TypeError("Safety-blocker identity must match its scope, reason, and immutable evidence digest")
  }
}

export function validateSafetyBlockerRaisedFact({ factType, canonicalData, factId }) {
  if (factType !== "SAFETY_BLOCKER_RAISED") {
    return
  }
  const allowedFields = new Set(["blockerId", "producer", "scope", "symbol", "reason", "evidenceDigest"])
  if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Safety-blocker fact contains unsupported fields")
  }
  if (canonicalData.producer !== undefined &&
      !["USER_DATA_EVENT_HANDLER", "RECOVERY_SELLER_STOP_WORKFLOW"].includes(canonicalData.producer)) {
    throw new TypeError("Safety-blocker producer must identify a supported producer")
  }
  if (canonicalData.producer === "RECOVERY_SELLER_STOP_WORKFLOW" &&
      canonicalData.reason !== "RECOVERY_SELLER_UNEXPECTED_CONDITION") {
    throw new TypeError("Recovery Seller STOP producer may emit only its dedicated blocker reason")
  }
  validateSafetyBlockerScope({ canonicalData })
  const reason = requireNonEmptyString({ value: canonicalData.reason,
    field: "data.reason",
    maxLength: 128 })
  validateSafetyBlockerReason({ reason })
  validateSafetyBlockerIdentity({ canonicalData,
    factId,
    reason })
}

const SAFETY_BLOCKER_RESOLVED_FIELDS = Object.freeze([
  "blockerId",
  "resolvedBy",
  "resolution",
  "evidenceDigest",
  "operatorId",
  "operatorAuthMethod",
  "actionId",
  "resolutionReason",
  "actionBlockerIds",
])

function validateResolvedBlockerIdentity({ canonicalData, factId }) {
  if (typeof canonicalData.blockerId !== "string" ||
      !SHA256_PATTERN.test(canonicalData.blockerId) ||
      factId !== `safety-blocker-resolved:${canonicalData.blockerId}`) {
    throw new TypeError("Safety-blocker resolution factId must match its blocker identity")
  }
}

function validateResolvedBlockerActor(canonicalData) {
  requireNonEmptyString({
    value: canonicalData.resolvedBy,
    field: "data.resolvedBy",
    maxLength: MAX_FACT_ID_LENGTH,
  })
}

function validateResolvedBlockerType(canonicalData) {
  if (!["AUTHORITATIVE_RECONCILIATION", "OPERATOR_ACTION"].includes(canonicalData.resolution)) {
    throw new TypeError("Safety-blocker resolution must identify authoritative reconciliation or operator action")
  }
}

function validateResolvedBlockerEvidence(canonicalData) {
  if (typeof canonicalData.evidenceDigest !== "string" || !SHA256_PATTERN.test(canonicalData.evidenceDigest)) {
    throw new TypeError("Safety-blocker resolution evidenceDigest must be a SHA-256 digest")
  }
}

function hasStructuredOperatorMetadata(canonicalData) {
  return [
    canonicalData.operatorId,
    canonicalData.operatorAuthMethod,
    canonicalData.actionId,
    canonicalData.resolutionReason,
    canonicalData.actionBlockerIds,
  ].some((value) => value !== undefined)
}

function validateAuthoritativeResolutionMetadata(canonicalData) {
  if (hasStructuredOperatorMetadata(canonicalData)) {
    throw new TypeError("Authoritative reconciliation facts must not contain operator-action metadata")
  }
}

function validateStructuredOperatorIdentity(canonicalData) {
  if (typeof canonicalData.operatorId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._@-]{2,127}$/.test(canonicalData.operatorId) ||
      canonicalData.operatorAuthMethod !== "OS_ACCOUNT") {
    throw new TypeError("Operator-action resolution requires a canonical authenticated OS operator identity")
  }
}

function validateStructuredOperatorAction(canonicalData) {
  const expectedResolvedBy = `operator:${canonicalData.operatorId}:${canonicalData.actionId}`
  if (typeof canonicalData.actionId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@-]{7,127}$/.test(canonicalData.actionId) ||
      canonicalData.resolvedBy !== expectedResolvedBy) {
    throw new TypeError("Operator-action resolution requires a canonical unique action ID")
  }
}

function validateStructuredOperatorReason(canonicalData) {
  if (typeof canonicalData.resolutionReason !== "string" ||
      canonicalData.resolutionReason.trim() !== canonicalData.resolutionReason ||
      canonicalData.resolutionReason.length < 8 ||
      canonicalData.resolutionReason.length > 512 ||
      hasControlCharacters(canonicalData.resolutionReason)) {
    throw new TypeError("Operator-action resolution requires a printable 8-512 character reason")
  }
}

function validateStructuredOperatorBlockerSet(canonicalData) {
  const blockerIds = canonicalData.actionBlockerIds
  const validBlockerIds = Array.isArray(blockerIds) &&
    blockerIds.length > 0 &&
    blockerIds.length <= 256 &&
    blockerIds.every((blockerId) => typeof blockerId === "string" && SHA256_PATTERN.test(blockerId))
  const uniqueAndSorted = validBlockerIds &&
    new Set(blockerIds).size === blockerIds.length &&
    blockerIds.join("\\0") === [...blockerIds].sort().join("\\0")
  if (!uniqueAndSorted || !blockerIds.includes(canonicalData.blockerId)) {
    throw new TypeError("Operator-action resolution requires a canonical complete blocker set")
  }
}

function validateStructuredOperatorResolution(canonicalData) {
  validateStructuredOperatorIdentity(canonicalData)
  validateStructuredOperatorAction(canonicalData)
  validateStructuredOperatorReason(canonicalData)
  validateStructuredOperatorBlockerSet(canonicalData)
}

export function validateSafetyBlockerResolvedFact({ factType, canonicalData, factId }) {
  if (factType !== "SAFETY_BLOCKER_RESOLVED") {
    return
  }
  if (Object.keys(canonicalData).some((key) => !SAFETY_BLOCKER_RESOLVED_FIELDS.includes(key))) {
    throw new TypeError("Safety-blocker resolution contains unsupported fields")
  }
  validateResolvedBlockerIdentity({
    canonicalData,
    factId,
  })
  validateResolvedBlockerActor(canonicalData)
  validateResolvedBlockerType(canonicalData)
  validateResolvedBlockerEvidence(canonicalData)
  if (canonicalData.resolution === "AUTHORITATIVE_RECONCILIATION") {
    validateAuthoritativeResolutionMetadata(canonicalData)
    return
  }
  if (!hasStructuredOperatorMetadata(canonicalData)) {
    return
  }
  validateStructuredOperatorResolution(canonicalData)
}

export function validateLedgerInitializedFact({ factType, canonicalData }) {
  if (factType === "LEDGER_INITIALIZED" &&
      (!Number.isSafeInteger(canonicalData.schemaVersion) || canonicalData.schemaVersion < 1)) {
    throw new TypeError("Ledger genesis schemaVersion is unsupported")
  }
}

export function validateConfigurationBaselineFact({ factType, canonicalData, factId }) {
  if (factType === "CONFIGURATION_BASELINE") {
    const allowedFields = new Set(["schemaVersion", "strategyName", "markets", "fingerprint"])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Configuration baseline contains unsupported fields")
    }
    if (canonicalData.schemaVersion !== DEFAULT_SCHEMA_VERSION ||
        typeof canonicalData.fingerprint !== "string" || !SHA256_PATTERN.test(canonicalData.fingerprint)) {
      throw new TypeError("Configuration baseline requires the supported schema and SHA-256 fingerprint")
    }
    requireNonEmptyString({ value: canonicalData.strategyName,
field: "data.strategyName",
maxLength: 64 })
    if (!Array.isArray(canonicalData.markets) || canonicalData.markets.length === 0 ||
        canonicalData.markets.some((symbol) => typeof symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(symbol)) ||
        canonicalData.markets.join("\\0") !== [...new Set(canonicalData.markets)].sort().join("\\0")) {
      throw new TypeError("Configuration baseline markets must be unique, sorted canonical symbols")
    }
    if (factId !== `configuration-baseline:${  canonicalData.fingerprint}`) {
      throw new TypeError("Configuration baseline factId must match its fingerprint")
    }
  }
}

function validateDurableProcessIdentityEnvelope({ processIdentity, runtimeSessionId } = {}) {
  if (!processIdentity || typeof processIdentity !== "object" || Array.isArray(processIdentity)) {
    throw new TypeError("Process-start processIdentity must be an object")
  }
  const allowedFields = new Set(["application", "version", "runtimeSessionId", "processId", "startedAt", "source"])
  if (Object.keys(processIdentity).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Process-start processIdentity contains unsupported fields")
  }
  if (processIdentity.application !== "harvester" ||
      processIdentity.runtimeSessionId !== runtimeSessionId) {
    throw new TypeError("Process-start processIdentity must match its Harvester runtime session")
  }
  requireNonEmptyString({
    value: processIdentity.version,
    field: "data.processIdentity.version",
    maxLength: 80,
  })
  if (!Number.isSafeInteger(processIdentity.processId) || processIdentity.processId <= 0) {
    throw new TypeError("Process-start processIdentity.processId must be a positive safe integer")
  }
  const { startedAt, source } = processIdentity
  if (typeof startedAt !== "string") {
    throw new TypeError("Process-start processIdentity.startedAt must be a canonical UTC timestamp")
  }
  const startedAtDate = new Date(startedAt)
  if (Number.isNaN(startedAtDate.getTime()) || startedAtDate.toISOString() !== startedAt) {
    throw new TypeError("Process-start processIdentity.startedAt must be a canonical UTC timestamp")
  }
  return source
}

function validateDurableProcessIdentitySource({ source } = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Process-start processIdentity.source must be an object")
  }
  const allowedSourceFields = new Set(["branch", "commit", "workingTree", "metadataSource"])
  if (Object.keys(source).some((key) => !allowedSourceFields.has(key))) {
    throw new TypeError("Process-start processIdentity.source contains unsupported fields")
  }
  const { branch, commit, workingTree, metadataSource } = source
  if (branch !== null &&
      (typeof branch !== "string" || branch.trim() !== branch || branch.length > 160)) {
    throw new TypeError("Process-start processIdentity.source.branch must be a canonical string or null")
  }
  if (commit !== null &&
      (typeof commit !== "string" || !/^[a-f0-9]{40,64}$/.test(commit))) {
    throw new TypeError("Process-start processIdentity.source.commit must be a lowercase Git SHA or null")
  }
  if (!["clean", "dirty", "unknown"].includes(workingTree) ||
      !["git", "environment", "unavailable"].includes(metadataSource)) {
    throw new TypeError("Process-start processIdentity source status is invalid")
  }
}

function validateDurableProcessIdentity({ processIdentity, runtimeSessionId } = {}) {
  const source = validateDurableProcessIdentityEnvelope({
    processIdentity,
    runtimeSessionId,
  })
  validateDurableProcessIdentitySource({ source })
}


export function validateProcessStartedFact({ factType, canonicalData, factId, runtimeSessionId }) {
  if (factType === "PROCESS_STARTED") {
    const allowedFields = new Set(["configurationFingerprint", "strategyName", "markets", "tradingEnabled", "processIdentity"])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Process-start fact contains unsupported fields")
    }
    if (typeof canonicalData.configurationFingerprint !== "string" ||
        !SHA256_PATTERN.test(canonicalData.configurationFingerprint)) {
      throw new TypeError("Process-start fact requires a SHA-256 configuration fingerprint")
    }
    requireNonEmptyString({ value: canonicalData.strategyName,
field: "data.strategyName",
maxLength: 64 })
    if (typeof canonicalData.tradingEnabled !== "boolean") {
      throw new TypeError("Process-start fact tradingEnabled must be boolean")
    }
    if (!Array.isArray(canonicalData.markets) || canonicalData.markets.length === 0 ||
        canonicalData.markets.some((symbol) => typeof symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(symbol)) ||
        canonicalData.markets.join("\\0") !== [...new Set(canonicalData.markets)].sort().join("\\0")) {
      throw new TypeError("Process-start markets must be unique, sorted canonical symbols")
    }
    if (factId !== `process-started:${  runtimeSessionId}`) {
      throw new TypeError("Process-start factId must match its runtime session identity")
    }
    if (canonicalData.processIdentity !== undefined) {
      validateDurableProcessIdentity({
        processIdentity: canonicalData.processIdentity,
        runtimeSessionId,
      })
    }
  }
}

export function validateProcessStoppedFact({ factType, canonicalData, factId, runtimeSessionId }) {
  if (factType === "PROCESS_STOPPED") {
    const allowedFields = new Set(["reason", "clean"])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Process-stop fact contains unsupported fields")
    }
    const reason = requireNonEmptyString({ value: canonicalData.reason,
field: "data.reason",
maxLength: 64 })
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(reason) || typeof canonicalData.clean !== "boolean") {
      throw new TypeError("Process-stop reason and clean marker are invalid")
    }
    if (factId !== `process-stopped:${  runtimeSessionId}`) {
      throw new TypeError("Process-stop factId must match its runtime session identity")
    }
  }
}
