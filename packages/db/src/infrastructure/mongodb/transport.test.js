import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import net from "node:net"
import test from "node:test"

import { encodeOpMsg, decodeOpMsg } from "./wire-protocol.js"
import { createMongoTransport } from "./transport.js"

class FakeSocket extends EventEmitter {
  writes = []
  destroyed = false

  constructor({ respond }) {
    super()
    this.respond = respond
    queueMicrotask(() => this.emit("connect"))
  }

  write(...argumentsList) {
    const [message, callback] = argumentsList
    this.writes.push(Buffer.from(message))
    callback?.()
    this.respond?.(this, decodeOpMsg(message), this.writes.length)
    return true
  }

  end() {
    this.emit("close")
  }

  destroy() {
    this.destroyed = true
    this.emit("close")
  }
}

function createFakeTransport({ respond, timeoutMS = 100 } = {}) {
  let socket
  const transport = createMongoTransport({
    host: "localhost",
    port: 27017,
    connectTimeoutMS: 100,
    socketTimeoutMS: timeoutMS,
    socketFactory: () => {
      socket = new FakeSocket({ respond })
      return socket
    },
  })
  return {
    transport,
    get socket() {
      return socket
    },
  }
}

function handleLocalMongoConnection({ socket }) {
  let buffer = Buffer.alloc(0)
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    if (buffer.length < 4) {
      return
    }
    const messageLength = buffer.readInt32LE(0)
    if (buffer.length < messageLength) {
      return
    }
    const request = decodeOpMsg(buffer.subarray(0, messageLength))
    buffer = buffer.subarray(messageLength)
    socket.end(encodeOpMsg({
      requestId: 91,
      responseTo: request.requestId,
      body: { ok: 1 },
    }))
  })
}

async function assertTransportOutcome({ operation, body, transaction = false, expectedOutcome, rejectWrite = false }) {
  const fake = createFakeTransport()
  await fake.transport.connect()
  if (rejectWrite) {
    fake.socket.write = () => {
      throw new Error("commit rejected before send")
    }
  }
  await assert.rejects(
    fake.transport.command({
      body,
      operation,
      transaction,
      timeoutMS: 5,
    }),
    (error) => error.outcomeUnknown === expectedOutcome,
  )
  await fake.transport.close()
}

test("MongoDB transport opens a real TCP socket without a custom socket factory", { timeout: 5000 }, async () => {
  let serverSocket
  const server = net.createServer((socket) => {
    serverSocket = socket
    handleLocalMongoConnection({ socket })
  })
  await new Promise((...handlers) => {
    const [resolve, reject] = handlers
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert.equal(typeof address, "object")
  const transport = createMongoTransport({
    host: "127.0.0.1",
    port: address.port,
    connectTimeoutMS: 1000,
    socketTimeoutMS: 1000,
  })

  try {
    await transport.connect()
    assert.deepEqual(
      await transport.command({ body: { ping: 1,
$db: "admin" } }),
      { ok: 1 },
    )
  } finally {
    server.closeAllConnections?.()
    serverSocket?.destroy()
    await transport.close()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("MongoDB transport correlates concurrent OP_MSG replies by responseTo", async () => {
  const pending = []
  const { transport } = createFakeTransport({
    respond: (...argumentsList) => {
      const [socket, request] = argumentsList
      pending.push(request)
      if (pending.length === 2) {
        for (const item of pending.reverse()) {
          socket.emit("data", encodeOpMsg({
            requestId: 500 + item.requestId,
            responseTo: item.requestId,
            body: { ok: 1,
request: item.body.sequence },
          }))
        }
      }
    },
  })

  await transport.connect()
  const first = transport.command({ body: { sequence: "first" } })
  const second = transport.command({ body: { sequence: "second" } })

  assert.deepEqual(await first, { ok: 1,
request: "first" })
  assert.deepEqual(await second, { ok: 1,
request: "second" })
  await transport.close()
})

test("MongoDB transport handles fragmented frames without losing bytes", async () => {
  const { transport } = createFakeTransport({
    respond: (...argumentsList) => {
      const [socket, request] = argumentsList
      const response = encodeOpMsg({
        requestId: 90,
        responseTo: request.requestId,
        body: { ok: 1 },
      })
      socket.emit("data", response.subarray(0, 7))
      socket.emit("data", response.subarray(7))
    },
  })

  await transport.connect()
  assert.deepEqual(await transport.command({
      body: { ping: 1 },
    }), { ok: 1 })
  await transport.close()
})


test("MongoDB transport enforces the connection timeout and destroys stalled sockets", async () => {
  class StalledSocket extends EventEmitter {
    destroyed = false

    setNoDelay() {}

    write() { return true }

    destroy() {
      this.destroyed = true
      this.emit("close")
    }
  }
  const socket = new StalledSocket()
  const transport = createMongoTransport({
    host: "localhost",
    port: 27017,
    connectTimeoutMS: 5,
    socketTimeoutMS: 100,
    socketFactory: () => socket,
  })

  await assert.rejects(
    transport.connect(),
    (error) => error.cause?.message === "MongoDB connection timed out",
  )
  assert.equal(socket.destroyed, true)
  assert.equal(transport.state, "closed")
})

test("MongoDB transport preserves socket errors and rejects every outstanding request", async () => {
  const fake = createFakeTransport()
  const { transport } = fake
  await transport.connect()
  const { socket } = fake
  const first = transport.command({ body: { ping: 1 } })
  const second = transport.command({ body: { ping: 1 } })
  socket.emit("error", new Error("network reset"))

  const results = await Promise.allSettled([first, second])
  assert.equal(results.every((result) => result.status === "rejected"), true)
  assert.equal(transport.pendingRequestCount, 0)
  assert.equal(transport.state, "closed")
})


test("MongoDB transport validates commands, options, pending limits, and socket backpressure", async () => {
  assert.throws(
    () => createMongoTransport({ host: " ",
port: 27017 }),
    /host/,
  )
  assert.throws(
    () => createMongoTransport({ host: "localhost",
tls: [] }),
    /TLS options/,
  )
  assert.throws(
    () => createMongoTransport({ host: "localhost",
socketFactory: {} }),
    /socketFactory/,
  )

  const fake = createFakeTransport()
  const { transport } = fake
  await assert.rejects(
    transport.command({ body: { ping: 1 } }),
    /not connected/,
  )
  await transport.connect()
  const { socket } = fake
  await assert.rejects(
    transport.command({ body: { ping: 1 },
timeoutMS: 0 }),
    /positive safe integer/,
  )

  socket.writableLength = 64 * 1024 * 1024
  await assert.rejects(
    transport.command({ body: { ping: 1 } }),
    /write buffer limit/,
  )
  socket.writableLength = 0

  const requests = Array.from(
    { length: 128 },
    () => transport.command({
      body: { ping: 1 },
      timeoutMS: 1_000,
    }),
  )
  assert.equal(transport.pendingRequestCount, 128)
  await assert.rejects(
    transport.command({ body: { ping: 1 } }),
    /pending request limit/,
  )
  await transport.close()
  await Promise.allSettled(requests)
})

test("MongoDB transport rejects unsupported streaming responses", async () => {
  const { transport } = createFakeTransport({
    respond: (...argumentsList) => {
      const [socket, request] = argumentsList
      socket.emit("data", encodeOpMsg({
        requestId: 90,
        responseTo: request.requestId,
        flags: 2,
        body: { ok: 1 },
      }))
    },
  })
  await transport.connect()

  await assert.rejects(
    transport.command({ body: { ping: 1 } }),
    /exhaust\/streaming/,
  )
  assert.equal(transport.pendingRequestCount, 0)
  await transport.close()
})

test("MongoDB transport fails closed when socket writes fail", async () => {
  const fake = createFakeTransport()
  const { transport } = fake
  await transport.connect()
  const { socket } = fake
  socket.write = (...argumentsList) => {
    const [, callback] = argumentsList
    callback(new Error("write failed"))
    return false
  }

  await assert.rejects(
    transport.command({ body: { insert: "records" },
operation: "create" }),
    (error) => error.outcomeUnknown === true,
  )
  assert.equal(transport.state, "closed")
  assert.equal(transport.pendingRequestCount, 0)
})

test("MongoDB transport does not mark a synchronously rejected write as outcome-unknown", async () => {
  const fake = createFakeTransport()
  const { transport } = fake
  await transport.connect()
  fake.socket.write = () => {
    throw new Error("write rejected before send")
  }

  await assert.rejects(
    transport.command({
      body: { insert: "records" },
      operation: "create",
    }),
    (error) => error.outcomeUnknown === false
      && error.cause?.cause?.message === "write rejected before send",
  )
  assert.equal(transport.state, "closed")
  assert.equal(transport.pendingRequestCount, 0)
})

test("MongoDB TLS transport waits for secureConnect rather than plain connect", async () => {
  class TlsSocket extends EventEmitter {
    setNoDelay() {}
    write(...argumentsList) {
      const [, callback] = argumentsList
      callback?.()
      return true
    }
    destroy() {
      this.emit("close")
    }
  }
  const socket = new TlsSocket()
  let socketOptions
  const transport = createMongoTransport({
    host: "localhost",
    tls: { rejectUnauthorized: true },
    socketFactory: (options) => {
      socketOptions = options
      queueMicrotask(() => socket.emit("secureConnect"))
      return socket
    },
  })

  await transport.connect()
  assert.deepEqual(socketOptions.tls, { rejectUnauthorized: true })
  assert.equal(transport.state, "connected")
  await transport.close()
})

test("MongoDB transport handles socket end and idempotent close", async () => {
  const fake = createFakeTransport()
  const { transport } = fake
  await transport.connect()
  const { socket } = fake
  const pending = transport.command({ body: { ping: 1 } })
  socket.emit("end")

  await assert.rejects(pending, /connection closed before command completed/)
  assert.equal(socket.destroyed, true)
  await transport.close()
  await transport.close()
  assert.equal(transport.state, "closed")
})


test("MongoDB transport marks interrupted non-transactional writes as outcome-unknown only", async () => {
  await assertTransportOutcome({
    operation: "create",
    body: { insert: "records" },
    expectedOutcome: true,
  })
  await assertTransportOutcome({
    operation: "readMany",
    body: { find: "records" },
    expectedOutcome: false,
  })
  await assertTransportOutcome({
    operation: "create",
    body: { insert: "records" },
    transaction: true,
    expectedOutcome: false,
  })
  await assertTransportOutcome({
    operation: "commit",
    body: { commitTransaction: 1 },
    expectedOutcome: true,
  })
  await assertTransportOutcome({
    operation: "commit",
    body: { commitTransaction: 1 },
    expectedOutcome: false,
    rejectWrite: true,
  })
  await assertTransportOutcome({
    operation: "abort",
    body: { abortTransaction: 1 },
    expectedOutcome: true,
  })
})

test("MongoDB transport rejects timed-out requests and releases their correlation entries", async () => {
  const { transport } = createFakeTransport({ timeoutMS: 10 })
  await transport.connect()

  await assert.rejects(
    transport.command({ body: { ping: 1 },
timeoutMS: 10 }),
    /timed out/,
  )
  assert.equal(transport.pendingRequestCount, 0)
  await transport.close()
})

test("MongoDB transport rejects malformed frames and all pending operations", async () => {
  const fake = createFakeTransport()
  const { transport } = fake
  await transport.connect()
  const { socket } = fake
  const pending = transport.command({ body: { ping: 1 } })
  socket.emit("data", Buffer.from([1, 0, 0, 0]))

  await assert.rejects(pending, /frame|connection|closed/i)
  assert.equal(transport.state, "closed")
})

test("MongoDB transport close rejects outstanding commands and destroys the socket", async () => {
  const fake = createFakeTransport()
  const { transport } = fake
  await transport.connect()
  const { socket } = fake
  const pending = transport.command({ body: { ping: 1 } })

  await transport.close()

  await assert.rejects(pending, /closed/)
  assert.equal(socket.destroyed, true)
  assert.equal(transport.state, "closed")
})


test("MongoDB transport close rejects an in-progress connection attempt", async () => {
  const socket = new EventEmitter()
  socket.destroyed = false
  socket.write = () => true
  socket.destroy = function destroy() { this.destroyed = true; this.emit("close") }
  const transport = createMongoTransport({
    host: "localhost",
    port: 27017,
    connectTimeoutMS: 1_000,
    socketTimeoutMS: 100,
    socketFactory: () => socket,
  })
  const connecting = transport.connect()
  const rejected = assert.rejects(connecting, /closed/i)
  await transport.close()
  await rejected
  assert.equal(socket.destroyed, true)
  assert.equal(transport.state, "closed")
})


test("MongoDB transport enforces the queued write-buffer bound before writing", async () => {
  const fake = createFakeTransport()
  const { transport } = fake
  await transport.connect()
  const { socket } = fake
  socket.writableLength = 64 * 1024 * 1024 - 1

  await assert.rejects(
    transport.command({ body: { ping: 1 } }),
    /write buffer limit/i,
  )
  assert.equal(socket.writes.length, 0)
  await transport.close()
})
test("MongoDB transport validates options", async () => {
  const invalidOptions = [
    {
      options: { host: "" },
      expected: /host/,
    },
    {
      options: { host: " localhost" },
      expected: /host/,
    },
    {
      options: {
        host: "localhost",
        port: 0,
      },
      expected: /port/,
    },
    {
      options: {
        host: "localhost",
        connectTimeoutMS: 0,
      },
      expected: /connectTimeoutMS/,
    },
    {
      options: {
        host: "localhost",
        socketTimeoutMS: 0,
      },
      expected: /socketTimeoutMS/,
    },
    {
      options: {
        host: "localhost",
        tls: true,
      },
      expected: /TLS options/,
    },
    {
      options: {
        host: "localhost",
        socketFactory: "invalid",
      },
      expected: /socketFactory/,
    },
  ]
  for (const invalid of invalidOptions) {
    assert.throws(() => createMongoTransport(invalid.options), invalid.expected)
  }
})

test("MongoDB transport validates command arguments", async () => {
  const fake = createFakeTransport()
  await fake.transport.connect()
  await assert.rejects(
    fake.transport.command({
      body: { ping: 1 },
      transaction: "false",
    }),
    /transaction command flag/,
  )
  await assert.rejects(
    fake.transport.command({
      body: { ping: 1 },
      timeoutMS: 0,
    }),
    /command timeout/,
  )
  await assert.rejects(
    fake.transport.command({ body: null }),
    /BSON document/,
  )
  await fake.transport.close()
})

test("MongoDB transport bounds pending requests and socket write buffering", async () => {
  const pendingTransport = createFakeTransport()
  await pendingTransport.transport.connect()
  pendingTransport.socket.write = () => true
  const pending = Array.from({ length: 128 }, () => pendingTransport.transport.command({
    body: { ping: 1 },
    timeoutMS: 30_000,
  }))
  await assert.rejects(
    pendingTransport.transport.command({ body: { ping: 1 } }),
    /pending request limit/,
  )
  await pendingTransport.transport.close()
  await Promise.allSettled(pending)

  const bufferedTransport = createFakeTransport()
  await bufferedTransport.transport.connect()
  bufferedTransport.socket.writableLength = 64 * 1024 * 1024
  await assert.rejects(
    bufferedTransport.transport.command({ body: { ping: 1 } }),
    /write buffer limit/,
  )
  await bufferedTransport.transport.close()
})

test("MongoDB transport handles asynchronous write failures and exhaust responses", async () => {
  const writeFailure = createFakeTransport()
  await writeFailure.transport.connect()
  writeFailure.socket.write = (...argumentsList) => {
    const [, callback] = argumentsList
    callback(new Error("asynchronous write failure"))
    return false
  }
  await assert.rejects(
    writeFailure.transport.command({
      body: { insert: "records" },
      operation: "create",
    }),
    (error) => error.outcomeUnknown === true,
  )
  assert.equal(writeFailure.transport.state, "closed")

  const exhaust = createFakeTransport()
  await exhaust.transport.connect()
  exhaust.socket.respond = (...argumentsList) => {
    const [socket, request] = argumentsList
    socket.emit("data", encodeOpMsg({
      requestId: 99,
      responseTo: request.requestId,
      flags: 2,
      body: { ok: 1 },
    }))
  }
  await assert.rejects(
    exhaust.transport.command({
      body: { insert: "records" },
      operation: "create",
    }),
    /exhaust\/streaming responses are not supported/,
  )
  await exhaust.transport.close()
})

test("MongoDB transport closes idle and connecting sockets and rejects factory failures", async () => {
  const idle = createFakeTransport()
  await idle.transport.close()
  assert.equal(idle.transport.state, "closed")
  await assert.rejects(idle.transport.connect(), /while closed/)

  const connecting = createFakeTransport()
  const connection = connecting.transport.connect()
  await connecting.transport.close()
  await assert.rejects(connection, /closed during connection setup/)

  const factoryFailure = createMongoTransport({
    host: "localhost",
    socketFactory() {
      throw new Error("factory failure")
    },
  })
  await assert.rejects(factoryFailure.connect(), /connection failed/)

  const invalidFactory = createMongoTransport({
    host: "localhost",
    socketFactory() {
      return {}
    },
  })
  await assert.rejects(
    invalidFactory.connect(),
    (error) => error.cause?.message.includes("invalid socket"),
  )
})

test("MongoDB transport accepts coalesced TCP chunks containing multiple valid frames", async () => {
  const requests = []
  const payload = "x".repeat(12 * 1024 * 1024)
  const { transport } = createFakeTransport({
    respond: (...argumentsList) => {
      const [socket, request] = argumentsList
      requests.push(request)
      if (requests.length === 4) {
        const frames = requests.map((item) => encodeOpMsg({
          requestId: 500 + item.requestId,
          responseTo: item.requestId,
          body: {
            ok: 1,
            payload,
          },
        }))
        const chunk = Buffer.concat(frames)
        assert.ok(chunk.length > 48 * 1024 * 1024)
        socket.emit("data", chunk)
      }
    },
  })

  await transport.connect()
  const results = await Promise.all(Array.from({ length: 4 }, () => (
    transport.command({ body: { ping: 1 } })
  )))
  assert.equal(results.length, 4)
  assert.ok(results.every((result) => result.payload.length === payload.length))
  assert.equal(transport.pendingRequestCount, 0)
  await transport.close()
})
