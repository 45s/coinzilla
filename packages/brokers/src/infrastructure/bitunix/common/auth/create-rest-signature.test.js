import assert from "node:assert/strict"
import test from "node:test"

import { createRestSignature } from "./create-rest-signature.js"

test("shared Bitunix REST signing preserves the documented double-SHA256 contract", () => {
  const signature = createRestSignature({
    nonce: "nonce",
    timestamp: "1700000000000",
    apiKey: "api-key",
    secretKey: "secret",
    queryParams: {
      symbol: "BTCUSDT",
      limit: 10,
      category: "futures",
    },
    body: {
      symbol: "BTCUSDT",
      side: "BUY",
    },
  })

  assert.equal(signature, "2e878fd5589985b8b09737935e1188276b6c910461d719e645aac480419d4fba")
})
