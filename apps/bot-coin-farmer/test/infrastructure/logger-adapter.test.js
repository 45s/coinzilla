import test from "node:test"
import assert from "node:assert/strict"

import { createLoggerAdapter } from "../../src/infrastructure/logging/logger-adapter.js"

test("createLoggerAdapter forwards supported structured log methods", () => {
  const entries = []
  const logger = {
    info: (entry) => entries.push(["info", entry]),
    error: (entry) => entries.push(["error", entry]),
    debug: (entry) => entries.push(["debug", entry]),
  }
  const adapter = createLoggerAdapter({ logger })

  adapter.info({ message: "started" })
  adapter.error({ message: "failed" })
  adapter.debug({ message: "details" })

  assert.deepEqual(entries, [
    ["info", { message: "started" }],
    ["error", { message: "failed" }],
    ["debug", { message: "details" }],
  ])
  assert.equal(Object.isFrozen(adapter), true)
})

test("createLoggerAdapter rejects an incomplete logger", () => {
  assert.throws(
    () => createLoggerAdapter({ logger: { info() {} } }),
    /logger.error must be a function/,
  )
})
