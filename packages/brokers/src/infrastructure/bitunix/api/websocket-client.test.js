import assert from "node:assert/strict"
import test from "node:test"
import { BitunixSpotWebSocketClient } from "../../../index.js"

class FakeTransport {
  listeners = {
    message: new Set(),
    close: new Set(),
    error: new Set(),
  }
  sent = []
  connected = false
  closed = false

  async connect() {
    this.connected = true
  }

  send(message) {
    this.sent.push(JSON.parse(message))
  }

  onMessage(listener) {
    this.listeners.message.add(listener)
    return () => this.listeners.message.delete(listener)
  }

  onClose(listener) {
    this.listeners.close.add(listener)
    return () => this.listeners.close.delete(listener)
  }

  onError(listener) {
    this.listeners.error.add(listener)
    return () => this.listeners.error.delete(listener)
  }

  async close() {
    this.closed = true
    for (const listener of this.listeners.close) {
      listener({ code: 1000, reason: "closed", wasClean: true })
    }
  }

  receive(payload) {
    for (const listener of this.listeners.message) {
      listener(JSON.stringify(payload))
    }
  }
}

function createClient(options = {}) {
  const transport = new FakeTransport()
  const client = new BitunixSpotWebSocketClient({
    apiKey: "key",
    apiSecret: "secret",
    now: () => 1700000000000,
    nonceFactory: () => "nonce",
    idFactory: () => "request-1",
    transportFactory: () => transport,
    ...options,
  })
  return { client, transport }
}

test("Bitunix Spot WebSocket client sends authenticated public RPC using the official signature", async () => {
  const { client, transport } = createClient()
  await client.connect()

  const pending = client.getLastPrice({ symbol: "BTCUSDT" })
  assert.equal(transport.sent.length, 1, "one RPC request must be sent for one price lookup")
  assert.deepEqual(transport.sent[0], {
    id: "request-1",
    method: "market.last_price",
    params: {
      symbol: "BTCUSDT",
      apiKey: "key",
      timestamp: "1700000000000",
      nonce: "nonce",
      sign: "218d2303780bed9592cd575e0b599b3402208d6fe82193da63ddd6df14b22f02",
    },
  }, "the request must contain the official Bitunix Spot WebSocket authentication fields and signature")

  transport.receive({ id: "request-1", code: "0", msg: "success", data: "100.25" })
  assert.equal(await pending, "100.25", "the matching response data must resolve the price RPC")
  await client.disconnect()
})

test("Bitunix Spot WebSocket client correlates concurrent responses by request ID", async () => {
  let nextId = 0
  const { client, transport } = createClient({ idFactory: () => `request-${++nextId}` })
  await client.connect()

  const first = client.getLastPrice({ symbol: "BTCUSDT" })
  const second = client.getLastPrice({ symbol: "ETHUSDT" })
  transport.receive({ id: "request-2", code: 0, msg: "success", data: "200" })
  transport.receive({ id: "request-1", code: 0, msg: "success", data: "100" })

  assert.deepEqual(await Promise.all([first, second]), ["100", "200"], "out-of-order responses must resolve only their matching requests")
  await client.disconnect()
})

test("Bitunix Spot WebSocket client rejects exchange errors without losing response identity", async () => {
  const { client, transport } = createClient()
  await client.connect()

  const pending = client.getAccount()
  transport.receive({ id: "request-1", code: "1001", msg: "permission denied", data: null })

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, "1001", "exchange error code must remain available to callers")
    assert.equal(error.requestId, "request-1", "exchange error must retain its request identity")
    assert.match(error.message, /permission denied/i, "exchange error message must be preserved")
    return true
  })
  await client.disconnect()
})

test("Bitunix Spot WebSocket client rejects malformed and mismatched responses safely", async () => {
  const { client, transport } = createClient()
  await client.connect()

  const pending = client.getUserInfo()
  transport.receive({ id: "another-request", code: "0", data: { uid: 1 } })
  assert.equal(client.pendingCount, 1, "an unrelated response must not resolve or remove another in-flight request")
  transport.receive({ id: "request-1", code: "0", data: { uid: 7 } })
  assert.deepEqual(await pending, { uid: 7 }, "the matching user.info response must resolve its own request")

  const malformed = client.getAccount()
  transport.receive({ id: "request-1", msg: "missing code" })
  await assert.rejects(malformed, /response.*code/i, "a matching response without a code must fail closed")
  await client.disconnect()
})

test("Bitunix Spot WebSocket client rejects pending reads when the connection closes", async () => {
  const { client, transport } = createClient()
  await client.connect()

  const pending = client.getAccount()
  await transport.close()

  await assert.rejects(pending, /connection.*closed/i, "a closed socket must reject every unresolved RPC")
  assert.equal(client.pendingCount, 0, "connection closure must clear pending RPC state")
  assert.equal(client.state, "closed", "connection closure must make the client terminal")
})

test("Bitunix Spot WebSocket client validates documented RPC arguments before sending", async () => {
  const { client, transport } = createClient()
  await client.connect()

  await assert.rejects(client.getLastPrice({ symbol: "" }), /symbol/i, "empty symbols must be rejected before network I/O")
  await assert.rejects(client.getDepth({ symbol: "BTCUSDT" }), /precision/i, "depth precision is required by the official contract")
  await assert.rejects(client.getKline({ symbol: "BTCUSDT", interval: "invalid" }), /interval/i, "unsupported kline intervals must be rejected")
  assert.equal(transport.sent.length, 0, "invalid RPC arguments must not be sent")
  await client.disconnect()
})
