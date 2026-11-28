const WORKING_TREE_STATES = new Set(["clean", "dirty", "unknown"])
const BUILD_METADATA_SOURCES = new Set(["git", "environment", "unavailable"])

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

export function mapTradingSessionInput({ buildProvenance } = {}) {
  return {
    buildProvenance: mapBuildProvenance({
      value: buildProvenance,
    }),
  }
}
