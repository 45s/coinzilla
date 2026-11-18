import assert from "node:assert/strict"
import test from "node:test"
import { ReadonlyMap } from "./readonly-map.js"

test("preserves Map reads while rejecting ordinary mutation methods", () => {
  const values = new ReadonlyMap([["BTCUSDT", Object.freeze(["binance-primary"])]])

  assert.equal(values instanceof Map, true)
  assert.deepEqual(values.get("BTCUSDT"), ["binance-primary"])
  assert.throws(() => values.set("ETHUSDT", []), /ReadonlyMap/)
  assert.throws(() => values.delete("BTCUSDT"), /ReadonlyMap/)
  assert.throws(() => values.clear(), /ReadonlyMap/)
})
