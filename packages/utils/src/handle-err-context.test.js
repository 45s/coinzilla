import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { handleErr } from "./handle-err.js"

describe("handleErr logger context", () => {
  it("passes the original error and location to logger.error", () => {
    const calls = []
    const logger = { error: (payload) => calls.push(payload) }
    const error = new Error("request timed out")
    handleErr({ logger, where: "test.operation", error })
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], { where: "test.operation", error, message: "request timed out" })
  })
})
