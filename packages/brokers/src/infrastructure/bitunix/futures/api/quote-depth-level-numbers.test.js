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

test("quoteDepthLevelNumbers preserves JSON number token text and leaves malformed numbers invalid", () => {
  const source = '{"asks":[[-0.25,1.2e+30],[3E-8,0]],"bids":[]}'
  const parsed = JSON.parse(quoteDepthLevelNumbers({ text: source }))

  assert.equal(parsed.asks[0][0], "-0.25")
  assert.equal(parsed.asks[0][1], "1.2e+30")
  assert.equal(parsed.asks[1][0], "3E-8")
  for (const number of ["01", "-01", "1.", ".1", "1e", "1e+", "--1", "1.2.3"]) {
    const malformed = `{"asks":[[${number},2]],"bids":[]}`
    assert.throws(() => JSON.parse(quoteDepthLevelNumbers({ text: malformed })), SyntaxError, number)
  }
})

test("quoteDepthLevelNumbers ignores numeric text in strings and escaped quotes", () => {
  const source = String.raw`{"asks":[["price 0.1000 and \"quantity 2\"",0.123456789012345678]],"bids":[[1e-8,2E+4]]}`
  const parsed = JSON.parse(quoteDepthLevelNumbers({ text: source }))

  assert.equal(parsed.asks[0][0], 'price 0.1000 and "quantity 2"')
  assert.equal(parsed.asks[0][1], "0.123456789012345678")
  assert.equal(parsed.bids[0][0], "1e-8")
  assert.equal(parsed.bids[0][1], "2E+4")
})

test("quoteDepthLevelNumbers handles deeply nested arrays and large depth payloads", () => {
  const levels = []
  for (let index = 0; index < 20_000; index += 1) {
    levels.push(`[${index}.000000000000000001,1e-8]`)
  }
  const source = `{"asks":[${levels}],"bids":[[[[-2.5E+3]]]]}`
  const parsed = JSON.parse(quoteDepthLevelNumbers({ text: source }))

  assert.equal(parsed.asks.length, 20_000)
  assert.equal(parsed.asks[19_999][0], "19999.000000000000000001")
  assert.equal(parsed.bids[0][0][0][0], "-2.5E+3")
})

test("quoteDepthLevelNumbers does not rewrite bracket-shaped text or escaped property names", () => {
  const source = String.raw`{"metadata":"escaped \"asks\":[[1,2]]","asks":[["literal [1,2] and \"bids\":[[3,4]]",0.123456789012345678]],"bids":[]}`
  const parsed = JSON.parse(quoteDepthLevelNumbers({ text: source }))

  assert.equal(parsed.metadata, 'escaped "asks":[[1,2]]')
  assert.equal(parsed.asks[0][0], 'literal [1,2] and "bids":[[3,4]]')
  assert.equal(parsed.asks[0][1], "0.123456789012345678")
})

test("quoteDepthLevelNumbers scans former catastrophic-backtracking prefixes in linear passes", () => {
  const malformedTokens = [
    `0.${"000.".repeat(2_000)}x`,
    `0E${"000E".repeat(2_000)}x`,
    `0${" 0".repeat(2_000)}x`,
  ]

  for (const token of malformedTokens) {
    const source = `{"asks":[[${token}]],"bids":[]}`
    assert.throws(() => JSON.parse(quoteDepthLevelNumbers({ text: source })), SyntaxError)
  }
})
