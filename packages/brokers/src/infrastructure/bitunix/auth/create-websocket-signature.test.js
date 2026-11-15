import assert from "node:assert/strict"
import test from "node:test"
import { createWebSocketSignature } from "./create-websocket-signature.js"

test("createWebSocketSignature sorts business parameters and excludes authentication fields", () => {
  const signature = createWebSocketSignature({
    nonce: "nonce",
    timestamp: "1700000000000",
    apiKey: "api-key",
    secretKey: "secret",
    params: {
      symbol: "BTCUSDT",
      precision: 5,
      apiKey: "ignored",
      timestamp: "ignored",
      nonce: "ignored",
      sign: "ignored",
    },
  })

  assert.equal(signature, "09b41a6b64af169a9e2793ef56a1047e83d5831a405e32083baa1ea3ac9d148e")
})

test("createWebSocketSignature rejects invalid credentials and parameters", () => {
  assert.throws(() => createWebSocketSignature(), /nonce/i)
  assert.throws(() => createWebSocketSignature({
    nonce: "nonce",
    timestamp: "1700000000000",
    apiKey: "api-key",
    secretKey: "secret",
    params: [],
  }), /params/i)
})
