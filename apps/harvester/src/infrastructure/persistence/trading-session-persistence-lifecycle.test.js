import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { closeTradingSessionPersistence } from "./close-trading-session-persistence.js"
import { prepareTradingSessionPersistence } from "./prepare-trading-session-persistence.js"

test("prepares a real provider-neutral SQLite session database and closes it", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-session-persistence-"))
  let database
  t.after(async () => {
    if (database?.state !== "closed") {
      await database?.close()
    }
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })

  const result = await prepareTradingSessionPersistence({
    tradingMode: "testnet",
    env: {
      HARVESTER_DATABASE_DIRECTORY: directory,
    },
  })
  assert.ok(result, "A valid isolated database directory must compose the real SQLite provider and session repository.")
  database = result.database
  assert.equal(database.state, "connected", "The provider-neutral database must be connected before the repository is exposed.")
  assert.equal(
    await result.repository.findById("missing-session"),
    null,
    "The prepared repository must support a provider-neutral read against the connected SQLite database.",
  )

  const errors = await closeTradingSessionPersistence({
    database,
  })
  assert.deepEqual(errors, [], "A clean history database close must return no cleanup errors.")
  assert.equal(database.state, "closed", "The lifecycle helper must close the provider after repository use.")
})

test("reports invalid optional history configuration without blocking startup", async () => {
  const loggedEntries = []
  const result = await prepareTradingSessionPersistence({
    tradingMode: "testnet",
    env: {
      HARVESTER_DATABASE_DIRECTORY: "relative/history/path",
    },
    logger: {
      error: (entry) => loggedEntries.push(entry),
    },
  })

  assert.equal(result, null, "An invalid history directory must disable only the optional history projection.")
  assert.equal(loggedEntries.length, 1, "An invalid history directory must be reported once.")
  assert.equal(loggedEntries[0].persistenceStage, "prepare", "The failure report must identify the preparation stage.")
  assert.equal(loggedEntries[0].message.includes("relative/history/path"), false, "Persistence diagnostics must not expose configured paths.")
})

test("closes the database even when observer cleanup fails", async () => {
  const calls = []
  const observer = {
    close: async () => {
      calls.push("observer")
      throw new Error("simulated observer cleanup failure")
    },
  }
  const database = {
    state: "connected",
    close: async () => {
      calls.push("database")
    },
  }

  const errors = await closeTradingSessionPersistence({
    observer,
    database,
  })

  assert.deepEqual(calls, ["observer", "database"], "The database must still close after observer cleanup fails.")
  assert.equal(errors.length, 1, "Observer cleanup failure must be returned as one sanitized cleanup error.")
  assert.equal(errors[0].message, "Trading-session history observer close failed", "Observer cleanup diagnostics must not leak provider paths or raw error details.")
})

test("returns a sanitized database close error and skips already closed resources", async () => {
  const database = {
    state: "connected",
    close: async () => {
      throw new Error("sensitive provider filename")
    },
  }
  const errors = await closeTradingSessionPersistence({
    database,
  })

  assert.equal(errors.length, 1, "A failed database close must be returned as one cleanup error.")
  assert.equal(errors[0].message, "Trading-session history database close failed", "Database close errors must not leak provider-specific paths.")

  let closeCount = 0
  const alreadyClosedDatabase = {
    state: "closed",
    close: async () => {
      closeCount += 1
    },
  }
  const skippedErrors = await closeTradingSessionPersistence({
    database: alreadyClosedDatabase,
  })
  assert.deepEqual(skippedErrors, [], "An already closed database must be treated as a clean idempotent close.")
  assert.equal(closeCount, 0, "An already closed database must not be closed a second time.")
})
