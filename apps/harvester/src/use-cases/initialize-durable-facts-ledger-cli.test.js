import assert from "node:assert/strict"
import test from "node:test"
import { runInitializeDurableFactsLedger } from "./initialize-durable-facts-ledger-cli.js"

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
  const exitCode = await runInitializeDurableFactsLedger({
    env: { DURABLE_FACTS_DIRECTORY: "/tmp/recovery-facts" },
    args: [],
    initialize: async () => { initializeCalls += 1; return { ok: true } },
    logger,
  })
  assert.equal(exitCode, 1)
  assert.equal(initializeCalls, 0)
})

test("requires an absolute DURABLE_FACTS_DIRECTORY and rejects unknown arguments", async () => {
  let initializeCalls = 0
  const initialize = async () => { initializeCalls += 1; return { ok: true } }
  const relative = await runInitializeDurableFactsLedger({
    env: { DURABLE_FACTS_DIRECTORY: "relative/recovery-facts" },
    args: ["--confirm-initialize"],
    initialize,
    logger: createLogger(),
  })
  const missing = await runInitializeDurableFactsLedger({
    env: {},
    args: ["--confirm-initialize"],
    initialize,
    logger: createLogger(),
  })
  const unknown = await runInitializeDurableFactsLedger({
    env: { DURABLE_FACTS_DIRECTORY: "/tmp/recovery-facts" },
    args: ["--confirm-initialize", "--force"],
    initialize,
    logger: createLogger(),
  })
  assert.deepEqual([relative, missing, unknown], [1, 1, 1])
  assert.equal(initializeCalls, 0)
})

test("initializes only the operator-selected absolute directory and reports durable success", async () => {
  const logger = createLogger()
  let received
  const exitCode = await runInitializeDurableFactsLedger({
    env: { DURABLE_FACTS_DIRECTORY: "/tmp/recovery-facts" },
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
  const exitCode = await runInitializeDurableFactsLedger({
    env: { DURABLE_FACTS_DIRECTORY: "/tmp/recovery-facts" },
    args: ["--confirm-initialize"],
    initialize: async () => ({ ok: false, errors: [new Error("ledger already exists")] }),
    logger,
  })
  assert.equal(exitCode, 1)
  assert.equal(logger.calls[0][0], "error")
})
