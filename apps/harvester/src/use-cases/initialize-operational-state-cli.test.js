import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_OPERATIONAL_STATE_DIRECTORY } from "../infrastructure/operational-state/resolve-operational-state-directory.js"
import { runInitializeOperationalState } from "./initialize-operational-state-cli.js"

const createLogger = () => {
  const calls = []
  return {
    calls,
    system: (message) => calls.push(["system", message]),
    error: (message) => calls.push(["error", message]),
  }
}

test("requires explicit confirmation before invoking genesis initialization", async () => {
  const logger = createLogger()
  let initializeCalls = 0
  const exitCode = await runInitializeOperationalState({
    env: { OPERATIONAL_STATE_DIRECTORY: "/tmp/recovery-facts" },
    args: [],
    initialize: async () => { initializeCalls += 1; return { ok: true } },
    logger,
  })
  assert.equal(exitCode, 1)
  assert.equal(initializeCalls, 0)
})

test("uses the app-local default directory and rejects relative overrides or unknown arguments", async () => {
  let initializeCalls = 0
  const initialize = async () => { initializeCalls += 1; return { ok: true } }
  const relative = await runInitializeOperationalState({
    env: { OPERATIONAL_STATE_DIRECTORY: "relative/recovery-facts" },
    args: ["--confirm-initialize"],
    initialize,
    logger: createLogger(),
  })
  let defaultDirectory
  const defaulted = await runInitializeOperationalState({
    env: {},
    args: ["--confirm-initialize"],
    initialize: async (input) => {
      defaultDirectory = input.directory
      return { ok: true, data: { directory: input.directory, sequence: "0", durable: true } }
    },
    logger: createLogger(),
  })
  const unknown = await runInitializeOperationalState({
    env: { OPERATIONAL_STATE_DIRECTORY: "/tmp/recovery-facts" },
    args: ["--confirm-initialize", "--force"],
    initialize,
    logger: createLogger(),
  })
  assert.deepEqual([relative, defaulted, unknown], [1, 0, 1])
  assert.equal(defaultDirectory, DEFAULT_OPERATIONAL_STATE_DIRECTORY)
  assert.equal(initializeCalls, 0)
})

test("initializes only the operator-selected absolute directory and reports durable success", async () => {
  const logger = createLogger()
  let received
  const exitCode = await runInitializeOperationalState({
    env: { OPERATIONAL_STATE_DIRECTORY: "/tmp/recovery-facts" },
    args: ["--confirm-initialize"],
    initialize: async (input) => {
      received = input
      return { ok: true, data: { directory: input.directory, sequence: "0", durable: true } }
    },
    logger,
  })
  assert.equal(exitCode, 0)
  assert.deepEqual(received, { confirmed: true, directory: "/tmp/recovery-facts" })
  assert.equal(logger.calls[0][0], "system")
})

test("does not report success when genesis initialization fails", async () => {
  const logger = createLogger()
  const exitCode = await runInitializeOperationalState({
    env: { OPERATIONAL_STATE_DIRECTORY: "/tmp/recovery-facts" },
    args: ["--confirm-initialize"],
    initialize: async () => ({ ok: false, errors: [new Error("ledger already exists")] }),
    logger,
  })
  assert.equal(exitCode, 1)
  assert.equal(logger.calls[0][0], "error")
})

test("does not read the removed legacy directory environment variable", async () => {
  let received
  const exitCode = await runInitializeOperationalState({
    env: { DURABLE_FACTS_DIRECTORY: "/tmp/legacy-recovery-facts" },
    args: ["--confirm-initialize"],
    initialize: async (input) => {
      received = input
      return { ok: true, data: { directory: input.directory, sequence: "0", durable: true } }
    },
    logger: createLogger(),
  })
  assert.equal(exitCode, 0)
  assert.equal(received.directory, DEFAULT_OPERATIONAL_STATE_DIRECTORY)
})
