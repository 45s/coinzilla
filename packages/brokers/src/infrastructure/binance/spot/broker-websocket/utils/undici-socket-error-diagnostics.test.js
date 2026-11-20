import assert from "node:assert/strict"
import { channel } from "node:diagnostics_channel"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import test from "node:test"

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

function handleAbnormalCloseUpgrade({ request, socket }) {
  const key = request.headers["sec-websocket-key"]
  const accept = createHash("sha1")
    .update(key + WEBSOCKET_GUID)
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
}

function createAbnormalCloseServer() {
  const server = createServer()
  let serverSocket = null
  server.on("upgrade", (request, socket) => {
    serverSocket = socket
    handleAbnormalCloseUpgrade({ request, socket })
  })
  return { server, get serverSocket() { return serverSocket } }
}

function subscribeDiagnosticChannels() {
  const socketErrors = []
  const opened = []
  const closed = []
  const channels = {
    socketError: channel("undici:websocket:socket_error"),
    open: channel("undici:websocket:open"),
    close: channel("undici:websocket:close"),
  }
  const listeners = {
    socketError: (error) => socketErrors.push(error),
    open: (event) => opened.push(event),
    close: (event) => closed.push(event),
  }
  channels.socketError.subscribe(listeners.socketError)
  channels.open.subscribe(listeners.open)
  channels.close.subscribe(listeners.close)
  return { socketErrors, opened, closed, channels, listeners }
}

function unsubscribeDiagnosticChannels({ channels, listeners }) {
  channels.socketError.unsubscribe(listeners.socketError)
  channels.open.unsubscribe(listeners.open)
  channels.close.unsubscribe(listeners.close)
}

function waitForWebSocketOpen(websocket) {
  return new Promise((resolve, reject) => {
    websocket.addEventListener("open", resolve, { once: true })
    websocket.addEventListener("error", (event) => {
      reject(event.error ?? new Error(event.message || "WebSocket failed before opening"))
    }, { once: true })
  })
}

function waitForWebSocketClose(websocket) {
  return new Promise((resolve) => websocket.addEventListener("close", resolve, { once: true }))
}

async function runSocketErrorDiagnosticTest(t) {
  const diagnostics = subscribeDiagnosticChannels()
  const fixture = createAbnormalCloseServer()
  await listen(fixture.server)
  const address = fixture.server.address()
  const websocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
  t.after(async () => {
    unsubscribeDiagnosticChannels(diagnostics)
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
  // A peer reset can produce close code 1006 without a client-side socket error.
  assert.equal(diagnostics.socketErrors.length, 0)
}

test("Undici does not emit a socket_error diagnostic for every abnormal 1006 close", {
  timeout: 5_000,
}, runSocketErrorDiagnosticTest)