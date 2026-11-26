import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
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

  write(message, callback) {
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

test("MongoDB transport correlates concurrent OP_MSG replies by responseTo", async () => {
  const pending = []
  const { transport } = createFakeTransport({
    respond: (socket, request) => {
      pending.push(request)
      if (pending.length === 2) {
        for (const item of pending.reverse()) {
          socket.emit("data", encodeOpMsg({
            requestId: 500 + item.requestId,
            responseTo: item.requestId,
            body: { ok: 1, request: item.body.sequence },
          }))
        }
      }
    },
  })

  await transport.connect()
  const first = transport.command({ body: { sequence: "first" } })
  const second = transport.command({ body: { sequence: "second" } })

  assert.deepEqual(await first, { ok: 1, request: "first" })
  assert.deepEqual(await second, { ok: 1, request: "second" })
  await transport.close()
})

test("MongoDB transport handles fragmented frames without losing bytes", async () => {
  const { transport } = createFakeTransport({
    respond: (socket, request) => {
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
  assert.deepEqual(await transport.command({ body: { ping: 1 } }), { ok: 1 })
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
    () => createMongoTransport({ host: " ", port: 27017 }),
    /host/,
  )
  assert.throws(
    () => createMongoTransport({ host: "localhost", tls: [] }),
    /TLS options/,
  )
  assert.throws(
    () => createMongoTransport({ host: "localhost", socketFactory: {} }),
    /socketFactory/,
  )

  const fake = createFakeTransport()
  await assert.rejects(
    transport.command({ body: { ping: 1 } }),
    /not connected/,
  )
  await transport.connect()
  const { socket } = fake
  await assert.rejects(
    transport.command({ body: { ping: 1 }, timeoutMS: 0 }),
    /positive safe integer/,
  )

  socket.writableLength = 64 * 1024 * 1024
  await assert.rejects(
    transport.command({ body: { ping: 1 } }),
    /write buffer limit/,
  )
  socket.writableLength = 0

  const requests = Array.from({ length: 128 }, () => transport.command({
    body: { ping: 1 },
    timeoutMS: 1_000,
  }))
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
    respond: (socket, request) => {
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
  await transport.connect()
  const { socket } = fake
  socket.write = (_frame, callback) => {
    callback(new Error("write failed"))
    return false
  }

  await assert.rejects(
    transport.command({ body: { insert: "records" }, operation: "create" }),
    (error) => error.outcomeUnknown === true,
  )
  assert.equal(transport.state, "closed")
  assert.equal(transport.pendingRequestCount, 0)
})

test("MongoDB TLS transport waits for secureConnect rather than plain connect", async () => {
  class TlsSocket extends EventEmitter {
    setNoDelay() {}
    write(_frame, callback) {
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
  assert.equal(socketOptions.tls, true)
  assert.equal(transport.state, "connected")
  await transport.close()
})

test("MongoDB transport handles socket end and idempotent close", async () => {
  const fake = createFakeTransport()
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
  const write = createFakeTransport()
  await write.transport.connect()
  await assert.rejects(
    write.transport.command({
      body: { insert: "records" },
      operation: "create",
      timeoutMS: 5,
    }),
    (error) => error.outcomeUnknown === true,
  )
  await write.transport.close()

  const read = createFakeTransport()
  await read.transport.connect()
  await assert.rejects(
    read.transport.command({
      body: { find: "records" },
      operation: "readMany",
      timeoutMS: 5,
    }),
    (error) => error.outcomeUnknown === false,
  )
  await read.transport.close()

  const transactionWrite = createFakeTransport()
  await transactionWrite.transport.connect()
  await assert.rejects(
    transactionWrite.transport.command({
      body: { insert: "records" },
      operation: "create",
      transaction: true,
      timeoutMS: 5,
    }),
    (error) => error.outcomeUnknown === false,
  )
  await transactionWrite.transport.close()
})

test("MongoDB transport rejects timed-out requests and releases their correlation entries", async () => {
  const { transport } = createFakeTransport({ timeoutMS: 10 })
  await transport.connect()

  await assert.rejects(
    transport.command({ body: { ping: 1 }, timeoutMS: 10 }),
    /timed out/,
  )
  assert.equal(transport.pendingRequestCount, 0)
  await transport.close()
})

test("MongoDB transport rejects malformed frames and all pending operations", async () => {
  const fake = createFakeTransport()
  await transport.connect()
  const { socket } = fake
  const pending = transport.command({ body: { ping: 1 } })
  socket.emit("data", Buffer.from([1, 0, 0, 0]))

  await assert.rejects(pending, /frame|connection|closed/i)
  assert.equal(transport.state, "closed")
})

test("MongoDB transport close rejects outstanding commands and destroys the socket", async () => {
  const fake = createFakeTransport()
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
