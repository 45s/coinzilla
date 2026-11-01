import test from "node:test"
import assert from "node:assert/strict"

import { createContainer } from "../../src/bootstrap/container.js"
import { createValidConfig } from "../helpers/config.js"

test("createContainer injects runtime dependencies without connecting a broker", () => {
  const calls = []
  const logger = {
    info: (entry) => calls.push(["info", entry]),
    error: (entry) => calls.push(["error", entry]),
  }
  const eventBus = {
    publish() {},
    subscribeAll() {},
    flush() {},
    close() {},
  }
  const journal = { start() {}, close() {} }

  const runtime = createContainer({
    config: createValidConfig(),
    logger,
    eventBus,
    journal,
  })

  assert.equal(runtime.eventBus, eventBus)
  assert.equal(runtime.journal, journal)
  assert.equal(runtime.state, "created")
  assert.equal(typeof runtime.logger.info, "function")
  assert.deepEqual(calls, [])
})

test("createContainer rejects missing config", () => {
  assert.throws(() => createContainer(), /validated config object is required/)
})
