import test from "node:test"
import assert from "node:assert/strict"

import { addDecimal } from "./helpers/decimal.js"
import { allocateFreeInventory } from "./inventory-allocation.js"

test("allocates exactly keepQuantity and leaves excess inventory active", () => {
  assert.deepEqual(
    allocateFreeInventory({ activeQuantity: "0.05", freeQuantity: "0.02", keepQuantity: "0.01" }),
    { allocatedQuantity: "0.01", activeQuantity: "0.04", freeQuantity: "0.03" },
  )
})

test("allocates exactly the remaining inventory when it equals keepQuantity", () => {
  assert.deepEqual(
    allocateFreeInventory({ activeQuantity: "1", freeQuantity: "0", keepQuantity: "1" }),
    { allocatedQuantity: "1", activeQuantity: "0", freeQuantity: "1" },
  )
})

test("zero keepQuantity does not move inventory between buckets", () => {
  assert.deepEqual(
    allocateFreeInventory({ activeQuantity: "0.05", freeQuantity: "0.02", keepQuantity: "0" }),
    { allocatedQuantity: "0", activeQuantity: "0.05", freeQuantity: "0.02" },
  )
})

test("repeated completed cycles allocate keepQuantity once per cycle", () => {
  let activeQuantity = "0.05"
  let freeQuantity = "0"

  for (let cycle = 0; cycle < 3; cycle += 1) {
    const allocation = allocateFreeInventory({ activeQuantity, freeQuantity, keepQuantity: "0.01" })
    activeQuantity = allocation.activeQuantity
    freeQuantity = allocation.freeQuantity
    if (cycle < 2) activeQuantity = addDecimal({ left: activeQuantity, right: "5" })
  }

  assert.equal(freeQuantity, "0.03")
  assert.equal(activeQuantity, "10.02")
})

test("does not mutate its input and returns deterministic results", () => {
  const input = { activeQuantity: "5.04", freeQuantity: "0.02", keepQuantity: "0.01" }
  const original = structuredClone(input)

  assert.deepEqual(allocateFreeInventory(input), allocateFreeInventory(input))
  assert.deepEqual(input, original)
})

test("rejects allocation when active inventory cannot cover keepQuantity", () => {
  assert.throws(
    () => allocateFreeInventory({ activeQuantity: "0.009", freeQuantity: "0", keepQuantity: "0.01" }),
    /Invalid free-inventory allocation/,
  )
})

test("rejects negative and malformed inventory amounts", () => {
  for (const input of [
    { activeQuantity: "-1", freeQuantity: "0", keepQuantity: "0" },
    { activeQuantity: "1", freeQuantity: "-1", keepQuantity: "0" },
    { activeQuantity: "1", freeQuantity: "0", keepQuantity: "-0.1" },
    { activeQuantity: "bad", freeQuantity: "0", keepQuantity: "0" },
  ]) assert.throws(() => allocateFreeInventory(input))
})