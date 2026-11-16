import assert from "node:assert/strict"
import test from "node:test"
import { channel } from "node:diagnostics_channel"
import { NativeWebSocketTransport } from "./transport.js"
import { FakeClock } from "../test-helpers/fake-clock.js"
import { FakeWebSocket } from "../test-helpers/fake-websocket.js"

function createTransport() {
  const clock = new FakeClock()
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
  })
  return { transport,
    sockets }
}

test("forwards Undici ping frames only for its own WebSocket", async () => {
  const { transport, sockets } = createTransport()
  const receivedPings = []
  transport.onPing((payload) => receivedPings.push(payload))
  const connected = transport.connect()
  sockets[0].open()
  await connected

  const payload = Buffer.from("binance-heartbeat")
  channel("undici:websocket:ping").publish({
    websocket: sockets[0],
    payload,
  })
  channel("undici:websocket:ping").publish({
    websocket: {},
    payload: Buffer.from("other"),
  })

  assert.deepEqual(
    receivedPings,
    [payload],
    "the transport must forward heartbeat frames only from its owned WebSocket instance",
  )
  const closing = transport.disconnect()
  sockets[0].serverClose()
  await closing
})

test("stops forwarding Undici ping frames after the WebSocket closes", async () => {
  const { transport, sockets } = createTransport()
  const receivedPings = []
  transport.onPing((payload) => receivedPings.push(payload))
  const connected = transport.connect()
  sockets[0].open()
  await connected

  const closing = transport.disconnect()
  sockets[0].serverClose()
  await closing
  channel("undici:websocket:ping").publish({
    websocket: sockets[0],
    payload: Buffer.from("late-heartbeat"),
  })

  assert.deepEqual(
    receivedPings,
    [],
    "closed transports must release their diagnostic subscription and ignore later heartbeat notifications",
  )
})
