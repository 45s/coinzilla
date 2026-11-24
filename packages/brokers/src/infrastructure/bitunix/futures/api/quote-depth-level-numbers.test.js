import assert from "node:assert/strict"
import test from "node:test"

import { quoteDepthLevelNumbers } from "./quote-depth-level-numbers.js"

test("quoteDepthLevelNumbers preserves nested numeric depth levels as exact strings", () => {
  const source = '{"asks":[[0.1001,0.123456789012345678]],"bids":[[0.1,1]]}'
  const parsed = JSON.parse(quoteDepthLevelNumbers({
    text: source,
  }))

  assert.equal(parsed.asks[0][0], "0.1001", "ask price must remain exact")
  assert.equal(parsed.asks[0][1], "0.123456789012345678", "ask quantity must not pass through Number")
  assert.equal(parsed.bids[0][0], "0.1", "bid price must remain exact")
})

test("quoteDepthLevelNumbers leaves already-string depth values and unrelated numbers unchanged", () => {
  const source = '{"asks":[["0.1","2"]],"bids":[["0.09","3"]],"timestamp":1700000000000}'
  const parsed = JSON.parse(quoteDepthLevelNumbers({
    text: source,
  }))

  assert.equal(parsed.asks[0][0], "0.1", "already-string prices must remain unchanged")
  assert.equal(parsed.bids[0][1], "3", "already-string quantities must remain unchanged")
  assert.equal(parsed.timestamp, 1_700_000_000_000, "unrelated timestamps must retain their numeric type")
})
