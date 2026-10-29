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

  it("pings only when the connection is ready", () => {
    const warnings = []
    const calls = []
    const client = new WS({
      logger: {
        info: (message) => calls.push(message),
        warn: (message) => warnings.push(message),
      },
    })
    client.isConnected = () => true
    client.wsConnection.ws = { ping: () => calls.push("ping") }

    client.pingServer()

    assert.deepEqual(calls, ["Send PING to the Websocket Server", "ping"])
    assert.deepEqual(warnings, [])
  })

  it("warns instead of pinging when disconnected", () => {
    const warnings = []
    const client = new WS({ logger: { warn: (message) => warnings.push(message) } })
    client.isConnected = () => false

    client.pingServer()

    assert.deepEqual(warnings, ["Ping only can be sent when connection is ready."])
  })

  it("closes an active connection and marks the close as intentional", () => {
    const calls = []
    const client = new WS({
      logger: {
        info: (message) => calls.push(message),
        warn: (message) => calls.push(message),
      },
    })
    client.isConnected = () => true
    client.wsConnection.ws = { close: () => calls.push("close") }

    client.disconnect()

    assert.equal(client.wsConnection.closeInitiated, true)
    assert.deepEqual(calls, ["close", "Disconnected with Binance Websocket Server"])
  })

  it("warns when asked to disconnect without an active connection", () => {
    const warnings = []
    const client = new WS({ logger: { warn: (message) => warnings.push(message) } })
    client.isConnected = () => false

    client.disconnect()

    assert.deepEqual(warnings, ["No connection to close."])
  })
})

it("overrides only the supplied default callbacks", () => {
  const calls = []
  const client = new WS({
    logger: { debug: () => {}, info: (value) => calls.push(value) },
    callbacks: { open: () => calls.push("custom-open") },
  })
  client.callbacks.open()
  client.callbacks.message('{"event":"trade"}')
  assert.deepEqual(calls, ["custom-open", { event: "trade" }])
})
