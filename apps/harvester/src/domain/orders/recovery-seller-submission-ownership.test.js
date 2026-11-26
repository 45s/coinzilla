import test from "node:test"
import assert from "node:assert/strict"
import { StrategyId } from "../strategies/strategy-ids.js"
import { validateStrategySubmissionOwnership } from "./recovery-seller-submission-ownership.js"

const recoverySellerOwnership = Object.freeze({
  strategyId: StrategyId.RECOVERY_SELLER,
  purpose: "RECOVERY_SELL",
  positionId: "position-1",
  cycleId: "cycle-1",
})
const recoverySellerSellOrder = Object.freeze({ side: "SELL" })

test("returns immutable ownership for a matching Recovery Seller submission", () => {
  const ownership = validateStrategySubmissionOwnership({
    order: recoverySellerSellOrder,
    purpose: "RECOVERY_SELL",
    ownership: recoverySellerOwnership,
  })

  assert.deepEqual(
    ownership,
    {
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "position-1",
      purpose: "RECOVERY_SELL",
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

test("rejects ownership metadata from a strategy outside the supported CG and RS strategies", () => {
  assert.throws(
    () => validateStrategySubmissionOwnership({
      order: recoverySellerSellOrder,
      purpose: "RECOVERY_SELL",
      ownership: {
        ...recoverySellerOwnership,
        strategyId: "UNREGISTERED_STRATEGY",
      },
    }),
    /strategy and purpose/,
    "A submission owned by an unsupported strategy must not be persisted as CG or RS activity.",
  )
})

test("rejects ownership metadata for a different submission purpose", () => {
  assert.throws(
    () => validateStrategySubmissionOwnership({
      order: recoverySellerSellOrder,
      purpose: "RECOVERY_SELL",
      ownership: {
        ...recoverySellerOwnership,
        purpose: "RECOVERY_BUY",
      },
    }),
    /strategy and purpose/,
    "Ownership purpose must match the purpose of the canonical order submission.",
  )
})

test("rejects Recovery Seller ownership metadata for an unowned submission", () => {
  assert.throws(
    () => validateStrategySubmissionOwnership({
      purpose: null,
      ownership: recoverySellerOwnership,
    }),
    /Unowned order submissions/,
    "An unowned submission must not acquire Recovery Seller ownership metadata.",
  )
})


const conservativeOwnership = Object.freeze({
  strategyId: StrategyId.COIN_GRABBER,
  purpose: "RECOVERY_SELL",
  positionId: "position:cg:dogeusdt",
})

test("accepts a Conservative recovery SELL with exact CG Position ownership and no RS cycle identity", () => {
  const ownership = validateStrategySubmissionOwnership({
    order: recoverySellerSellOrder,
    purpose: "RECOVERY_SELL",
    ownership: conservativeOwnership,
  })

  assert.deepEqual(
    ownership,
    {
      strategyId: StrategyId.COIN_GRABBER,
      positionId: "position:cg:dogeusdt",
      purpose: "RECOVERY_SELL",
    },
    "A valid Conservative recovery SELL must preserve CG strategy and Position identity without being relabeled as RS.",
  )
  assert.equal(Object.isFrozen(ownership), true, "Normalized CG ownership must be immutable before durable persistence.")
})

test("rejects a recovery SELL when strategy ownership is missing", () => {
  assert.throws(
    () => validateStrategySubmissionOwnership({
      order: recoverySellerSellOrder,
      purpose: "RECOVERY_SELL",
    }),
    /explicit strategy.*Position/i,
    "A recovery SELL without explicit originating strategy and Position ownership must fail closed.",
  )
})

test("rejects Conservative ownership when it carries an RS-only cycle identity", () => {
  assert.throws(
    () => validateStrategySubmissionOwnership({
      order: recoverySellerSellOrder,
      purpose: "RECOVERY_SELL",
      ownership: {
        ...conservativeOwnership,
        cycleId: "rs-cycle-1",
      },
    }),
    /cycle|ownership/i,
    "A CG Position must not acquire an RS cycle identity through shared submission infrastructure.",
  )
})


test("rejects a CG owner using the Recovery Seller BUY purpose", () => {
  assert.throws(
    () => validateStrategySubmissionOwnership({
      order: {
        ...recoverySellerSellOrder,
        side: "BUY",
      },
      purpose: "RECOVERY_BUY",
      ownership: {
        ...conservativeOwnership,
        purpose: "RECOVERY_BUY",
      },
    }),
    /supported strategy and purpose/,
    "A valid CG Position must not be accepted as a Recovery Seller BUY.",
  )
})

test("rejects an RS owner using a Conservative-only purpose", () => {
  assert.throws(
    () => validateStrategySubmissionOwnership({
      order: {
        ...recoverySellerSellOrder,
        side: "BUY",
      },
      purpose: "CONSERVATIVE_BUY",
      ownership: {
        ...recoverySellerOwnership,
        purpose: "CONSERVATIVE_BUY",
      },
    }),
    /supported strategy and purpose/,
    "A valid RS cycle must not be accepted as a Conservative BUY.",
  )
})


test("rejects optional order IDs that conflict with the canonical order", () => {
  const order = {
    side: "SELL",
    clientOrderId: "canonical-client-id",
    brokerOrderId: "canonical-broker-id",
  }

  assert.throws(
    () => validateStrategySubmissionOwnership({
      order,
      purpose: "RECOVERY_SELL",
      ownership: {
        ...recoverySellerOwnership,
        clientOrderId: "different-client-id",
      },
    }),
    /clientOrderId must match/,
    "Ownership must not attach a different client order ID to the canonical order.",
  )
  assert.throws(
    () => validateStrategySubmissionOwnership({
      order,
      purpose: "RECOVERY_SELL",
      ownership: {
        ...recoverySellerOwnership,
        brokerOrderId: "different-broker-id",
      },
    }),
    /brokerOrderId must match/,
    "Ownership must not attach a different broker order ID to the canonical order.",
  )
})
