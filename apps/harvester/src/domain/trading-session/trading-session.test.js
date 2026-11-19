import assert from "node:assert/strict"
import test from "node:test"
import {
  createTradingSessionRecord,
  createTradingSessionTransition,
  hasSameTradingSessionIdentity,
} from "./trading-session.js"

const STARTED_AT = "2026-11-17T16:00:00.000Z"
const ENDED_AT = "2026-11-17T17:00:00.000Z"
const BUILD_PROVENANCE = Object.freeze({
  application: "harvester",
  version: "1.0.001",
  processId: 12345,
  source: {
    branch: "develop",
    commit: "a".repeat(40),
    shortCommit: "a".repeat(8),
    commitMessage: "must-not-persist",
    commitDate: "2026-11-17T15:00:00.000Z",
    workingTree: "clean",
    metadataSource: "git",
    apiSecret: "must-not-persist",
  },
  apiKey: "must-not-persist",
})

function createSessionInput(overrides = {}) {
  return {
    runtimeSessionId: "runtime-session-domain-001",
    environment: "testnet",
    broker: "binance",
    strategyId: "CG_coinGrabber",
    strategyMode: "conservative",
    configurationFingerprint: "a".repeat(64),
    enabledMarkets: ["ETHUSDT", "BTCUSDT"],
    buildProvenance: BUILD_PROVENANCE,
    startedAt: STARTED_AT,
    apiKey: "must-not-persist",
    ...overrides,
  }
}

test("creates a bounded allowlisted session record with canonical identity", () => {
  const record = createTradingSessionRecord(createSessionInput())

  assert.equal(record.id, record.runtimeSessionId, "The persisted record ID must equal the immutable process/session identity.")
  assert.equal(record.schemaVersion, 1, "The first Harvester-owned trading-session schema version must be explicit.")
  assert.equal(record.environment, "testnet", "The record must preserve the validated trading environment.")
  assert.deepEqual(record.enabledMarkets, ["BTCUSDT", "ETHUSDT"], "Enabled markets must be unique and sorted into canonical order.")
  assert.deepEqual(record.metadata, { recordKind: "ordinary-trading-history" }, "Only the fixed non-secret history classification may be persisted as metadata.")
  assert.deepEqual(Object.keys(record.buildProvenance).sort(), ["application", "processId", "source", "version"], "Build provenance must contain only its allowlisted top-level fields.")
  assert.equal(JSON.stringify(record).includes("must-not-persist"), false, "Unknown credentials and secret-bearing fields must never leak into the historical record.")
  assert.equal("commitMessage" in record.buildProvenance.source, false, "Free-form Git commit messages must not be persisted because they can contain accidental secrets.")
})

test("rejects invalid environment, identity, configuration, markets, timestamps and provenance", () => {
  const invalidCases = [
    {
      label: "environment",
      overrides: { environment: "production" },
      expected: /environment must be testnet or live/,
    },
    {
      label: "broker",
      overrides: { broker: "Binance" },
      expected: /canonical lowercase provider identity/,
    },
    {
      label: "strategy mode",
      overrides: { strategyMode: "unsafe" },
      expected: /strategyMode must be/,
    },
    {
      label: "configuration fingerprint",
      overrides: { configurationFingerprint: "not-a-digest" },
      expected: /lowercase SHA-256 digest/,
    },
    {
      label: "duplicate market",
      overrides: { enabledMarkets: ["BTCUSDT", "BTCUSDT"] },
      expected: /unique canonical market symbols/,
    },
    {
      label: "non-canonical start timestamp",
      overrides: { startedAt: "yesterday" },
      expected: /canonical UTC ISO-8601 timestamp/,
    },
    {
      label: "invalid process ID",
      overrides: {
        buildProvenance: {
          ...BUILD_PROVENANCE,
          processId: 0,
        },
      },
      expected: /positive safe integer/,
    },
  ]

  for (const invalidCase of invalidCases) {
    assert.throws(
      () => createTradingSessionRecord(createSessionInput(invalidCase.overrides)),
      invalidCase.expected,
      `The session domain must reject an invalid ${invalidCase.label}.`,
    )
  }
})

test("enforces valid lifecycle transitions and preserves terminal timestamps", () => {
  const starting = createTradingSessionRecord(createSessionInput())
  const running = createTradingSessionTransition({
    current: starting,
    status: "RUNNING",
  })
  const stopped = createTradingSessionTransition({
    current: {
      ...starting,
      status: "RUNNING",
    },
    status: "STOPPED",
    endedAt: ENDED_AT,
  })
  const duplicateStop = createTradingSessionTransition({
    current: {
      ...starting,
      status: "STOPPED",
      endedAt: ENDED_AT,
    },
    status: "STOPPED",
    endedAt: "2026-11-17T18:00:00.000Z",
  })

  assert.equal(running.status, "RUNNING", "STARTING may transition to RUNNING after successful startup.")
  assert.equal(stopped.status, "STOPPED", "RUNNING may transition to STOPPED after successful shutdown.")
  assert.equal(stopped.endedAt, ENDED_AT, "A terminal transition must preserve its canonical end timestamp.")
  assert.equal(duplicateStop.duplicate, true, "Repeating the current terminal state must be idempotent.")
  assert.equal(duplicateStop.endedAt, ENDED_AT, "An idempotent terminal retry must not overwrite the first end timestamp.")
  assert.throws(
    () => createTradingSessionTransition({
      current: starting,
      status: "STOPPED",
      endedAt: ENDED_AT,
    }),
    (error) => error?.code === "HARVESTER_TRADING_SESSION_TRANSITION_INVALID",
    "STARTING must not skip directly to STOPPED.",
  )
})

test("compares immutable identity while ignoring lifecycle state", () => {
  const existing = createTradingSessionRecord(createSessionInput())
  const progressed = {
    ...existing,
    status: "STOPPED",
    endedAt: ENDED_AT,
  }
  const conflicting = {
    ...existing,
    environment: "live",
  }

  assert.equal(hasSameTradingSessionIdentity({
    existing,
    candidate: progressed,
  }), true, "A duplicate delivery must match even after the stored lifecycle state has advanced.")
  assert.equal(hasSameTradingSessionIdentity({
    existing,
    candidate: conflicting,
  }), false, "Reusing the same session ID with a different environment must be an integrity conflict.")
})
