import assert from "node:assert/strict"
import { channel } from "node:diagnostics_channel"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import test from "node:test"

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

test("Undici socket errors have no documented WebSocket identity for safe correlation", {
  timeout: 5_000,
}, async (t) => {
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

  const server = createServer()
  let serverSocket = null
  server.on("upgrade", (request, socket) => {
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

    // Force an established-socket loss without sending a WebSocket close frame.
    setTimeout(() => socket.destroy(), 25)
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  const websocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)

  t.after(async () => {
    socketErrorChannel.unsubscribe(onSocketError)
    openChannel.unsubscribe(onOpen)
    closeChannel.unsubscribe(onClose)
    websocket.close()
    serverSocket?.destroy()
    await new Promise((resolve) => server.close(resolve))
  })

  await new Promise((resolve, reject) => {
    websocket.addEventListener("open", resolve, { once: true })
    websocket.addEventListener("error", (event) => {
      reject(event.error ?? new Error(event.message || "WebSocket failed before opening"))
    }, { once: true })
  })

  const closeEvent = await new Promise((resolve) => {
    websocket.addEventListener("close", resolve, { once: true })
  })

  assert.equal(closeEvent.code, 1006)
  assert.equal(opened.length, 1)
  assert.equal(opened[0].websocket, websocket)
  assert.equal(closed.length, 1)
  assert.equal(closed[0].websocket, websocket)

  assert.equal(socketErrors.length, 1)
  assert.ok(socketErrors[0] instanceof Error)
  assert.equal("websocket" in socketErrors[0], false)
  assert.equal("socket" in socketErrors[0], false)
})
