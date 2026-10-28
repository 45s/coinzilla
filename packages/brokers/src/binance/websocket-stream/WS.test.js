import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { WS } from "./WS.js"

describe("WS/send", () => {
  it("does not send when the connection is not ready", () => {
    const warnings = []
    const client = new WS({
      logger: { warn: (message) => warnings.push(message) },
    })
    client.isConnected = () => false

    assert.equal(client.send("payload"), false)
    assert.deepEqual(warnings, [
      "Cannot send: WebSocket connection is not ready.",
    ])
  })

  it("sends when the connection is ready", () => {
    const sent = []
    const warnings = []
    const client = new WS({
      logger: { warn: (message) => warnings.push(message) },
    })
    client.isConnected = () => true
    client.wsConnection.ws = {
      send: (payload) => sent.push(payload),
    }

    assert.equal(client.send("payload"), true)
    assert.deepEqual(sent, ["payload"])
    assert.deepEqual(warnings, [])
  })
})
