import test from "node:test"
import assert from "node:assert/strict"
import { evaluateRecoveryCompletion } from "./recovery-completion.js"

const baseInput = {
  sellOrderFullyFilled: true,
  spent: "10",
  netSellProceeds: "10.01",
  activeQuantity: "1.04",
  keepQuantity: "1",
  minProfit: "0.01",
}

const validDustDisposition = {
  status: "EXCHANGE_CONSTRAINED_DUST",
  quantity: "0.04",
  reason: "MIN_QUANTITY",
  minimumQuantity: "1",
  evaluatedQuantity: "0",
}

test("completes with exchange-constrained dust retained as a keepQuantity bonus", () => {
  const result = evaluateRecoveryCompletion({
    ...baseInput,
    inventoryDisposition: validDustDisposition,
  })

  assert.deepEqual(result, {
    eligible: true,
    pause: false,
    reason: null,
    freeQuantity: "1.04",
    realizedNetProfit: "0.01",
    dust: validDustDisposition,
  })
})

test("does not treat above-keep inventory as dust without an explicit dust disposition", () => {
  const result = evaluateRecoveryCompletion(baseInput)

  assert.equal(result.eligible, false)
  assert.equal(result.reason, "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH")
  assert.equal(result.freeQuantity, "0")
})

test("rejects dust whose quantity does not exactly explain the above-keep remainder", () => {
  const result = evaluateRecoveryCompletion({
    ...baseInput,
    inventoryDisposition: {
      ...validDustDisposition,
      quantity: "0.03",
    },
  })

  assert.equal(result.eligible, false)
  assert.equal(result.freeQuantity, "0")
})

test("does not classify a price-filter block as exchange-constrained dust", () => {
  const result = evaluateRecoveryCompletion({
    ...baseInput,
    inventoryDisposition: {
      ...validDustDisposition,
      status: "PRICE_FILTER_BLOCKED",
      reason: "MAX_PRICE",
    },
  })

  assert.equal(result.eligible, false)
  assert.equal(result.freeQuantity, "0")
})

test("does not complete when the recovery SELL is not fully filled, even with valid dust", () => {
  const result = evaluateRecoveryCompletion({
    ...baseInput,
    sellOrderFullyFilled: false,
    inventoryDisposition: validDustDisposition,
  })

  assert.equal(result.eligible, false)
  assert.equal(result.reason, "RECOVERY_SELL_NOT_FULLY_FILLED")
  assert.equal(result.freeQuantity, "0")
})

test("does not complete when realized net profit is below the configured minimum, even with valid dust", () => {
  const result = evaluateRecoveryCompletion({
    ...baseInput,
    netSellProceeds: "10.009",
    inventoryDisposition: validDustDisposition,
  })

  assert.equal(result.eligible, false)
  assert.equal(result.reason, "RECOVERY_SELL_FAILED_MIN_PROFIT")
  assert.equal(result.freeQuantity, "0")
})

test("validates exact MIN_NOTIONAL evidence before retaining dust", () => {
  const result = evaluateRecoveryCompletion({ ...baseInput, inventoryDisposition: {
    ...validDustDisposition, reason: "MIN_NOTIONAL", minimumQuantity: "0.01", minimumNotional: "5",
    evaluatedQuantity: "0.04", evaluatedNotional: "0.004",
  } })
  assert.equal(result.eligible, true)
  assert.equal(result.dust.reason, "MIN_NOTIONAL")
  assert.equal(result.dust.quantity, "0.04")
})

test("rejects dust when its claimed MIN_NOTIONAL filter is not limiting", () => {
  const result = evaluateRecoveryCompletion({ ...baseInput, inventoryDisposition: {
    ...validDustDisposition, reason: "MIN_NOTIONAL", minimumQuantity: "0.01", minimumNotional: "5",
    evaluatedQuantity: "0.04", evaluatedNotional: "5",
  } })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, "INVALID_EXCHANGE_CONSTRAINED_DUST_EVIDENCE")
})
