import nodeTest from "node:test"
import assert from "node:assert/strict"
import { isMarketDataFresh } from "./is-market-data-fresh.js"

const test = (name, ...args) => nodeTest("[is-market-data-fresh.test.js] " + name, ...args)

test("accepts timestamps at both inclusive freshness boundaries", () => {
  assert.equal(isMarketDataFresh({ timestamp: 5_000, now: 10_000 }), true, "A timestamp exactly at the maximum age must remain fresh.")
  assert.equal(isMarketDataFresh({ timestamp: 11_000, now: 10_000 }), true, "A timestamp exactly at the maximum future skew must remain fresh.")
})

test("rejects timestamps outside the freshness window", () => {
  assert.equal(isMarketDataFresh({ timestamp: 4_999, now: 10_000 }), false, "A timestamp older than the maximum age must be stale.")
  assert.equal(isMarketDataFresh({ timestamp: 11_001, now: 10_000 }), false, "A timestamp beyond the future-skew allowance must be rejected.")
})

test("rejects invalid timestamps and non-integer age calculations", () => {
  assert.equal(isMarketDataFresh({ timestamp: undefined, now: 10_000 }), false, "A missing timestamp must not be treated as fresh.")
  assert.equal(isMarketDataFresh({ timestamp: 9_999.5, now: 10_000 }), false, "A fractional timestamp must produce a non-integer age and be rejected.")
  assert.equal(isMarketDataFresh({ timestamp: 10_000, now: Number.NaN }), false, "An invalid current time must not produce a fresh result.")
})

test("accepts explicit boundary overrides without consulting a global clock", () => {
  assert.equal(
    isMarketDataFresh({ timestamp: 9_500, now: 10_000, maxAgeMs: 500, maxFutureSkewMs: 0 }),
    true,
    "Callers must be able to supply an explicit deterministic freshness policy.",
  )
})
