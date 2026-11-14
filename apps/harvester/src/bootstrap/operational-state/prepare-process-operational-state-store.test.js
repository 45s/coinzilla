import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { DEFAULT_OPERATIONAL_STATE_DIRECTORY } from "../../infrastructure/operational-state/resolve-operational-state-directory.js"
import { prepareProcessOperationalStateStore } from "./prepare-process-operational-state-store.js"

const config = ({ recovery = false, operator = false } = {}) => ({
  strategies: { CG_coinGrabber: { settings: { recovery: { enabled: recovery } } } },
  operatorControl: { telegram: { enabled: operator } },
})
const store = () => ({ verify: async () => ({ ok: true, data: { valid: true, durableWriteSupported: true } }) })

test("skips store creation when neither recovery nor operator control requires it", async () => {
  let calls = 0
  assert.equal(await prepareProcessOperationalStateStore({
    appConfig: config(), runtimeSessionId: "session", createOperationalStateStore: () => { calls += 1 },
  }), undefined)
  assert.equal(calls, 0)
})

test("uses the documented default directory for Telegram operator control", async () => {
  let options
  const expected = store()
  const actual = await prepareProcessOperationalStateStore({
    appConfig: config({ operator: true }), env: {}, runtimeSessionId: "session",
    createOperationalStateStore: (value) => { options = value; return expected },
  })
  assert.strictEqual(actual, expected)
  assert.equal(options.directory, DEFAULT_OPERATIONAL_STATE_DIRECTORY)
  assert.equal(path.basename(options.directory), "recovery-facts")
  assert.ok(options.directory.endsWith(path.join("apps", "harvester", "recovery-facts")))
  assert.equal(options.runtimeSessionId, "session")
})

test("honors a valid absolute OPERATIONAL_STATE_DIRECTORY", async () => {
  let options
  await prepareProcessOperationalStateStore({
    appConfig: config({ operator: true }), env: { OPERATIONAL_STATE_DIRECTORY: path.resolve("ledger") },
    runtimeSessionId: "session", createOperationalStateStore: (value) => { options = value; return store() },
  })
  assert.equal(options.directory, path.resolve("ledger"))
})

test("rejects malformed OPERATIONAL_STATE_DIRECTORY before calling the factory", async () => {
  let calls = 0
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ operator: true }), env: { OPERATIONAL_STATE_DIRECTORY: "relative/path" },
      runtimeSessionId: "session", createOperationalStateStore: () => { calls += 1 },
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_DIRECTORY_INVALID" && error.message.includes("OPERATIONAL_STATE_DIRECTORY"),
  )
  assert.equal(calls, 0)
})

test("wraps store factory failures with stage, path and original cause", async () => {
  const cause = new Error("disk unavailable")
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ operator: true }), env: {}, runtimeSessionId: "session",
      createOperationalStateStore: () => { throw cause },
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_STORE_CREATE_FAILED" &&
      error.cause === cause && error.message.includes("recovery-facts"),
  )
})

test("fails closed when recovery ledger verification fails or throws", async () => {
  const invalid = new Error("corrupt chain")
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ recovery: true }), runtimeSessionId: "session",
      createOperationalStateStore: () => ({ verify: async () => ({ ok: false, errors: [invalid] }) }),
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_VERIFICATION_FAILED" && error.cause === invalid,
  )
  const thrown = new Error("read EIO")
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ recovery: true }), runtimeSessionId: "session",
      createOperationalStateStore: () => ({ verify: async () => { throw thrown } }),
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_VERIFICATION_FAILED" && error.cause === thrown,
  )
})

test("reports invalid session identity and factory dependencies", async () => {
  await assert.rejects(
    prepareProcessOperationalStateStore({ appConfig: config({ operator: true }), runtimeSessionId: "" }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_SESSION_ID_INVALID",
  )
  await assert.rejects(
    prepareProcessOperationalStateStore({
      appConfig: config({ operator: true }), runtimeSessionId: "session", createOperationalStateStore: null,
    }),
    (error) => error.code === "PROCESS_OPERATIONAL_STATE_FACTORY_INVALID",
  )
})

test("ignores the removed DURABLE_FACTS_DIRECTORY override", async () => {
  let options
  await prepareProcessOperationalStateStore({
    appConfig: config({ operator: true }),
    env: { DURABLE_FACTS_DIRECTORY: path.resolve("legacy-recovery-facts") },
    runtimeSessionId: "session",
    createOperationalStateStore: (value) => { options = value; return store() },
  })
  assert.equal(options.directory, DEFAULT_OPERATIONAL_STATE_DIRECTORY)
})

test("uses the canonical override and ignores the removed legacy variable", async () => {
  let options
  const canonicalDirectory = path.resolve("new-store")
  await prepareProcessOperationalStateStore({
    appConfig: config({ operator: true }),
    env: {
      OPERATIONAL_STATE_DIRECTORY: canonicalDirectory,
      DURABLE_FACTS_DIRECTORY: path.resolve("old-store"),
    },
    runtimeSessionId: "session",
    createOperationalStateStore: (value) => { options = value; return store() },
  })
  assert.equal(options.directory, canonicalDirectory)
})
