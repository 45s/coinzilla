import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { assertUserDataClientPort } from "./user-data-client-port.js"

function createValidPort() {
  const removeListener = () => {}
  return {
    state: "open",
    connect: async () => {},
    disconnect: async () => {},
    onEvent: () => removeListener,
    onError: () => removeListener,
    onClose: () => removeListener,
    subscribe: async () => 17,
    listSubscriptions: async () => [17],
    unsubscribe: async () => {},
  }
}

describe("user-data client port contract", () => {
  it("accepts a complete application-facing port", () => {
    const port = createValidPort()
    assert.equal(assertUserDataClientPort(port), port)
  })

  it("rejects a missing port", () => {
    assert.throws(() => assertUserDataClientPort(null), TypeError)
  })

  it("rejects a port missing required capabilities", () => {
    const port = createValidPort()
    delete port.unsubscribe
    assert.throws(() => assertUserDataClientPort(port), TypeError)
  })

  it("rejects a port without a state value", () => {
    const port = createValidPort()
    port.state = null
    assert.throws(() => assertUserDataClientPort(port), TypeError)
  })
})
