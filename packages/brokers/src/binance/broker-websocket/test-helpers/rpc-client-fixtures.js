import { BinanceWebSocketApiClient } from "../utils/rpc-client.js"
import { NativeWebSocketTransport } from "../utils/transport.js"
import { FakeClock } from "./fake-clock.js"
import { FakeWebSocket } from "./fake-websocket.js"

export function createClient(options = {}) {
  const clock = new FakeClock()
  const sockets = []
  class Socket extends FakeWebSocket {
    constructor(url) {
      super(url)
      sockets.push(this)
    }
  }

  const transport = new NativeWebSocketTransport({
    url: "wss://testnet.binance.vision/ws-api/v3",
    WebSocketCtor: Socket,
    connectTimeout: 100,
    closeTimeout: 100,
    setTimeoutFn: clock.setTimeout.bind(clock),
    clearTimeoutFn: clock.clearTimeout.bind(clock),
  })
  let nextId = 1
  const client = new BinanceWebSocketApiClient({
    transport,
    requestTimeout: 50,
    now: () => 123456,
    idFactory: () => `request-${nextId++}`,
    setTimeoutFn: clock.setTimeout.bind(clock),
    clearTimeoutFn: clock.clearTimeout.bind(clock),
    ...options,
  })

  return { client, transport, sockets, clock }
}

export async function connectClient(context) {
  const connecting = context.client.connect()
  context.sockets[0].open()
  await connecting
}

export function response(socket, id, result, status = 200) {
  socket.receive(JSON.stringify({ id, status, result }))
}
