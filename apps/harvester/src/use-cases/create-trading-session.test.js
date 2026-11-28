import assert from "node:assert/strict"
import test from "node:test"
import { createTradingSession } from "./create-trading-session.js"

const BUILD_PROVENANCE = {
  application: "harvester",
  version: "1.0.001",
  processId: 12345,
  source: {
    branch: "develop",
    commit: "A".repeat(40),
    shortCommit: "AAAAAAAA",
    commitDate: "2026-11-17T15:00:00.000Z",
    workingTree: "clean",
    metadataSource: "git",
    apiSecret: "must-not-persist",
  },
  apiKey: "must-not-persist",
}

function createSessionInput({ buildProvenance = BUILD_PROVENANCE } = {}) {
  return {
    runtimeSessionId: "runtime-session-use-case-001",
    environment: "testnet",
    broker: "binance",
    strategyId: "CG_coinGrabber",
    strategyMode: "conservative",
    configurationFingerprint: "a".repeat(64),
    enabledMarkets: ["ETHUSDT", "BTCUSDT"],
    buildProvenance,
    startedAt: "2026-11-17T16:00:00.000Z",
  }
}

function createRepository({ create = async (record) => record } = {}) {
  return {
    create,
    findById: async () => null,
    transition: async () => null,
  }
}

test("persists only normalized allowlisted build provenance through the trading-session use case", async () => {
  let persistedRecord = null
  const repository = createRepository({
    create: async (record) => {
      persistedRecord = record
      return record
    },
  })

  const created = await createTradingSession({
    repository,
    session: createSessionInput(),
  })

  assert.deepEqual(persistedRecord.buildProvenance, {
    application: "harvester",
    version: "1.0.001",
    processId: 12345,
    source: {
      branch: "develop",
      commit: "a".repeat(40),
      shortCommit: "a".repeat(8),
      commitDate: "2026-11-17T15:00:00.000Z",
      workingTree: "clean",
      metadataSource: "git",
    },
  }, "The repository port must receive canonical provenance with only explicitly allowlisted fields.")
  assert.equal(JSON.stringify(persistedRecord).includes("must-not-persist"), false, "Secret-bearing and unknown provenance properties must not cross the persistence boundary.")
  assert.equal(persistedRecord.schemaVersion, 1, "Moving validation to the application boundary must preserve the existing persisted schema version.")
  assert.deepEqual(created, persistedRecord, "The use case must return the exact record accepted by the repository port.")
})

test("rejects malformed provenance before the repository receives a write", async () => {
  let createCalls = 0
  const repository = createRepository({
    create: async (record) => {
      createCalls += 1
      return record
    },
  })
  const session = createSessionInput({
    buildProvenance: {
      ...BUILD_PROVENANCE,
      source: {
        ...BUILD_PROVENANCE.source,
        commit: "not-a-git-sha",
      },
    },
  })

  await assert.rejects(
    createTradingSession({
      repository,
      session,
    }),
    /hexadecimal Git SHA/,
    "Malformed build provenance must be rejected before a persistence write is attempted.",
  )
  assert.equal(createCalls, 0, "A failed application input mapping must never reach the repository write method.")
})
