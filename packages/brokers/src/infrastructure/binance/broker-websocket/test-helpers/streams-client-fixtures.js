import assert from "node:assert/strict"
import { FakeClock } from "./fake-clock.js"
import { BinanceStreamsClient } from "../utils/streams-client.js"

export class FakeTransport {
  constructor({ url }) {
    this.url = url
    this.sent = []
    this.state = "idle"
    this.messageListener = null
    this.errorListener = null
    this.closeListener = null
    this.closeCalls = []
  }

  onMessage(listener) {
    this.messageListener = listener
    return () => { this.messageListener = null }
  }

  onError(listener) {
    this.errorListener = listener
    return () => { this.errorListener = null }
  }

  onClose(listener) {
    this.closeListener = listener
    return () => { this.closeListener = null }
  }

  async connect() {
    this.state = "open"
    return this
  }

  send(payload) {
    if (this.state !== "open") throw new Error("fake transport is closed")
    this.sent.push(JSON.parse(payload))
  }

  async close(code = 1000, reason = "") {
    this.closeCalls.push({ code, reason })
    this.serverClose({ code, reason })
  }

  receive(message) {
    this.messageListener?.(message)
  }

  serverClose({ code = 1006, reason = "network lost" } = {}) {
    if (this.state === "closed") return
    this.state = "closed"
    this.closeListener?.({ code, reason, wasClean: false })
  }

  fail(error) {
    this.errorListener?.(error)
  }
}

export function createClient(options = {}) {
  const clock = new FakeClock()
  const transports = []
  const errors = []
  const client = new BinanceStreamsClient({
    transportFactory: (transportOptions) => {
      const transport = new FakeTransport(transportOptions)
      transports.push(transport)
      return transport
    },
    setTimeoutFn: clock.setTimeout.bind(clock),
    clearTimeoutFn: clock.clearTimeout.bind(clock),
    nowFn: () => clock.now,
    ackTimeout: 1_000,
    reconnectDelay: 10,
    maxReconnectDelay: 40,
    rotationDelay: 10_000,
    onError: (error) => errors.push(error.message),
    ...options,
  })
  return { client, clock, transports, errors }
}

export async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

export function acknowledge(transport, index = 0, response = { result: null }) {
  const request = transport.sent[index]
  assert.ok(request, "expected a sent control request")
  transport.receive({ id: request.id, ...response })
}
