const ENVIRONMENTS = new Set(["testnet", "live"])
const STRATEGY_MODES = new Set(["read-only", "conservative", "aggressive"])
const WORKING_TREE_STATES = new Set(["clean", "dirty", "unknown"])
const BUILD_METADATA_SOURCES = new Set(["git", "environment", "unavailable"])
const IDENTITY_FIELDS = Object.freeze([
  "id",
  "schemaVersion",
  "runtimeSessionId",
  "environment",
  "broker",
  "strategyId",
  "strategyMode",
  "configurationFingerprint",
  "enabledMarkets",
  "buildProvenance",
  "startedAt",
  "metadata",
])

export class TradingSessionIntegrityError extends Error {
  constructor({ message, cause } = {}) {
    super(
      message ?? "Trading-session identity conflicts with existing historical facts",
      { cause },
    )
    this.name = "TradingSessionIntegrityError"
    this.code = "HARVESTER_TRADING_SESSION_IDENTITY_CONFLICT"
  }
}

export class TradingSessionNotFoundError extends Error {
  constructor({ id } = {}) {
    super(`Trading session "${id}" does not exist`)
    this.name = "TradingSessionNotFoundError"
    this.code = "HARVESTER_TRADING_SESSION_NOT_FOUND"
  }
}

export class TradingSessionTransitionError extends Error {
  constructor({ currentStatus, nextStatus } = {}) {
    super(`Trading session cannot transition from ${currentStatus} to ${nextStatus}`)
    this.name = "TradingSessionTransitionError"
    this.code = "HARVESTER_TRADING_SESSION_TRANSITION_INVALID"
  }
}

function requireText({ value, field, maxLength = 160 }) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw new TypeError(`${field} must be a non-empty string of at most ${maxLength} characters`)
  }
  return value.trim()
}

function requireNullableText({ value, field, maxLength }) {
  if (value === null) {
    return null
  }
  return requireText({
    value,
    field,
    maxLength,
  })
}

function requireTimestamp({ value, field }) {
  const timestamp = requireText({
    value,
    field,
    maxLength: 40,
  })
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new TypeError(`${field} must be a canonical UTC ISO-8601 timestamp with milliseconds`)
  }
  return timestamp
}

function mapCommitIdentity({ value }) {
  const commit = requireNullableText({
    value: value.commit,
    field: "buildProvenance.source.commit",
    maxLength: 64,
  })
  if (commit !== null && !/^[a-f0-9]{40,64}$/i.test(commit)) {
    throw new TypeError("buildProvenance.source.commit must be a hexadecimal Git SHA or null")
  }
  const shortCommit = requireNullableText({
    value: value.shortCommit,
    field: "buildProvenance.source.shortCommit",
    maxLength: 8,
  })
  if (
    shortCommit !== null &&
    (commit === null || shortCommit.toLowerCase() !== commit.slice(0, 8).toLowerCase())
  ) {
    throw new TypeError("buildProvenance.source.shortCommit must match the full Git SHA or be null")
  }
  return {
    commit: commit?.toLowerCase() ?? null,
    shortCommit: shortCommit?.toLowerCase() ?? null,
  }
}

function mapCommitDate({ value }) {
  const commitDate = requireNullableText({
    value: value.commitDate,
    field: "buildProvenance.source.commitDate",
    maxLength: 40,
  })
  if (commitDate !== null) {
    requireTimestamp({
      value: commitDate,
      field: "buildProvenance.source.commitDate",
    })
  }
  return commitDate
}

function assertBuildSourceMetadata({ value }) {
  if (!WORKING_TREE_STATES.has(value.workingTree)) {
    throw new TypeError("buildProvenance.source.workingTree must be clean, dirty, or unknown")
  }
  if (!BUILD_METADATA_SOURCES.has(value.metadataSource)) {
    throw new TypeError("buildProvenance.source.metadataSource must be git, environment, or unavailable")
  }
}

function mapBuildSource({ value }) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("buildProvenance.source must be an object")
  }
  const commitIdentity = mapCommitIdentity({ value })
  const commitDate = mapCommitDate({ value })
  assertBuildSourceMetadata({ value })
  return {
    branch: requireNullableText({
      value: value.branch,
      field: "buildProvenance.source.branch",
      maxLength: 160,
    }),
    ...commitIdentity,
    commitMessage: requireNullableText({
      value: value.commitMessage,
      field: "buildProvenance.source.commitMessage",
      maxLength: 240,
    }),
    commitDate,
    workingTree: value.workingTree,
    metadataSource: value.metadataSource,
  }
}

function mapBuildProvenance({ value }) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("buildProvenance must be an object")
  }
  if (!Number.isSafeInteger(value.processId) || value.processId <= 0) {
    throw new TypeError("buildProvenance.processId must be a positive safe integer")
  }
  return {
    application: requireText({
      value: value.application,
      field: "buildProvenance.application",
      maxLength: 40,
    }),
    version: requireText({
      value: value.version,
      field: "buildProvenance.version",
      maxLength: 40,
    }),
    processId: value.processId,
    source: mapBuildSource({
      value: value.source,
    }),
  }
}

function mapEnabledMarkets({ value }) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
    throw new TypeError("enabledMarkets must contain between 1 and 128 market symbols")
  }
  const markets = value.map((symbol) => requireText({
    value: symbol,
    field: "enabledMarkets item",
    maxLength: 32,
  })).sort()
  if (
    new Set(markets).size !== markets.length ||
    markets.some((symbol) => !/^[A-Z0-9][A-Z0-9_-]*$/.test(symbol))
  ) {
    throw new TypeError("enabledMarkets must contain unique canonical market symbols")
  }
  return markets
}

export function createTradingSessionRecord({
  runtimeSessionId,
  environment,
  broker,
  strategyId,
  strategyMode,
  configurationFingerprint,
  enabledMarkets,
  buildProvenance,
  startedAt,
} = {}) {
  const id = requireText({
    value: runtimeSessionId,
    field: "runtimeSessionId",
    maxLength: 128,
  })
  if (!ENVIRONMENTS.has(environment)) {
    throw new TypeError("environment must be testnet or live")
  }
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(broker)) {
    throw new TypeError("broker must be a canonical lowercase provider identity")
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(strategyId)) {
    throw new TypeError("strategyId must be a canonical Harvester strategy identity")
  }
  if (!STRATEGY_MODES.has(strategyMode)) {
    throw new TypeError("strategyMode must be read-only, conservative, or aggressive")
  }
  if (
    typeof configurationFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(configurationFingerprint)
  ) {
    throw new TypeError("configurationFingerprint must be a lowercase SHA-256 digest")
  }
  return {
    id,
    schemaVersion: 1,
    runtimeSessionId: id,
    environment,
    broker,
    strategyId,
    strategyMode,
    configurationFingerprint,
    enabledMarkets: mapEnabledMarkets({
      value: enabledMarkets,
    }),
    buildProvenance: mapBuildProvenance({
      value: buildProvenance,
    }),
    startedAt: requireTimestamp({
      value: startedAt,
      field: "startedAt",
    }),
    endedAt: null,
    status: "STARTING",
    metadata: {
      recordKind: "ordinary-trading-history",
    },
  }
}

export function createTradingSessionTransition({ current, status, endedAt } = {}) {
  if (current === null || typeof current !== "object") {
    throw new TypeError("current trading session must be an object")
  }
  if (status === current.status) {
    return {
      status: current.status,
      endedAt: current.endedAt,
      duplicate: true,
    }
  }
  const allowedTransitions = {
    STARTING: ["RUNNING", "STARTUP_FAILED"],
    RUNNING: ["STOPPED"],
  }
  if (!allowedTransitions[current.status]?.includes(status)) {
    throw new TradingSessionTransitionError({
      currentStatus: current.status,
      nextStatus: status,
    })
  }
  if (status === "RUNNING") {
    if (endedAt !== undefined) {
      throw new TypeError("RUNNING transitions must not include endedAt")
    }
    return {
      status,
      endedAt: null,
      duplicate: false,
    }
  }
  const normalizedEndedAt = requireTimestamp({
    value: endedAt,
    field: "endedAt",
  })
  if (Date.parse(normalizedEndedAt) < Date.parse(current.startedAt)) {
    throw new TypeError("endedAt must not precede startedAt")
  }
  return {
    status,
    endedAt: normalizedEndedAt,
    duplicate: false,
  }
}

export function hasSameTradingSessionIdentity({ existing, candidate } = {}) {
  if (
    existing === null ||
    typeof existing !== "object" ||
    candidate === null ||
    typeof candidate !== "object"
  ) {
    return false
  }
  return IDENTITY_FIELDS.every((field) =>
    JSON.stringify(existing[field]) === JSON.stringify(candidate[field]))
}
