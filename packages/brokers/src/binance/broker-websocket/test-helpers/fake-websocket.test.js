import assert from "node:assert/strict"
import test from "node:test"

import { FakeWebSocket } from "./fake-websocket.js"

test("FakeWebSocket exposes deterministic WHATWG lifecycle events", () => {
  const socket = new FakeWebSocket("wss://example.test/ws")
  const events = []

  for (const type of ["open", "message", "error", "close"]) {
    socket.addEventListener(type, (event) => events.push(event))
  }

  assert.equal(socket.readyState, FakeWebSocket.CONNECTING)
  assert.equal(socket.url, "wss://example.test/ws")

  socket.open()
  assert.equal(socket.readyState, FakeWebSocket.OPEN)

  socket.send('{"method":"ping"}')
  assert.deepEqual(socket.sent, ['{"method":"ping"}'])

  socket.receive('{"id":1,"status":200}')
  assert.equal(events[1].data, '{"id":1,"status":200}')

  const failure = new Error("connection interrupted")
  socket.fail(failure)
  assert.equal(events[2].error, failure)

  socket.close(1001, "going away")
  assert.equal(socket.readyState, FakeWebSocket.CLOSING)
  assert.deepEqual(socket.closeCalls, [{ code: 1001, reason: "going away" }])

  socket.serverClose({ code: 1001, reason: "going away", wasClean: true })
  assert.equal(socket.readyState, FakeWebSocket.CLOSED)
  assert.equal(events[3].code, 1001)
  assert.equal(events[3].reason, "going away")
  assert.equal(events[3].wasClean, true)
})

test("FakeWebSocket delivers duplicate and late messages for RPC regression tests", () => {
  const socket = new FakeWebSocket("wss://example.test/ws")
  const messages = []

  socket.addEventListener("message", (event) => messages.push(event.data))
  socket.open()
  socket.receive('{"id":7,"status":200}')
  socket.receive('{"id":7,"status":200}')
  socket.serverClose()
  socket.receive('{"id":7,"status":200}')

  assert.equal(messages.length, 3)
  assert.equal(messages[0], messages[1])
  assert.equal(messages[1], messages[2])
})

test("FakeWebSocket ignores duplicate open and close transitions", () => {
  const socket = new FakeWebSocket("wss://example.test/ws")
  let openCount = 0
  let closeCount = 0

  socket.addEventListener("open", () => { openCount += 1 })
  socket.addEventListener("close", () => { closeCount += 1 })

  socket.open()
  socket.open()
  socket.serverClose()
  socket.serverClose()

  assert.equal(openCount, 1)
  assert.equal(closeCount, 1)
})
