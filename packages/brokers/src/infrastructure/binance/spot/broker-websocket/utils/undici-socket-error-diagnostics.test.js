import assert from "node:assert/strict"
import { channel } from "node:diagnostics_channel"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import test from "node:test"

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

function createAbnormalCloseServer() {
  const server = createServer()
  let serverSocket = null
  server.on("upgrade", (...args) => {
    const [request, socket] = args
    serverSocket = socket
    const accept = createHash("sha1")
      .update(request.headers["sec-websocket-key"] + WEBSOCKET_GUID)
      .digest("base64")
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"))
    setTimeout(() => socket.destroy(), 25)
  })
  return {
    server,
    get serverSocket() {
      return serverSocket
    },
  }
}

function listen(server) {
  return new Promise((...args) => {
    const [resolve, reject] = args
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve))
}

function subscribeDiagnosticChannels() {
  const socketErrors = []
  const opened = []
  const closed = []
  const socketErrorChannel = channel("undici:websocket:socket_error")
  const openChannel = channel("undici:websocket:open")
  const closeChannel = channel("undici:websocket:close")
  const onSocketError = (error) => socketErrors.push(error)
  const onOpen = (event) => opened.push(event)
  const onClose = (event) => closed.push(event)
  socketErrorChannel.subscribe(onSocketError)
  openChannel.subscribe(onOpen)
  closeChannel.subscribe(onClose)
  return {
    socketErrors,
    opened,
    closed,
    unsubscribe() {
      socketErrorChannel.unsubscribe(onSocketError)
      openChannel.unsubscribe(onOpen)
      closeChannel.unsubscribe(onClose)
    },
  }
}

function waitForWebSocketOpen(websocket) {
  return new Promise((...args) => {
    const [resolve, reject] = args
    websocket.addEventListener("open", resolve, { once: true })
    websocket.addEventListener("error", (event) => {
      reject(event.error ?? new Error(event.message || "WebSocket failed before opening"))
    }, { once: true })
  })
}

function waitForWebSocketClose(websocket) {
  return new Promise((resolve) => {
    websocket.addEventListener("close", resolve, { once: true })
  })
}

async function runSocketErrorDiagnosticTest(t) {
  const diagnostics = subscribeDiagnosticChannels()
  const fixture = createAbnormalCloseServer()
  await listen(fixture.server)
  const address = fixture.server.address()
  const websocket = new globalThis.WebSocket(`ws://127.0.0.1:${address.port}/ws`)
  t.after(async () => {
    diagnostics.unsubscribe()
    websocket.close()
    fixture.serverSocket?.destroy()
    await closeServer(fixture.server)
  })
  await waitForWebSocketOpen(websocket)
  const closeEvent = await waitForWebSocketClose(websocket)
  assert.equal(closeEvent.code, 1006)
  assert.equal(diagnostics.opened.length, 1)
  assert.equal(diagnostics.opened[0].websocket, websocket)
  assert.equal(diagnostics.closed.length, 1)
  assert.equal(diagnostics.closed[0].websocket, websocket)
  assert.equal(diagnostics.socketErrors.length, 0)
}

test("Undici does not emit a socket_error diagnostic for every abnormal 1006 close", {
  timeout: 5_000,
  skip: typeof globalThis.WebSocket !== "function",
}, runSocketErrorDiagnosticTest)
