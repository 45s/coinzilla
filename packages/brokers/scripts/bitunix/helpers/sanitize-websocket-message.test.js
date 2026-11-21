import assert from "node:assert/strict"
import test from "node:test"
import { createSanitizedInboundPayload, normalizeWebSocketMessageText } from "./sanitize-websocket-message.js"

test("WebSocket message normalization accepts text and byte views only", () => {
  assert.equal(normalizeWebSocketMessageText({ message: "hello" }), "hello", "text messages should remain unchanged")
  assert.equal(normalizeWebSocketMessageText({
    message: new TextEncoder().encode("hello"),
  }), "hello", "byte views should decode as UTF-8")
  assert.throws(() => normalizeWebSocketMessageText({ message: {} }), /non-text WebSocket message/, "non-text messages must be rejected")
})

test("private WebSocket payloads expose shape without account values", () => {
  const payload = createSanitizedInboundPayload({
    response: {
      id: 1,
      code: 0,
      msg: "ok",
      data: [{
        coin: "USDT",
        balance: "999",
      }],
    },
    method: "user.account",
    secrets: [],
    includePublicPayloads: true,
  })
  assert.deepEqual(payload.data.fields, ["balance", "coin"], "private payloads should expose field names only")
  assert.equal(JSON.stringify(payload).includes("999"), false, "private values must not be serialized")
})
