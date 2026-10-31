import assert from "node:assert/strict"
import test from "node:test"

import { FakeClock } from "./fake-clock.js"

test("FakeClock runs due timers in deadline and registration order", () => {
  const clock = new FakeClock()
  const calls = []

  clock.setTimeout(() => calls.push("later"), 20)
  clock.setTimeout(() => calls.push("first"), 10)
  clock.setTimeout(() => calls.push("second"), 10)

  clock.advanceBy(9)
  assert.deepEqual(calls, [])

  clock.advanceBy(1)
  assert.deepEqual(calls, ["first", "second"])

  clock.advanceBy(10)
  assert.deepEqual(calls, ["first", "second", "later"])
  assert.equal(clock.now, 20)
  assert.equal(clock.pendingCount, 0)
})

test("FakeClock supports cancellation and timers scheduled by callbacks", () => {
  const clock = new FakeClock()
  const calls = []
  const canceled = clock.setTimeout(() => calls.push("canceled"), 5)

  clock.clearTimeout(canceled)
  clock.setTimeout(() => {
    calls.push("parent")
    clock.setTimeout(() => calls.push("child"), 2)
  }, 5)

  clock.advanceBy(7)

  assert.deepEqual(calls, ["parent", "child"])
  assert.equal(clock.pendingCount, 0)
})

test("FakeClock rejects invalid time advances", () => {
  const clock = new FakeClock()

  assert.throws(() => clock.advanceBy(-1), /non-negative duration/)
  assert.throws(() => clock.advanceBy(Number.NaN), /non-negative duration/)
})
