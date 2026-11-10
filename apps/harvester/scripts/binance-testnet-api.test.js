import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"

import { createPublicQuery, createSignedQuery } from "./binance-testnet-api.js"

test("createSignedQuery signs the exact timestamped query with HMAC-SHA256", () => {
  const { query } = createSignedQuery({
    params: { symbol: "ZROUSDT" },
    timestamp: 123456789,
    apiSecret: "test-secret",
  })

  const parsed = new URLSearchParams(query)
  const signature = parsed.get("signature")
  parsed.delete("signature")

  const expected = createHmac("sha256", "test-secret")
    .update(parsed.toString())
    .digest("hex")

  assert.equal(parsed.get("symbol"), "ZROUSDT")
  assert.equal(parsed.get("timestamp"), "123456789")
  assert.equal(parsed.get("recvWindow"), "5000")
  assert.equal(signature, expected)
})

test("createSignedQuery rejects a missing secret", () => {
  assert.throws(
    () => createSignedQuery({ timestamp: 123, apiSecret: "" }),
    /API secret is required/,
  )
})

test("createPublicQuery includes only endpoint parameters without signing metadata", () => {
  const { query } = createPublicQuery({
    params: { symbol: "ZROUSDT" },
  })

  const parsed = new URLSearchParams(query)

  assert.deepEqual([...parsed.entries()], [["symbol", "ZROUSDT"]])
  assert.equal(parsed.has("timestamp"), false)
  assert.equal(parsed.has("recvWindow"), false)
  assert.equal(parsed.has("signature"), false)
})
