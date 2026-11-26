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
  const { transport, socket } = createFakeTransport()
  await transport.connect()
  const first = transport.command({ body: { ping: 1 } })
  const second = transport.command({ body: { ping: 1 } })
  socket.emit("error", new Error("network reset"))

  const results = await Promise.allSettled([first, second])
  assert.equal(results.every((result) => result.status === "rejected"), true)
  assert.equal(transport.pendingRequestCount, 0)
  assert.equal(transport.state, "closed")
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
  const { transport, socket } = createFakeTransport()
  await transport.connect()
  const pending = transport.command({ body: { ping: 1 } })
  socket.emit("data", Buffer.from([1, 0, 0, 0]))

  await assert.rejects(pending, /frame|connection|closed/i)
  assert.equal(transport.state, "closed")
})

test("MongoDB transport close rejects outstanding commands and destroys the socket", async () => {
  const { transport, socket } = createFakeTransport()
  await transport.connect()
  const pending = transport.command({ body: { ping: 1 } })

  await transport.close()

  await assert.rejects(pending, /closed/)
  assert.equal(socket.destroyed, true)
  assert.equal(transport.state, "closed")
})


test("MongoDB transport close rejects an in-progress connection attempt", async () => {
  const socket = new EventEmitter()
  socket.destroyed = false
  socket.destroy = function destroy() { this.destroyed = true; this.emit("close") }
  const transport = createMongoTransport({
    host: "localhost",
    port: 27017,
    connectTimeoutMS: 1_000,
    socketTimeoutMS: 100,
    socketFactory: () => socket,
  })
  const connecting = transport.connect()
  await transport.close()
  await assert.rejects(connecting, /closed/i)
  assert.equal(socket.destroyed, true)
  assert.equal(transport.state, "closed")
})
