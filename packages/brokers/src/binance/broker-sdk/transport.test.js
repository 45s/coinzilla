import assert from "node:assert/strict"
import test from "node:test"
import { createHash } from "node:crypto"
import { createServer } from "node:http"

import { NativeWebSocketTransport } from "./transport.js"
import { isSafeUndiciVersion, assertNativeWebSocketRuntime } from "./runtime.js"
import { FakeClock } from "./test-helpers/fake-clock.js"
import { FakeWebSocket } from "./test-helpers/fake-websocket.js"

function createTransport(options = {}) {
  const clock = options.clock ?? new FakeClock()
  const sockets = []
  class Socket extends FakeWebSocket {
    constructor(url) {
      super(url)
      sockets.push(this)
    }
  }

  const transport = new NativeWebSocketTransport({
    url: "wss://example.test/ws",
    WebSocketCtor: Socket,
    setTimeoutFn: clock.setTimeout.bind(clock),
    clearTimeoutFn: clock.clearTimeout.bind(clock),
    connectTimeout: 100,
    closeTimeout: 50,
    ...options.transport,
  })

  return { transport, sockets, clock }
}

test("connect is idempotent while connecting and resolves when the socket opens", async () => {
  const { transport, sockets, clock } = createTransport()
  const first = transport.connect()
  const second = transport.connect()

  assert.equal(first, second)
  assert.equal(sockets.length, 1)
  assert.equal(transport.state, "connecting")

  sockets[0].open()

  assert.equal(await first, transport)
  assert.equal(transport.state, "open")
  assert.equal(clock.pendingCount, 0)
})

test("send requires an open connection and forwards data unchanged", async () => {
  const { transport, sockets } = createTransport()

  assert.throws(() => transport.send("before-open"), /not open/)
  const connected = transport.connect()
  sockets[0].open()
  await connected

  transport.send('{"method":"ping"}')
  assert.deepEqual(sockets[0].sent, ['{"method":"ping"}'])
})

test("message listeners receive message data and can unsubscribe", async () => {
  const { transport, sockets } = createTransport()
  const messages = []
  const unsubscribe = transport.onMessage((message) => messages.push(message))
  const connected = transport.connect()
  sockets[0].open()
  await connected

  sockets[0].receive('{"event":"trade"}')
  unsubscribe()
  sockets[0].receive("ignored")

  assert.deepEqual(messages, ['{"event":"trade"}'])
})

test("connection timeout rejects and starts bounded shutdown", async () => {
  const { transport, sockets, clock } = createTransport()
  const connected = transport.connect()
  const rejection = assert.rejects(connected, /timed out/)

  clock.advanceBy(100)

  await rejection
  assert.equal(transport.state, "closing")
  assert.equal(sockets[0].closeCalls.length, 1)
  assert.equal(clock.pendingCount, 1)

  clock.advanceBy(50)
  assert.equal(transport.state, "closed")
  assert.equal(clock.pendingCount, 0)
})

test("close during connection rejects connect and is idempotent", async () => {
  const { transport, sockets } = createTransport()
  const connected = transport.connect()
  const rejection = assert.rejects(connected, /closed before opening/)

  const firstClose = transport.close()
  const secondClose = transport.disconnect()

  assert.equal(firstClose, secondClose)
  await rejection
  assert.equal(transport.state, "closing")
  assert.equal(sockets[0].closeCalls.length, 1)

  sockets[0].serverClose()
  await Promise.all([firstClose, secondClose])
  assert.equal(transport.state, "closed")
})

test("disconnect waits for close and resolves duplicate close events only once", async () => {
  const { transport, sockets } = createTransport()
  const connected = transport.connect()
  sockets[0].open()
  await connected

  let closeEvents = 0
  transport.onClose(() => { closeEvents += 1 })
  const first = transport.disconnect()
  const second = transport.disconnect()

  assert.equal(first, second)
  assert.equal(sockets[0].closeCalls.length, 1)

  sockets[0].serverClose({ code: 1000, reason: "done" })
  sockets[0].serverClose({ code: 1000, reason: "duplicate" })
  await first

  assert.equal(transport.state, "closed")
  assert.equal(closeEvents, 1)
})

test("close timeout settles disconnect when the peer never closes", async () => {
  const { transport, sockets, clock } = createTransport()
  const connected = transport.connect()
  sockets[0].open()
  await connected

  const closing = transport.close()
  clock.advanceBy(50)
  await closing

  assert.equal(transport.state, "closed")
  assert.equal(clock.pendingCount, 0)
})

test("socket errors during connection reject and close the socket", async () => {
  const { transport, sockets } = createTransport()
  const connected = transport.connect()
  const rejection = assert.rejects(connected, /Fake WebSocket error/)

  sockets[0].fail(new Error("Fake WebSocket error"))
  await rejection

  assert.equal(transport.state, "closing")
  assert.equal(sockets[0].closeCalls.length, 1)
})

test("closed transports cannot be reopened", async () => {
  const { transport, sockets } = createTransport()
  const connected = transport.connect()
  sockets[0].open()
  await connected

  const closing = transport.close()
  sockets[0].serverClose()
  await closing

  await assert.rejects(transport.connect(), /Cannot connect WebSocket/)
})

test("Undici version gate accepts patched releases and rejects affected releases", () => {
  for (const version of ["6.29.1", "6.30.0", "7.30.1", "7.31.0", "8.12.2", "9.0.0"]) {
    assert.equal(isSafeUndiciVersion(version), true, version)
  }
  for (const version of ["5.99.0", "6.29.0", "7.30.0", "8.12.1", "invalid", undefined]) {
    assert.equal(isSafeUndiciVersion(version), false, String(version))
  }
})

test("runtime gate requires the approved Node floor and patched Undici", () => {
  assert.doesNotThrow(() => assertNativeWebSocketRuntime({
    nodeVersion: "22.23.4",
    undiciVersion: "6.29.1",
  }))
  assert.doesNotThrow(() => assertNativeWebSocketRuntime({
    nodeVersion: "24.1.0",
    undiciVersion: "7.30.1",
  }))
  assert.throws(() => assertNativeWebSocketRuntime({
    nodeVersion: "22.23.3",
    undiciVersion: "6.29.1",
  }), /Node.js >=22.23.4/)
  assert.throws(() => assertNativeWebSocketRuntime({
    nodeVersion: "22.23.4",
    undiciVersion: "6.29.0",
  }), /patched Undici/)
})


test("the supported Node WebSocket client automatically answers server ping frames", {
  skip: typeof globalThis.WebSocket !== "function",
}, async () => {
  const payload = Buffer.from("binance-ping")
  let resolvePong
  let rejectPong
  const pongReceived = new Promise((resolve, reject) => {
    resolvePong = resolve
    rejectPong = reject
  })
  const server = createServer()

  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"]
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64")

    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"))

    socket.write(Buffer.concat([
      Buffer.from([0x89, payload.length]),
      payload,
    ]))

    let received = Buffer.alloc(0)
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk])

      while (received.length >= 2) {
        const first = received[0]
        const second = received[1]
        const opcode = first & 0x0f
        const masked = (second & 0x80) !== 0
        let length = second & 0x7f
        let offset = 2

        if (length === 126) {
          if (received.length < 4) return
          length = received.readUInt16BE(2)
          offset = 4
        } else if (length === 127) {
          if (received.length < 10) return
          const largeLength = received.readBigUInt64BE(2)
          if (largeLength > BigInt(Number.MAX_SAFE_INTEGER)) {
            rejectPong(new Error("Unexpected oversized WebSocket frame"))
            return
          }
          length = Number(largeLength)
          offset = 10
        }

        const maskLength = masked ? 4 : 0
        if (received.length < offset + maskLength + length) return

        let framePayload = received.subarray(offset + maskLength, offset + maskLength + length)
        if (masked) {
          const mask = received.subarray(offset, offset + 4)
          framePayload = Buffer.from(framePayload)
          for (let index = 0; index < framePayload.length; index += 1) {
            framePayload[index] ^= mask[index % 4]
          }
        }

        received = received.subarray(offset + maskLength + length)
        if (opcode === 0x0a) resolvePong(framePayload)
      }
    })
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  const transport = new NativeWebSocketTransport({
    url: `ws://127.0.0.1:${address.port}/ws`,
    connectTimeout: 2_000,
    closeTimeout: 1_000,
  })

  try {
    await transport.connect()
    const pong = await Promise.race([
      pongReceived,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Server did not receive the WebSocket pong")), 1_000)
      }),
    ])
    assert.deepEqual(pong, payload)
  } finally {
    await transport.close()
    await new Promise((resolve) => server.close(resolve))
  }
})


test("WebSocket constructor failures reject connect without leaking timers", async () => {
  class BrokenSocket {
    constructor() {
      throw new Error("socket construction failed")
    }
  }

  const clock = new FakeClock()
  const transport = new NativeWebSocketTransport({
    url: "wss://example.test/ws",
    WebSocketCtor: BrokenSocket,
    setTimeoutFn: clock.setTimeout.bind(clock),
    clearTimeoutFn: clock.clearTimeout.bind(clock),
  })

  await assert.rejects(transport.connect(), /socket construction failed/)
  assert.equal(transport.state, "closed")
  assert.equal(clock.pendingCount, 0)
})

test("errors after opening are surfaced without silently replaying or reconnecting", async () => {
  const { transport, sockets } = createTransport()
  const errors = []
  transport.onError((error) => errors.push(error.message))
  const connected = transport.connect()
  sockets[0].open()
  await connected

  sockets[0].fail(new Error("socket interrupted"))
  sockets[0].fail(new Error("duplicate socket error"))

  assert.deepEqual(errors, ["socket interrupted", "duplicate socket error"])
  assert.equal(transport.state, "open")
  assert.equal(sockets.length, 1)
})

test("socket close before opening rejects the connection and cleans listeners", async () => {
  const { transport, sockets, clock } = createTransport()
  const connected = transport.connect()
  const rejection = assert.rejects(connected, /closed before opening/)

  sockets[0].serverClose({ code: 1006, reason: "handshake failed", wasClean: false })
  await rejection

  assert.equal(transport.state, "closed")
  assert.equal(clock.pendingCount, 0)
  assert.equal(await transport.close(), undefined)
})
