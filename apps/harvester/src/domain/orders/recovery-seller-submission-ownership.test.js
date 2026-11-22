import test from "node:test"
import assert from "node:assert/strict"
import { StrategyId } from "../strategies/strategy-ids.js"
import { validateRecoverySellerSubmissionOwnership } from "./recovery-seller-submission-ownership.js"

const recoverySellerOwnership = Object.freeze({
  strategyId: StrategyId.RECOVERY_SELLER,
  purpose: "RECOVERY_SELL",
  positionId: "position-1",
  cycleId: "cycle-1",
})
const recoverySellerSellOrder = Object.freeze({ side: "SELL" })

test("returns immutable ownership for a matching Recovery Seller submission", () => {
  const ownership = validateRecoverySellerSubmissionOwnership({
    order: recoverySellerSellOrder,
    purpose: "RECOVERY_SELL",
    ownership: recoverySellerOwnership,
  })

  assert.deepEqual(
    ownership,
    {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "position-1",
      cycleId: "cycle-1",
    },
    "A valid Recovery Seller submission must retain its exact strategy, Position, and cycle identity.",
  )
  assert.equal(
    Object.isFrozen(ownership),
    true,
    "Normalized Recovery Seller ownership must be immutable before persistence.",
  )
})

test("rejects ownership metadata from a different strategy", () => {
  assert.throws(
    () => validateRecoverySellerSubmissionOwnership({
      order: recoverySellerSellOrder,
      purpose: "RECOVERY_SELL",
      ownership: {
        ...recoverySellerOwnership,
        strategyId: StrategyId.COIN_GRABBER,
      },
    }),
    /Recovery Seller strategy and purpose/,
    "A submission owned by another strategy must not be persisted as Recovery Seller activity.",
  )
})

test("rejects ownership metadata for a different submission purpose", () => {
  assert.throws(
    () => validateRecoverySellerSubmissionOwnership({
      order: recoverySellerSellOrder,
      purpose: "RECOVERY_SELL",
      ownership: {
        ...recoverySellerOwnership,
        purpose: "RECOVERY_BUY",
      },
    }),
    /Recovery Seller strategy and purpose/,
    "Ownership purpose must match the purpose of the canonical order submission.",
  )
})

test("rejects Recovery Seller ownership metadata for an unowned submission", () => {
  assert.throws(
    () => validateRecoverySellerSubmissionOwnership({
      purpose: null,
      ownership: recoverySellerOwnership,
    }),
    /Unowned order submissions/,
    "An unowned submission must not acquire Recovery Seller ownership metadata.",
  )
})
