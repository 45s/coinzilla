import test from "node:test"
import assert from "node:assert/strict"
import * as legacyPosition from "./legacy-position.js"

test("creates a legacy position with one fixed average cost and the original remaining quantity", () => {
  assert.equal(typeof legacyPosition.createLegacyPosition, "function", "RS must expose the legacy-position constructor before accounting can begin.")
  assert.equal(typeof legacyPosition.calculateLegacySellQuantity, "function", "RS must expose the per-cycle legacy slice calculation.")
  assert.equal(typeof legacyPosition.recordLegacySale, "function", "RS must expose the successful-cycle legacy quantity transition.")

  const position = legacyPosition.createLegacyPosition({
    invested: "100",
    quantity: "50",
  })

  assert.deepEqual(position, {
    invested: "100",
    originalQuantity: "50",
    averageCost: "2",
    remainingQuantity: "50",
  }, "The initial legacy position must derive its average cost once from the operator's original invested amount and quantity.")
})

test("reduces remaining legacy quantity by the actual legacy amount sold without recalculating average cost", () => {
  const initialPosition = legacyPosition.createLegacyPosition({
    invested: "100",
    quantity: "50",
  })

  const nextPosition = legacyPosition.recordLegacySale({
    position: initialPosition,
    quantitySold: "0.01",
  })

  assert.equal(nextPosition.remainingQuantity, "49.99", "A successful cycle must remove only the 0.01 legacy units actually sold.")
  assert.equal(nextPosition.averageCost, "2", "Selling legacy units must never recalculate the original average acquisition cost.")
  assert.equal(nextPosition.invested, "100", "The original invested amount must remain unchanged after a legacy disposal.")
  assert.equal(initialPosition.remainingQuantity, "50", "Recording a disposal must return a new position without mutating the previous accounting snapshot.")
})

test("caps each cycle legacy slice at the smaller remaining quantity", () => {
  const position = {
    invested: "100",
    originalQuantity: "50",
    averageCost: "2",
    remainingQuantity: "0.005",
  }

  assert.equal(
    legacyPosition.calculateLegacySellQuantity({
      remainingQuantity: position.remainingQuantity,
      sellQuantity: "0.01",
    }),
    "0.005",
    "When less than sellQuantity remains, the cycle may include only the smaller remaining legacy quantity.",
  )
})

test("allows recovery-only cycles after legacy inventory is exhausted", () => {
  assert.equal(
    legacyPosition.calculateLegacySellQuantity({
      remainingQuantity: "0",
      sellQuantity: "0.01",
    }),
    "0",
    "An exhausted legacy position contributes zero additional quantity while recovery-only cycles remain possible.",
  )
})

test("rejects invalid original legacy basis and invalid legacy disposals", () => {
  assert.throws(
    () => legacyPosition.createLegacyPosition({ invested: "0", quantity: "50" }),
    /invested/i,
    "A legacy position must have a positive original quote investment.",
  )
  assert.throws(
    () => legacyPosition.createLegacyPosition({ invested: "100", quantity: "0" }),
    /quantity/i,
    "A legacy position must have a positive original base quantity.",
  )
  assert.throws(
    () => legacyPosition.createLegacyPosition({ invested: "-1", quantity: "50" }),
    /invested/i,
    "Negative historical investment must be rejected.",
  )

  const position = legacyPosition.createLegacyPosition({
    invested: "100",
    quantity: "50",
  })
  assert.throws(
    () => legacyPosition.recordLegacySale({ position, quantitySold: "50.01" }),
    /remaining/i,
    "A legacy disposal must never exceed the remaining authorized legacy quantity.",
  )
  assert.throws(
    () => legacyPosition.recordLegacySale({ position, quantitySold: "0" }),
    /greater than zero/i,
    "A successful legacy disposal must represent a positive quantity.",
  )
})
