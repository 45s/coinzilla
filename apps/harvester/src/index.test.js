import test from "node:test"
import assert from "node:assert/strict"
import { main } from "./index.js"

test("uses the injected logger when startup succeeds without a broker", async () => {
  const calls = []
  const logger = {
    info: (message) => calls.push({ level: "info", message }),
    error: (data) => calls.push({ level: "error", data }),
  }

  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      start: async () => ({ connected: false }),
      logger,
    })

    assert.deepEqual(calls, [{
      level: "info",
      message: "Harvester configuration validated; broker connection and market data are disabled.",
    }])
    assert.equal(process.exitCode, 0)
  } finally {
    process.exitCode = previousExitCode
  }
})

test("logs startup failures as one structured logger argument", async () => {
  const calls = []
  const error = new Error("configuration failed")
  const logger = {
    info: (data) => calls.push({ level: "info", data }),
    error: (data) => calls.push({ level: "error", data }),
  }

  const previousExitCode = process.exitCode
  process.exitCode = 0
  try {
    await main({
      start: async () => { throw error },
      logger,
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].level, "error")
    assert.equal(calls[0].data.message, "Harvester startup failed.")
    assert.equal(calls[0].data.error, error)
    assert.equal(process.exitCode, 1)
  } finally {
    process.exitCode = previousExitCode
  }
})
