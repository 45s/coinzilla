import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { WS } from "./WS.js"

describe("WS reconnect defaults", () => {
  it("uses 5000ms when reconnectDelay is omitted", () => {
    assert.equal(new WS({ wsURL: "wss://example.test", logger: {} }).reconnectDelay, 5000)
  })

  it("preserves an explicit zero reconnect delay", () => {
    assert.equal(new WS({ wsURL: "wss://example.test", reconnectDelay: 0, logger: {} }).reconnectDelay, 5000)
  })
})
