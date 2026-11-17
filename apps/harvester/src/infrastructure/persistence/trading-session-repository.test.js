import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  createDatabase,
  createSqliteProvider,
  DatabaseProviderError,
} from "@coinzilla/db"
import { createTradingSessionRepository } from "./trading-session-repository.js"

const SESSION_STARTED_AT = "2026-11-17T16:00:00.000Z"
const SESSION_ENDED_AT = "2026-11-17T17:00:00.000Z"
const CONFIGURATION_FINGERPRINT = "a".repeat(64)

function createSessionRecord(overrides = {}) {
  return {
    id: "runtime-session-001",
    schemaVersion: 1,
    runtimeSessionId: "runtime-session-001",
    environment: "testnet",
    broker: "binance",
    strategyId: "CG_coinGrabber",
    strategyMode: "conservative",
    configurationFingerprint: CONFIGURATION_FINGERPRINT,
    enabledMarkets: ["BTCUSDT", "ETHUSDT"],
    buildProvenance: {
      application: "harvester",
      version: "1.0.001",
      processId: 12345,
      source: {
        branch: "develop",
        commit: "a".repeat(40),
        shortCommit: "a".repeat(8),
        commitMessage: "test build",
        commitDate: "2026-11-17T15:00:00.000Z",
        workingTree: "clean",
        metadataSource: "git",
      },
    },
    startedAt: SESSION_STARTED_AT,
    endedAt: null,
    status: "STARTING",
    metadata: {
      sessionKind: "trading-process",
    },
    ...overrides,
  }
}

async function createDatabaseFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-trading-session-"))
  let database = createDatabase({
    provider: createSqliteProvider({
      filename: path.join(directory, "harvester.db"),
      timeout: 5_000,
    }),
  })
  await database.connect()
  const repository = createTradingSessionRepository({ database })
  t.after(async () => {
    if (database.state !== "closed") {
      await database.close()
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  return {
    directory,
    database,
    repository,
    reopen: async () => {
      database = createDatabase({
        provider: createSqliteProvider({
          filename: path.join(directory, "harvester.db"),
          timeout: 5_000,
        }),
      })
      await database.connect()
      return {
        database,
        repository: createTradingSessionRepository({ database }),
      }
    },
  }
}

test("creates a trading session once and treats an identical duplicate as harmless", async (t) => {
  const { repository } = await createDatabaseFixture(t)
  const session = createSessionRecord()

  const created = await repository.create(session)
  const duplicate = await repository.create(session)

  assert.deepEqual(created, session, "The first process-session creation must persist the complete validated historical record.")
  assert.deepEqual(duplicate, created, "Retrying the same process-session identity and business facts must return the original record without creating a second session.")
})

test("rejects conflicting reuse of a trading-session identity", async (t) => {
  const { repository } = await createDatabaseFixture(t)
  const originalSession = createSessionRecord()
  const conflictingSession = createSessionRecord({
    configurationFingerprint: "b".repeat(64),
  })

  await repository.create(originalSession)
  await assert.rejects(
    repository.create(conflictingSession),
    (error) => error?.code === "HARVESTER_TRADING_SESSION_IDENTITY_CONFLICT",
    "Reusing a process-session identity with a different configuration fingerprint must fail as an integrity conflict.",
  )
})

test("updates only valid lifecycle transitions and preserves immutable session identity", async (t) => {
  const { repository } = await createDatabaseFixture(t)
  const originalSession = createSessionRecord()
  await repository.create(originalSession)

  const runningSession = await repository.transition({
    id: originalSession.id,
    status: "RUNNING",
  })
  const stoppedSession = await repository.transition({
    id: originalSession.id,
    status: "STOPPED",
    endedAt: SESSION_ENDED_AT,
  })
  const repeatedStop = await repository.transition({
    id: originalSession.id,
    status: "STOPPED",
    endedAt: "2026-11-17T18:00:00.000Z",
  })

  assert.equal(runningSession.status, "RUNNING", "A successfully started runtime must advance its session from STARTING to RUNNING.")
  assert.equal(stoppedSession.status, "STOPPED", "A confirmed graceful shutdown must advance its session from RUNNING to STOPPED.")
  assert.equal(stoppedSession.endedAt, SESSION_ENDED_AT, "The first confirmed terminal transition must preserve its exact end timestamp.")
  assert.deepEqual(repeatedStop, stoppedSession, "Repeating an already committed terminal transition must be idempotent and must not rewrite its original end timestamp.")
  assert.equal(stoppedSession.configurationFingerprint, originalSession.configurationFingerprint, "Lifecycle updates must preserve the immutable configuration fingerprint.")
  assert.deepEqual(stoppedSession.enabledMarkets, originalSession.enabledMarkets, "Lifecycle updates must preserve the exact enabled market set.")
  assert.deepEqual(stoppedSession.buildProvenance, originalSession.buildProvenance, "Lifecycle updates must preserve the immutable build provenance.")
})

test("rejects invalid lifecycle transitions without changing the stored session", async (t) => {
  const { repository } = await createDatabaseFixture(t)
  const originalSession = createSessionRecord()
  await repository.create(originalSession)
  await repository.transition({
    id: originalSession.id,
    status: "RUNNING",
  })
  const stoppedSession = await repository.transition({
    id: originalSession.id,
    status: "STOPPED",
    endedAt: SESSION_ENDED_AT,
  })

  await assert.rejects(
    repository.transition({
      id: originalSession.id,
      status: "RUNNING",
    }),
    (error) => error?.code === "HARVESTER_TRADING_SESSION_TRANSITION_INVALID",
    "A terminal STOPPED session must never transition back to RUNNING.",
  )
  assert.deepEqual(
    await repository.findById(originalSession.id),
    stoppedSession,
    "A rejected lifecycle transition must leave the persisted session exactly unchanged.",
  )
})

test("recovers the exact historical session after closing and reopening the SQLite database", async (t) => {
  const fixture = await createDatabaseFixture(t)
  const originalSession = createSessionRecord()
  await fixture.repository.create(originalSession)
  await fixture.database.close()

  const reopened = await fixture.reopen()
  const recoveredSession = await reopened.repository.findById(originalSession.id)

  assert.deepEqual(recoveredSession, originalSession, "Reopening the provider-neutral database must recover the exact historical trading-session record.")
})

test("propagates transaction rollback, closed lifecycle and provider failures", async (t) => {
  const { database, repository } = await createDatabaseFixture(t)
  const originalSession = createSessionRecord()
  const rollbackError = new Error("intentional session transaction rollback")

  await assert.rejects(
    database.transaction((transaction) => {
      transaction.create({
        collection: "trading_sessions",
        record: originalSession,
      })
      throw rollbackError
    }),
    (error) => error === rollbackError,
    "A transaction callback failure must propagate unchanged to the Harvester infrastructure boundary.",
  )
  assert.equal(
    await repository.findById(originalSession.id),
    null,
    "A failed database transaction must roll back the complete session record rather than leave a partial write.",
  )

  await database.close()
  await assert.rejects(
    repository.findById(originalSession.id),
    /Database must be connected to start a transaction/,
    "A closed database lifecycle must reject repository reads instead of pretending that history is empty.",
  )

  const providerError = new DatabaseProviderError({
    operation: "readOne",
    collection: "harvester_trading_sessions",
    cause: new Error("simulated SQLite I/O failure"),
  })
  const failingCreateRepository = createTradingSessionRepository({
    database: {
      capabilities: database.capabilities,
      create: async () => { throw providerError },
      readOne: database.readOne,
      transaction: database.transaction,
    },
  })
  await assert.rejects(
    failingCreateRepository.create(originalSession),
    (error) => error === providerError,
    "A provider failure during session creation must propagate unchanged instead of being mistaken for a duplicate.",
  )

  const failingReadRepository = createTradingSessionRepository({
    database: {
      capabilities: database.capabilities,
      create: database.create,
      readOne: async () => { throw providerError },
      transaction: database.transaction,
    },
  })
  await assert.rejects(
    failingReadRepository.findById(originalSession.id),
    (error) => error === providerError,
    "A provider-neutral DatabaseProviderError must propagate unchanged through the Harvester repository adapter.",
  )

  const failingTransactionRepository = createTradingSessionRepository({
    database: {
      capabilities: database.capabilities,
      create: database.create,
      readOne: database.readOne,
      transaction: async () => { throw providerError },
    },
  })
  await assert.rejects(
    failingTransactionRepository.transition({
      id: originalSession.id,
      status: "RUNNING",
    }),
    (error) => error === providerError,
    "A provider failure during an atomic lifecycle transaction must propagate unchanged to the Harvester application boundary.",
  )
})
