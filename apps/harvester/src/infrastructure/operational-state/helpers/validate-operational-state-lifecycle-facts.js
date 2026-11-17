import {
  requireNonEmptyString,
  sha256OperationalStateValue,
} from "../operational-state-canonical.js"
import {
  DEFAULT_SCHEMA_VERSION,
  MAX_FACT_ID_LENGTH,
  SHA256_PATTERN,
} from "./operational-state-fact-schema.js"

export function validateOperatorMarketControlFact({
  factType,
  canonicalData,
  factId
,}) {
  if (factType === "OPERATOR_MARKET_PAUSED" || factType === "OPERATOR_MARKET_RESUMED") {
    const allowedFields = new Set(["requestId", "actorId", "symbol"])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Operator market-control fact contains unsupported fields")
    }
    const requestId = requireNonEmptyString({
      value: canonicalData.requestId,
field: "data.requestId",
maxLength: MAX_FACT_ID_LENGTH
    ,})
    requireNonEmptyString({
      value: canonicalData.actorId,
field: "data.actorId",
maxLength: MAX_FACT_ID_LENGTH
    ,})
    if (typeof canonicalData.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol)) {
      throw new TypeError("Operator market-control symbol must be canonical uppercase alphanumeric")
    }
    if (factId !== `operator-control:${  requestId}`) {
      throw new TypeError("Operator market-control factId must match its stable requestId")
    }
  }
}

export function validateOperatorBuyControlFact({
  factType,
  canonicalData,
  factId
,}) {
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

export function validateStrategyMarketControlFact({
  factType,
  canonicalData,
  factId
,}) {
  if (factType === "STRATEGY_MARKET_PAUSED" || factType === "STRATEGY_MARKET_RESUMED") {
    const allowedFields = new Set(["symbol", "reason"])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Strategy market-control fact contains unsupported fields")
    }
    if (typeof canonicalData.symbol !== "string" || !/^[A-Z0-9]{3,30}$/.test(canonicalData.symbol)) {
      throw new TypeError("Strategy market-control symbol must be canonical uppercase alphanumeric")
    }
    requireNonEmptyString({
      value: canonicalData.reason,
field: "data.reason",
maxLength: 256
    ,})
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

function validateSafetyBlockerIdentity({
  canonicalData,
  factId,
  reason
,}) {
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

export function validateSafetyBlockerRaisedFact({
  factType,
  canonicalData,
  factId
,}) {
  if (factType !== "SAFETY_BLOCKER_RAISED") {
    return
  }
  const allowedFields = new Set(["blockerId", "scope", "symbol", "reason", "evidenceDigest"])
  if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
    throw new TypeError("Safety-blocker fact contains unsupported fields")
  }
  validateSafetyBlockerScope({ canonicalData })
  const reason = requireNonEmptyString({
    value: canonicalData.reason,
    field: "data.reason",
    maxLength: 128
  ,})
  validateSafetyBlockerReason({ reason })
  validateSafetyBlockerIdentity({
    canonicalData,
    factId,
    reason
  ,})
}

export function validateSafetyBlockerResolvedFact({
  factType,
  canonicalData,
  factId
,}) {
  if (factType === "SAFETY_BLOCKER_RESOLVED") {
    const allowedFields = new Set(["blockerId", "resolvedBy", "resolution", "evidenceDigest"])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Safety-blocker resolution contains unsupported fields")
    }
    if (typeof canonicalData.blockerId !== "string" || !SHA256_PATTERN.test(canonicalData.blockerId) ||
        factId !== `safety-blocker-resolved:${  canonicalData.blockerId}`) {
      throw new TypeError("Safety-blocker resolution factId must match its blocker identity")
    }
    requireNonEmptyString({
      value: canonicalData.resolvedBy,
field: "data.resolvedBy",
maxLength: MAX_FACT_ID_LENGTH
    ,})
    if (!["AUTHORITATIVE_RECONCILIATION", "OPERATOR_ACTION"].includes(canonicalData.resolution)) {
      throw new TypeError("Safety-blocker resolution must identify authoritative reconciliation or operator action")
    }
    if (typeof canonicalData.evidenceDigest !== "string" || !SHA256_PATTERN.test(canonicalData.evidenceDigest)) {
      throw new TypeError("Safety-blocker resolution evidenceDigest must be a SHA-256 digest")
    }
  }
}

export function validateLedgerInitializedFact({
  factType,
  canonicalData
,}) {
  if (factType === "LEDGER_INITIALIZED" &&
      (!Number.isSafeInteger(canonicalData.schemaVersion) || canonicalData.schemaVersion < 1)) {
    throw new TypeError("Ledger genesis schemaVersion is unsupported")
  }
}

export function validateConfigurationBaselineFact({
  factType,
  canonicalData,
  factId
,}) {
  if (factType === "CONFIGURATION_BASELINE") {
    const allowedFields = new Set(["schemaVersion", "strategyName", "markets", "fingerprint"])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Configuration baseline contains unsupported fields")
    }
    if (canonicalData.schemaVersion !== DEFAULT_SCHEMA_VERSION ||
        typeof canonicalData.fingerprint !== "string" || !SHA256_PATTERN.test(canonicalData.fingerprint)) {
      throw new TypeError("Configuration baseline requires the supported schema and SHA-256 fingerprint")
    }
    requireNonEmptyString({
      value: canonicalData.strategyName,
field: "data.strategyName",
maxLength: 64
    ,})
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

export function validateProcessStartedFact({
  factType,
  canonicalData,
  factId,
  runtimeSessionId
,}) {
  if (factType === "PROCESS_STARTED") {
    const allowedFields = new Set(["configurationFingerprint", "strategyName", "markets", "tradingEnabled"])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Process-start fact contains unsupported fields")
    }
    if (typeof canonicalData.configurationFingerprint !== "string" ||
        !SHA256_PATTERN.test(canonicalData.configurationFingerprint)) {
      throw new TypeError("Process-start fact requires a SHA-256 configuration fingerprint")
    }
    requireNonEmptyString({
      value: canonicalData.strategyName,
field: "data.strategyName",
maxLength: 64
    ,})
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
  }
}

export function validateProcessStoppedFact({
  factType,
  canonicalData,
  factId,
  runtimeSessionId
,}) {
  if (factType === "PROCESS_STOPPED") {
    const allowedFields = new Set(["reason", "clean"])
    if (Object.keys(canonicalData).some((key) => !allowedFields.has(key))) {
      throw new TypeError("Process-stop fact contains unsupported fields")
    }
    const reason = requireNonEmptyString({
      value: canonicalData.reason,
field: "data.reason",
maxLength: 64
    ,})
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(reason) || typeof canonicalData.clean !== "boolean") {
      throw new TypeError("Process-stop reason and clean marker are invalid")
    }
    if (factId !== `process-stopped:${  runtimeSessionId}`) {
      throw new TypeError("Process-stop factId must match its runtime session identity")
    }
  }
}
