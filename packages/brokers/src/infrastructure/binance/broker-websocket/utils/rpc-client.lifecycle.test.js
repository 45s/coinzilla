import assert from "node:assert/strict"
import test from "node:test"
import { createClient, connectClient, response } from "../test-helpers/rpc-client-fixtures.js"
import { BinanceWebSocketApiClient } from "./rpc-client.js"

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


test("RPC client detaches every transport listener when connection setup rejects", async () => {
  const removed = []
  const transport = {
    send() {},
    async connect() {
      throw new Error("transport startup failed")
    },
    onMessage() {
      return () => removed.push("message")
    },
    onError() {
      return () => removed.push("error")
    },
    onClose() {
      return () => removed.push("close")
    },
  }
  const client = new BinanceWebSocketApiClient({ transport })

  await assert.rejects(client.connect(), /transport startup failed/)
  assert.equal(client.state, "closed")
  assert.deepEqual(removed.sort(), ["close", "error", "message"])

  // A failed startup is terminal for this client; cleanup remains idempotent.
  await client.disconnect()
  assert.deepEqual(removed.sort(), ["close", "error", "message"])
})


test("RPC client attempts every transport listener removal when cleanup callbacks throw", async () => {
  const removed = []
  const reported = []
  const transport = {
    async connect() {},
    async close() {},
    send() {},
    onMessage() {
      return () => {
        removed.push("message")
        throw new Error("message removal failed")
      }
    },
    onError() {
      return () => {
        removed.push("error")
        throw new Error("error removal failed")
      }
    },
    onClose() {
      return () => {
        removed.push("close")
        throw new Error("close removal failed")
      }
    },
  }
  const client = new BinanceWebSocketApiClient({
    transport,
    requestTimeout: 50,
    now: () => 123456,
    idFactory: () => "request-1",
  })
  client.onError((error) => reported.push(error.message))

  await client.connect()
  await assert.doesNotReject(client.disconnect())

  assert.deepEqual(removed, ["message", "error", "close"])
  assert.deepEqual(reported, [
    "message removal failed",
    "error removal failed",
    "close removal failed",
  ])
  assert.equal(client.state, "closed")

  await client.disconnect()
  assert.deepEqual(removed, ["message", "error", "close"])
})

test("RPC connection failure preserves its original error when listener cleanup also throws", async () => {
  const removed = []
  const reported = []
  const failure = new Error("transport startup failed")
  const transport = {
    async connect() {
      throw failure
    },
    async close() {},
    send() {},
    onMessage() {
      return () => {
        removed.push("message")
        throw new Error("message removal failed")
      }
    },
    onError() {
      return () => {
        removed.push("error")
        throw new Error("error removal failed")
      }
    },
    onClose() {
      return () => {
        removed.push("close")
        throw new Error("close removal failed")
      }
    },
  }
  const client = new BinanceWebSocketApiClient({
    transport,
    requestTimeout: 50,
    now: () => 123456,
    idFactory: () => "request-1",
  })
  client.onError((error) => reported.push(error.message))

  await assert.rejects(client.connect(), (error) => error === failure)

  assert.deepEqual(removed, ["message", "error", "close"])
  assert.deepEqual(reported, [
    "message removal failed",
    "error removal failed",
    "close removal failed",
  ])
  assert.equal(client.state, "closed")
})

test("RPC client decodes ArrayBuffer and typed-array response frames", async () => {
  const context = createClient()
  await connectClient(context)

  const first = context.client.request("ticker.price", {})
  context.sockets[0].receive(new TextEncoder().encode(JSON.stringify({
    id: "request-1", status: 200, result: { frame: "array-buffer" },
  })).buffer)
  assert.deepEqual((await first).data, { frame: "array-buffer" })

  const second = context.client.request("ticker.price", {})
  context.sockets[0].receive(new TextEncoder().encode(JSON.stringify({
    id: "request-2", status: 200, result: { frame: "typed-array" },
  })))
  assert.deepEqual((await second).data, { frame: "typed-array" })
  context.sockets[0].serverClose()
})

test("RPC client rejects invalid and throwing request ID factories without leaking timers", async () => {
  const invalid = createClient({ idFactory: () => Number.NaN })
  await connectClient(invalid)
  await assert.rejects(invalid.client.request("ticker.price", {}), /request ID/)
  assert.equal(invalid.client.pendingCount, 0)
  assert.equal(invalid.clock.pendingCount, 0)

  const failure = new Error("ID source unavailable")
  const throwing = createClient({ idFactory: () => { throw failure } })
  await connectClient(throwing)
  await assert.rejects(throwing.client.request("ticker.price", {}), failure)
  assert.equal(throwing.client.pendingCount, 0)
  assert.equal(throwing.clock.pendingCount, 0)
  invalid.sockets[0].serverClose()
  throwing.sockets[0].serverClose()
})

test("RPC client isolates throwing event and error observers", async () => {
  const context = createClient()
  await connectClient(context)
  const errors = []
  context.client.onError((error) => errors.push(error.message))
  context.client.onError(() => { throw new Error("error observer failed") })
  context.client.onEvent(() => { throw new Error("event observer failed") })

  context.sockets[0].receive(JSON.stringify({ e: "executionReport" }))

  assert.deepEqual(errors, ["event observer failed"])
  assert.equal(context.client.state, "open")
  context.sockets[0].serverClose()
})

test("RPC client reports close-observer exceptions without blocking cleanup", async () => {
  const context = createClient()
  await connectClient(context)
  const errors = []
  context.client.onError((error) => errors.push(error.message))
  context.client.onClose(() => { throw new Error("close observer failed") })

  context.sockets[0].serverClose({ code: 1006, reason: "unexpected close", wasClean: false })

  assert.equal(context.client.state, "closed")
  assert.deepEqual(errors, ["close observer failed"])
  assert.equal(context.client.pendingCount, 0)
  assert.equal(context.clock.pendingCount, 0)
})

test("validates RPC client dependencies and observer callbacks", () => {
  const context = createClient()
  assert.throws(() => new BinanceWebSocketApiClient({ transport: {} }), /compatible native WebSocket transport/)
  assert.throws(() => new BinanceWebSocketApiClient({
    transport: context.transport,
    requestTimeout: 0,
  }), /requestTimeout must be a positive integer/)
  assert.throws(() => new BinanceWebSocketApiClient({
    transport: context.transport,
    now: null,
  }), /now and idFactory must be functions/)
  assert.throws(() => new BinanceWebSocketApiClient({
    transport: context.transport,
    idFactory: null,
  }), /now and idFactory must be functions/)

  assert.throws(() => context.client.onEvent(null), /listener must be a function/)
  assert.throws(() => context.client.onError(null), /listener must be a function/)
  assert.throws(() => context.client.onClose(null), /listener must be a function/)
})

test("rejects disconnected requests and invalid per-request timeouts without pending work", async () => {
  const context = createClient()
  await assert.rejects(
    context.client.request("ticker.price", {}),
    /Cannot send "ticker.price" while Binance WebSocket API is idle/,
  )
  await connectClient(context)
  await assert.rejects(
    context.client.request("ticker.price", {}, { timeout: 0 }),
    /request timeout must be a positive integer/,
  )
  assert.equal(context.client.pendingCount, 0)
  assert.equal(context.clock.pendingCount, 0)
  context.sockets[0].serverClose()
})

test("rejects non-text frames, non-object JSON, and malformed RPC response envelopes", async () => {
  const context = createClient()
  await connectClient(context)

  const unsupportedFrame = context.client.request("ticker.price", {})
  context.sockets[0].receive(42)
  await assert.rejects(unsupportedFrame, /only supports text JSON messages/)

  const scalarPayload = context.client.request("ticker.price", {})
  context.sockets[0].receive("42")
  await assert.rejects(scalarPayload, /message must be a JSON object/)

  const malformedSuccess = context.client.request("ticker.price", {})
  context.sockets[0].receive(JSON.stringify({ id: "request-3", status: 200 }))
  await assert.rejects(malformedSuccess, /Successful Binance response must contain result only/)

  const malformedFailure = context.client.request("ticker.price", {})
  context.sockets[0].receive(JSON.stringify({
    id: "request-4",
    status: 500,
    error: { code: 500 },
  }))
  await assert.rejects(malformedFailure, /Failed Binance response has a malformed error object/)

  assert.equal(context.client.pendingCount, 0)
  assert.equal(context.clock.pendingCount, 0)
  context.sockets[0].serverClose()
})

test("rejects reconnect attempts after the RPC transport has closed", async () => {
  const context = createClient()
  await connectClient(context)
  context.sockets[0].serverClose()

  await assert.rejects(
    context.client.connect(),
    /Cannot connect RPC client in state: closed/,
  )
  assert.equal(context.client.state, "closed")
})

test("rejects an RPC connection closed before the socket opens", async () => {
  const context = createClient()
  const connecting = context.client.connect()
  context.sockets[0].serverClose({ code: 1006, reason: "closed before open", wasClean: false })

  await assert.rejects(connecting, /closed before opening/)
  assert.equal(context.client.state, "closed")
})
