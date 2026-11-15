import assert from "node:assert/strict"
import test from "node:test"
import { BitunixWebSocketApiClient } from "./rpc-client.js"

class FakeTransport {
  constructor() {
    this.messages = new Set()
    this.closes = new Set()
    this.sent = []
    this.state = "idle"
  }

  async connect() {
    this.state = "open"
  }

  send(message) {
    this.sent.push(JSON.parse(message))
  }

  async close() {
    this.state = "closed"
  }

  onMessage(listener) {
    this.messages.add(listener)
    return () => this.messages.delete(listener)
  }

  onClose(listener) {
    this.closes.add(listener)
    return () => this.closes.delete(listener)
  }

  onError() {
    return () => {}
  }

  respond(message) {
    for (const listener of this.messages) {
      listener(JSON.stringify(message))
    }
  }
}

test("Bitunix WebSocket API client signs requests and unwraps successful responses", async () => {
  const transport = new FakeTransport()
  const client = new BitunixWebSocketApiClient({
    transport,
    apiKey: "api-key",
    apiSecret: "secret",
    now: () => 1700000000000,
    nonceFactory: () => "nonce",
    idFactory: () => "request-1",
  })

  await client.connect()
  const resultPromise = client.request("market.last_price", { symbol: "BTCUSDT" })
  const [request] = transport.sent

  assert.equal(request.method, "market.last_price")
  assert.deepEqual(request.params, {
    symbol: "BTCUSDT",
    nonce: "nonce",
    timestamp: "1700000000000",
    apiKey: "api-key",
    sign: "EXPECTED_SIGNATURE",
  })

  transport.respond({ id: "request-1", code: "0", msg: "success", data: "10000.00" })
  assert.deepEqual(await resultPromise, {
    id: "request-1",
    data: "10000.00",
  })

  await client.disconnect()
})

test("Bitunix WebSocket API client rejects exchange errors without treating them as success", async () => {
  const transport = new FakeTransport()
  const client = new BitunixWebSocketApiClient({
    transport,
    apiKey: "api-key",
    apiSecret: "secret",
    now: () => 1700000000000,
    nonceFactory: () => "nonce",
    idFactory: () => "request-2",
  })

  await client.connect()
  const resultPromise = client.request("market.last_price", { symbol: "INVALID" })
  transport.respond({ id: "request-2", code: "1001", msg: "invalid symbol", data: null })

  await assert.rejects(resultPromise, /invalid symbol/i)
  await client.disconnect()
})

test("Bitunix WebSocket API client marks state-changing disconnect outcomes as unknown", async () => {
  const transport = new FakeTransport()
  const client = new BitunixWebSocketApiClient({
    transport,
    apiKey: "api-key",
    apiSecret: "secret",
    now: () => 1700000000000,
    nonceFactory: () => "nonce",
    idFactory: () => "request-3",
  })

  await client.connect()
  const resultPromise = client.request("order.place_order", { symbol: "BTCUSDT" }, { stateChanging: true })
  await client.disconnect()

  await assert.rejects(resultPromise, (error) => error.outcomeUnknown === true)
})
