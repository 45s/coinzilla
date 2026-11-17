import assert from "node:assert/strict"
import test from "node:test"
import { BitunixWebSocketTransport } from "./websocket-transport.js"

class FakeWebSocket {
  static instances = []
  static OPEN = 1

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = new Map()
    this.sent = []
    this.autoClose = true
    FakeWebSocket.instances.push(this)
  }

  addEventListener(...args) {
    const [type, listener] = args
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type).add(listener)
  }

  removeEventListener(...args) {
    const [type, listener] = args
    this.listeners.get(type)?.delete(listener)
  }

  emit(...args) {
    const [type, event = {}] = args
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }

  open() {
    this.readyState = 1
    this.emit("open")
  }

  send(message) {
    if (this.readyState !== 1) {
      throw new Error("socket is not open")
    }
    this.sent.push(message)
  }

  close() {
    this.readyState = this.autoClose ? 3 : 2
    if (this.autoClose) {
      this.emit("close", {
        code: 1000,
        reason: "closed",
        wasClean: true,
      })
    }
  }
}

function createTransport(options = {}) {
  FakeWebSocket.instances = []
  const transport = new BitunixWebSocketTransport({
    url: "wss://openapi.bitunix.com:443/ws-api/v1",
    WebSocketCtor: FakeWebSocket,
    ...options,
  })
  return {
    transport,
    get socket() {
      return FakeWebSocket.instances[0]
    },
  }
}

test("Bitunix WebSocket transport connects once, sends text, forwards messages and closes cleanly", async () => {
  const setup = createTransport()
  const { transport } = setup
  const messages = []
  const closes = []
  transport.onMessage((message) => messages.push(message))
  transport.onClose((event) => closes.push(event))

  const connecting = transport.connect()
  const socket = setup.socket
  assert.equal(transport.connect(), connecting, "concurrent connect calls must share the in-flight handshake")
  assert.equal(socket.url, "wss://openapi.bitunix.com:443/ws-api/v1", "transport must use the configured secure endpoint")
  socket.open()
  await connecting

  transport.send('{"id":"1"}')
  socket.emit("message", { data: '{"id":"1","code":"0"}' })
  assert.deepEqual(socket.sent, ['{"id":"1"}'], "transport must send the exact text frame")
  assert.deepEqual(messages, ['{"id":"1","code":"0"}'], "transport must forward received text frame data")

  await transport.close()
  assert.equal(transport.state, "closed", "clean close must move transport into its terminal state")
  assert.equal(closes.length, 1, "the close event must be forwarded exactly once")
  assert.equal(socket.listeners.get("message").size, 0, "closing must remove the native message listener")
})

test("Bitunix WebSocket transport rejects insecure URLs and invalid timeouts", () => {
  assert.throws(
    () => new BitunixWebSocketTransport({
      url: "ws://openapi.bitunix.com",
      WebSocketCtor: FakeWebSocket,
    }),
    /wss/i,
    "Bitunix WebSocket transport must reject insecure endpoints",
  )
  assert.throws(
    () => new BitunixWebSocketTransport({
      url: "wss://openapi.bitunix.com",
      WebSocketCtor: null,
    }),
    /built-in WebSocket/i,
    "transport must fail clearly when no WebSocket implementation exists",
  )
  assert.throws(
    () => new BitunixWebSocketTransport({
      url: "wss://openapi.bitunix.com",
      WebSocketCtor: FakeWebSocket,
      connectTimeout: 0,
    }),
    /connectTimeout/i,
    "connection timeout must be a positive integer",
  )
  assert.throws(
    () => new BitunixWebSocketTransport({
      url: "wss://openapi.bitunix.com",
      WebSocketCtor: FakeWebSocket,
      closeTimeout: 0,
    }),
    /closeTimeout/i,
    "close timeout must be a positive integer",
  )
})

test("Bitunix WebSocket transport reports handshake failures and rejects the connect promise", async () => {
  const setup = createTransport()
  const { transport } = setup
  const errors = []
  transport.onError((error) => errors.push(error))

  const connecting = transport.connect()
  const socket = setup.socket
  socket.emit("error", {
    message: "handshake rejected",
    error: new Error("upstream handshake failure"),
  })
  await assert.rejects(
    connecting,
    /handshake rejected/i,
    "a failed handshake must reject the connection promise with the transport error",
  )
  assert.equal(errors.length, 1, "native WebSocket errors must be forwarded to transport listeners")
  assert.equal(transport.state, "closed", "failed handshakes must leave the transport terminal")
})

test("Bitunix WebSocket transport enforces connection timeout and closes the socket", async () => {
  const setup = createTransport({
    connectTimeout: 1,
  })
  const { transport } = setup

  await assert.rejects(
    transport.connect(),
    /timed out/i,
    "a WebSocket that never opens must reject after the configured connect timeout",
  )
  assert.equal(setup.socket.readyState, 3, "connection timeout must close the underlying socket")
  assert.equal(transport.state, "closed", "connection timeout must finalize transport cleanup")
})

test("Bitunix WebSocket transport resolves close after bounded close timeout", async () => {
  const setup = createTransport({
    closeTimeout: 1,
  })
  const { transport } = setup
  const connecting = transport.connect()
  const socket = setup.socket
  socket.open()
  await connecting
  socket.autoClose = false

  await transport.close()
  assert.equal(transport.state, "closed", "close timeout must still finalize the transport")
})

test("Bitunix WebSocket transport closes safely while idle or connecting", async () => {
  const idle = createTransport()
  await idle.transport.close()
  assert.equal(idle.transport.state, "closed", "closing an idle transport must be safe")

  const connecting = createTransport()
  const connection = connecting.transport.connect()
  const closing = connecting.transport.close()
  await assert.rejects(
    connection,
    /closed before opening/i,
    "closing during handshake must reject the pending connection",
  )
  await closing
  assert.equal(connecting.transport.state, "closed", "closing during handshake must finalize transport state")
})

test("Bitunix WebSocket transport rejects sends unless the native socket is open", async () => {
  const setup = createTransport()
  const { transport } = setup
  assert.throws(
    () => transport.send("payload"),
    /not open/i,
    "transport must not send before connection is established",
  )
  const connecting = transport.connect()
  const socket = setup.socket
  socket.open()
  await connecting
  await transport.close()
  assert.throws(
    () => transport.send("payload"),
    /not open/i,
    "transport must reject sends after its socket is closed",
  )
})
