import assert from "node:assert/strict"
import test from "node:test"
import { createBitunixWebSocketSignature, serializeBitunixWebSocketParams } from "./create-websocket-signature.js"

test("Bitunix Spot WebSocket signature matches the official double-SHA256 example shape", () => {
  const signature = createBitunixWebSocketSignature({
    nonce: "nonce",
    timestamp: "1700000000000",
    apiKey: "key",
    secretKey: "secret",
    params: {
      symbol: "BTCUSDT",
      apiKey: "key",
      timestamp: "1700000000000",
      nonce: "nonce",
    },
  })

  assert.equal(
    signature,
    "218d2303780bed9592cd575e0b599b3402208d6fe82193da63ddd6df14b22f02",
    "signature must use the Spot WebSocket key/value serialization and two SHA-256 rounds",
  )
})

test("Bitunix Spot WebSocket signature sorts method parameters and excludes authentication fields", () => {
  const serialized = serializeBitunixWebSocketParams({
    params: {
      z: 2,
      apiKey: "secret-key-id",
      timestamp: "1700000000000",
      nonce: "nonce",
      sign: "ignored",
      a: true,
      m: "BTC",
    },
  })

  assert.equal(serialized, "atrue mBTCz2".replaceAll(" ", ""), "parameters must be key-sorted and exclude all four authentication fields")
})

test("Bitunix Spot WebSocket signature rejects malformed input and non-scalar parameters", () => {
  assert.throws(
    () => serializeBitunixWebSocketParams({ params: [] }),
    /params must be an object/i,
    "arrays must not be accepted as signature parameter maps",
  )
  assert.throws(
    () => serializeBitunixWebSocketParams({ params: { symbol: { nested: true } } }),
    /must be a string, finite number, or boolean/i,
    "nested values must not be serialized ambiguously",
  )
  assert.throws(
    () => createBitunixWebSocketSignature({
      nonce: "",
      timestamp: "1",
      apiKey: "key",
      secretKey: "secret",
      params: {},
    }),
    /nonce/i,
    "empty nonces must be rejected",
  )
  assert.throws(
    () => createBitunixWebSocketSignature({
      nonce: "nonce",
      timestamp: "1",
      apiKey: "key",
      secretKey: "",
      params: {},
    }),
    /secretKey/i,
    "empty API secrets must be rejected",
  )
})
