import assert from "node:assert/strict"
import test from "node:test"
import { normalizeRecoverySellerSellAllocation } from "./normalize-recovery-seller-sell-allocation.js"

test("normalizes exact recovery and legacy SELL quantities", () => {
  const allocation = normalizeRecoverySellerSellAllocation({
    sellAllocation: {
      recoverySellQuantity: "2.5",
      legacySellQuantity: "2.5",
    },
    quantity: "5",
    required: true,
  })

  assert.deepEqual(allocation, {
    recoverySellQuantity: "2.5",
    legacySellQuantity: "2.5",
  })
  assert.equal(Object.isFrozen(allocation), true)
})

test("allows a recovery-only SELL allocation", () => {
  const allocation = normalizeRecoverySellerSellAllocation({
    sellAllocation: {
      recoverySellQuantity: "5",
      legacySellQuantity: "0",
    },
    quantity: "5",
    required: true,
  })

  assert.equal(allocation.legacySellQuantity, "0")
})

test("allows an absent optional SELL allocation", () => {
  assert.equal(normalizeRecoverySellerSellAllocation({
    quantity: "5",
    required: false,
  }), undefined)
})

test("requires the allocation for an RS SELL", () => {
  assert.throws(
    () => normalizeRecoverySellerSellAllocation({
      quantity: "5",
      required: true,
    }),
    /requires recovery and legacy SELL quantities/,
  )
})

test("rejects allocations that do not equal the canonical order quantity", () => {
  assert.throws(
    () => normalizeRecoverySellerSellAllocation({
      sellAllocation: {
        recoverySellQuantity: "2",
        legacySellQuantity: "2",
      },
      quantity: "5",
      required: true,
    }),
    /must equal the canonical order quantity/,
  )
})

test("rejects zero recovery quantity and negative legacy quantity", () => {
  assert.throws(
    () => normalizeRecoverySellerSellAllocation({
      sellAllocation: {
        recoverySellQuantity: "0",
        legacySellQuantity: "5",
      },
      quantity: "5",
      required: true,
    }),
    /recoverySellQuantity must be greater than zero/,
  )
  assert.throws(
    () => normalizeRecoverySellerSellAllocation({
      sellAllocation: {
        recoverySellQuantity: "6",
        legacySellQuantity: "-1",
      },
      quantity: "5",
      required: true,
    }),
    /legacySellQuantity must be non-negative/,
  )
})

test("rejects unsupported allocation fields", () => {
  assert.throws(
    () => normalizeRecoverySellerSellAllocation({
      sellAllocation: {
        recoverySellQuantity: "5",
        legacySellQuantity: "0",
        totalQuantity: "5",
      },
      quantity: "5",
      required: true,
    }),
    /contains unsupported fields/,
  )
})
