import assert from "node:assert/strict"
import test from "node:test"

import { BinanceWebSocketApiClient } from "./rpc-client.js"
import { NativeWebSocketTransport } from "./transport.js"
import { FakeClock } from "../test-helpers/fake-clock.js"
import { FakeWebSocket } from "../test-helpers/fake-websocket.js"

function createClient(options = {}) {
  const clock = new FakeClock()
  const sockets = []
  class Socket extends FakeWebSocket {
    constructor(url) {
      super(url)
      sockets.push(this)
    }
  }

  const transport = new NativeWebSocketTransport({
    url: "wss://testnet.binance.vision/ws-api/v3",
    WebSocketCtor: Socket,
    connectTimeout: 100,
    closeTimeout: 100,
    setTimeoutFn: clock.setTimeout.bind(clock),
    clearTimeoutFn: clock.clearTimeout.bind(clock),
  })
  let nextId = 1
  const client = new BinanceWebSocketApiClient({
    transport,
    requestTimeout: 50,
    now: () => 123456,
    idFactory: () => `request-${nextId++}`,
    setTimeoutFn: clock.setTimeout.bind(clock),
    clearTimeoutFn: clock.clearTimeout.bind(clock),
    ...options,
  })

  return { client, transport, sockets, clock }
}

async function connectClient(context) {
  const connecting = context.client.connect()
  context.sockets[0].open()
  await connecting
}

function response(socket, id, result, status = 200) {
  socket.receive(JSON.stringify({ id, status, result }))
}

test("RPC client correlates a successful response with its request ID", async () => {
  const context = createClient()
  await connectClient(context)

  const pending = context.client.request("ticker.price", { symbol: "BTCUSDT" })
  const request = JSON.parse(context.sockets[0].sent[0])
  assert.deepEqual(request, {
    id: "request-1",
    method: "ticker.price",
    params: { symbol: "BTCUSDT" },
  })

  response(context.sockets[0], request.id, { symbol: "BTCUSDT", price: "65000.00" })
  assert.deepEqual(await pending, {
    id: "request-1",
    status: 200,
    data: { symbol: "BTCUSDT", price: "65000.00" },
    rateLimits: undefined,
  })
  assert.equal(context.client.pendingCount, 0)
  assert.equal(context.clock.pendingCount, 0)
})

test("RPC client normalizes Binance API errors and preserves code and status", async () => {
  const context = createClient()
  await connectClient(context)

  const pending = context.client.request("order.place", { symbol: "BTCUSDT" }, {
    stateChanging: true,
  })
  context.sockets[0].receive(JSON.stringify({
    id: "request-1",
    status: 400,
    error: { code: -2010, msg: "Insufficient balance" },
  }))

  await assert.rejects(pending, (error) => {
    assert.equal(error.name, "BinanceRpcError")
    assert.equal(error.code, -2010)
    assert.equal(error.status, 400)
    assert.equal(error.outcomeUnknown, false)
    assert.equal(error.method, "order.place")
    return true
  })
  assert.equal(context.client.pendingCount, 0)
  assert.equal(context.clock.pendingCount, 0)
})

test("RPC client marks 5xx state-changing outcomes as unknown and never replays", async () => {
  const context = createClient()
  await connectClient(context)

  const pending = context.client.request("order.place", { symbol: "BTCUSDT" }, {
    stateChanging: true,
  })
  context.sockets[0].receive(JSON.stringify({
    id: "request-1",
    status: 503,
    error: { code: -1000, msg: "Service unavailable" },
  }))

  await assert.rejects(pending, (error) => {
    assert.equal(error.outcomeUnknown, true)
    return true
  })
  assert.equal(context.sockets[0].sent.length, 1)
})

test("RPC client times out and marks a state-changing outcome as unknown", async () => {
  const context = createClient()
  await connectClient(context)

  const pending = context.client.request("order.place", {}, { stateChanging: true })
  context.clock.advanceBy(50)

  await assert.rejects(pending, (error) => {
    assert.equal(error.name, "BinanceRpcTimeoutError")
    assert.equal(error.outcomeUnknown, true)
    assert.equal(error.requestId, "request-1")
    return true
  })
  assert.equal(context.client.pendingCount, 0)
  assert.equal(context.clock.pendingCount, 0)
})

test("RPC client handles concurrent requests and out-of-order responses", async () => {
  const context = createClient()
  await connectClient(context)

  const first = context.client.request("ticker.price", { symbol: "BTCUSDT" })
  const second = context.client.request("exchangeInfo", { symbol: "ETHUSDT" })
  response(context.sockets[0], "request-2", { symbol: "ETHUSDT" })
  response(context.sockets[0], "request-1", { symbol: "BTCUSDT" })

  assert.equal((await second).data.symbol, "ETHUSDT")
  assert.equal((await first).data.symbol, "BTCUSDT")
  assert.equal(context.client.pendingCount, 0)
  assert.equal(context.clock.pendingCount, 0)
})

test("unknown, duplicate, and late response IDs are ignored", async () => {
  const context = createClient()
  await connectClient(context)

  const pending = context.client.request("ticker.price", { symbol: "BTCUSDT" })
  response(context.sockets[0], "not-a-request", { ignored: true })
  response(context.sockets[0], "request-1", { price: "1" })
  response(context.sockets[0], "request-1", { price: "2" })

  assert.deepEqual((await pending).data, { price: "1" })
  assert.equal(context.client.pendingCount, 0)
})

test("valid messages without request IDs are emitted as push events", async () => {
  const context = createClient()
  await connectClient(context)
  const events = []
  context.client.onEvent((event) => events.push(event))

  context.sockets[0].receive(JSON.stringify({ e: "executionReport", i: 42 }))

  assert.deepEqual(events, [{ e: "executionReport", i: 42 }])
})

test("malformed response envelopes reject the matching pending request", async () => {
  const context = createClient()
  await connectClient(context)

  const pending = context.client.request("ticker.price", { symbol: "BTCUSDT" })
  context.sockets[0].receive(JSON.stringify({ id: "request-1", result: {} }))

  await assert.rejects(pending, /invalid status field/)
  assert.equal(context.client.pendingCount, 0)
  assert.equal(context.clock.pendingCount, 0)
})

test("invalid JSON rejects pending requests and reports a protocol error", async () => {
  const context = createClient()
  await connectClient(context)
  const errors = []
  context.client.onError((error) => errors.push(error))

  const pending = context.client.request("ticker.price", { symbol: "BTCUSDT" })
  context.sockets[0].receive("{not-json")

  await assert.rejects(pending, /Invalid Binance WebSocket API JSON/)
  assert.equal(errors.length, 1)
  assert.equal(context.client.pendingCount, 0)
  assert.equal(context.clock.pendingCount, 0)
})

test("send failures reject and remove the pending request timer", async () => {
  const context = createClient()
  await connectClient(context)
  context.transport.send = () => {
    throw new Error("socket send failed")
  }

  await assert.rejects(
    context.client.request("ticker.price", {}),
    /Failed to send Binance WebSocket API request/,
  )
  assert.equal(context.client.pendingCount, 0)
  assert.equal(context.clock.pendingCount, 0)
})

test("disconnect rejects every pending request and does not replay state changes", async () => {
  const context = createClient()
  await connectClient(context)

  const read = context.client.request("ticker.price", {})
  const mutation = context.client.request("order.cancel", {}, { stateChanging: true })
  context.sockets[0].serverClose({ code: 1006, reason: "network lost", wasClean: false })

  await assert.rejects(read, (error) => {
    assert.equal(error.name, "BinanceRpcConnectionError")
    assert.equal(error.outcomeUnknown, false)
    return true
  })
  await assert.rejects(mutation, (error) => {
    assert.equal(error.name, "BinanceRpcConnectionError")
    assert.equal(error.outcomeUnknown, true)
    return true
  })
  assert.equal(context.client.state, "closed")
  assert.equal(context.client.pendingCount, 0)
  assert.equal(context.clock.pendingCount, 0)
  assert.equal(context.sockets[0].sent.length, 2)
})

test("signed RPC requests include Binance HMAC credentials and timestamp", async () => {
  const context = createClient({
    apiKey: "example-key",
    apiSecret: "example-secret",
  })
  await connectClient(context)

  const pending = context.client.request("account.status", { omitZeroBalances: true }, {
    signed: true,
  })
  const request = JSON.parse(context.sockets[0].sent[0])
  assert.deepEqual(request.params, {
    omitZeroBalances: true,
    apiKey: "example-key",
    timestamp: 123456,
    recvWindow: 5000,
    signature: request.params.signature,
  })
  assert.match(request.params.signature, /^[a-f0-9]{64}$/)
  response(context.sockets[0], "request-1", { balances: [] })
  await pending
})

test("signed requests fail closed without credentials", async () => {
  const context = createClient()
  await connectClient(context)

  await assert.rejects(
    context.client.request("account.status", {}, { signed: true }),
    /API key is required/,
  )
  assert.equal(context.sockets[0].sent.length, 0)
  assert.equal(context.client.pendingCount, 0)
})

test("duplicate in-flight IDs are rejected without replacing the original request", async () => {
  const context = createClient({ idFactory: () => "same-id" })
  await connectClient(context)

  const original = context.client.request("ticker.price", {})
  await assert.rejects(context.client.request("ticker.price", {}), /Duplicate in-flight/)
  response(context.sockets[0], "same-id", { price: "1" })

  assert.deepEqual((await original).data, { price: "1" })
  assert.equal(context.client.pendingCount, 0)
})

test("request validation rejects invalid methods and parameter shapes", async () => {
  const context = createClient()
  await connectClient(context)

  assert.throws(() => context.client.request("", {}), /method/)
  assert.throws(() => context.client.request("ticker.price", []), /params must be an object/)
  assert.equal(context.sockets[0].sent.length, 0)
})

test("RPC client marks HTTP 409 partial mutation responses as uncertain", async () => {
  const context = createClient()
  await connectClient(context)

  const pending = context.client.request("order.cancel", {}, { stateChanging: true })
  context.sockets[0].receive(JSON.stringify({
    id: "request-1",
    status: 409,
    error: { code: -2022, msg: "Cancel-replace partially failed" },
  }))

  await assert.rejects(pending, (error) => {
    assert.equal(error.status, 409)
    assert.equal(error.outcomeUnknown, true)
    return true
  })
})

test("notifies close observers when the transport closes unexpectedly", async () => {
  const context = createClient()
  await connectClient(context)
  const closes = []
  context.client.onClose((event) => closes.push(event))

  context.sockets[0].serverClose({ code: 1006, reason: "network lost", wasClean: false })

  assert.deepEqual(closes, [{
    code: 1006,
    reason: "network lost",
    wasClean: false,
  }])
  assert.equal(context.client.state, "closed")
})
