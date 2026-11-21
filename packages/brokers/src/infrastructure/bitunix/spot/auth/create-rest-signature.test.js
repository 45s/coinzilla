import assert from "node:assert/strict"
import test from "node:test"
import { createRestSignature } from "./create-rest-signature.js"

test("createRestSignature signs sorted query parameters and compact JSON body", () => {
  const signature = createRestSignature({
    nonce: "nonce",
    timestamp: "1700000000000",
    apiKey: "api-key",
    secretKey: "secret",
    queryParams: {
      symbol: "BTCUSDT",
      limit: 10,
      category: "spot",
    },
    body: {
      symbol: "BTCUSDT",
      side: "BUY",
    },
  })
  assert.equal(signature, "c5794eae3d75ac177a2bf3774a60b4050984dbb6f8841289e0126056bbb475af")
})

test("createRestSignature treats absent query parameters and body as empty strings", () => {
  const signature = createRestSignature({
    nonce: "nonce",
    timestamp: "1700000000000",
    apiKey: "api-key",
    secretKey: "secret",
  })
  assert.equal(signature, "06018b5b73be8baaa8133f410616ed07f0b98d7da4dd2ac552b1e8f948701353")
})

test("createRestSignature rejects missing credentials and invalid input", () => {
  assert.throws(() => createRestSignature(), /nonce/i)
  assert.throws(
    () => createRestSignature({
      nonce: "",
      timestamp: "1700000000000",
      apiKey: "api-key",
      secretKey: "secret",
    }),
    /nonce/i,
  )
  assert.throws(
    () => createRestSignature({
      nonce: "nonce",
      timestamp: "1700000000000",
      apiKey: "api-key",
      secretKey: "",
    }),
    /secret/i,
  )
})

test("createRestSignature preserves whitespace inside JSON string values", () => {
  const options = {
    nonce: "nonce",
    timestamp: "1700000000000",
    apiKey: "api-key",
    secretKey: "secret",
  }
  assert.equal(
    createRestSignature({ ...options, body: '{ "note": "two words" }' }),
    createRestSignature({ ...options, body: { note: "two words" } }),
  )
})

test("createRestSignature signs the exact serialized JSON body when requested", () => {
  const options = {
    nonce: "nonce",
    timestamp: "1700000000000",
    apiKey: "api-key",
    secretKey: "secret",
  }
  const body = '{"toUid":9223372036854775807,"amount":"1.000"}'
  assert.equal(
    createRestSignature({ ...options, body, bodyIsSerialized: true }),
    "c3ed4f3685c001d3d53b720ff23cc61de0b5fc2ec57279e28cdad4fc031d002a",
  )
  assert.throws(
    () => createRestSignature({
      ...options,
      body: { toUid: "9223372036854775807" },
      bodyIsSerialized: true,
    }),
    /serialized body must be a JSON string/i,
  )
})
