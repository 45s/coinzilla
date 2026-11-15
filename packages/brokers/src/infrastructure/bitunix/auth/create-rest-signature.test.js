import assert from "node:assert/strict"
import test from "node:test"
import { createRestSignature } from "./create-rest-signature.js"

test("createRestSignature signs sorted query parameters and compact JSON body", () => {
  const signature = createRestSignature({
    nonce: "nonce",
    timestamp: "1700000000000",
    apiKey: "api-key",
    secretKey: "secret",
    queryParams: { symbol: "BTCUSDT", limit: 10, category: "spot" },
    body: { symbol: "BTCUSDT", side: "BUY" },
  })

  assert.equal(signature, "EXPECTED_SIGNATURE")
})

test("createRestSignature treats absent query parameters and body as empty strings", () => {
  const signature = createRestSignature({
    nonce: "nonce",
    timestamp: "1700000000000",
    apiKey: "api-key",
    secretKey: "secret",
  })

  assert.equal(signature, "EXPECTED_EMPTY_SIGNATURE")
})

test("createRestSignature rejects missing credentials and invalid input", () => {
  assert.throws(() => createRestSignature(), /options/i)
  assert.throws(() => createRestSignature({
    nonce: "",
    timestamp: "1700000000000",
    apiKey: "api-key",
    secretKey: "secret",
  }), /nonce/i)
  assert.throws(() => createRestSignature({
    nonce: "nonce",
    timestamp: "1700000000000",
    apiKey: "api-key",
    secretKey: "",
  }), /secret/i)
})
