import test from "node:test"
import assert from "node:assert/strict"
import { evaluateRecoveryCompletion } from "./recovery-completion.js"

const baseInput = {
  sellOrderFullyFilled: true,
  spent: "10",
  netSellProceeds: "10.01",
  activeQuantity: "1",
  keepQuantity: "1",
  minProfit: "0.01",
}

test("allocates exactly keepQuantity after a profitable recovery SELL", () => {
  assert.deepEqual(evaluateRecoveryCompletion(baseInput), {
    eligible: true,
    pause: false,
    reason: null,
    freeQuantity: "1",
    realizedNetProfit: "0.01",
  })
})

test("does not allocate free coins for a partial or cancelled recovery SELL", () => {
  assert.deepEqual(evaluateRecoveryCompletion({
    ...baseInput,
    sellOrderFullyFilled: false,
  }), {
    eligible: false,
    pause: false,
    reason: "RECOVERY_SELL_NOT_FULLY_FILLED",
    freeQuantity: "0",
    realizedNetProfit: "0.01",
  })
})

test("pauses when a fully filled recovery SELL misses minProfit", () => {
  const result = evaluateRecoveryCompletion({
    ...baseInput,
    netSellProceeds: "10.009",
  })
  assert.equal(result.eligible, false)
  assert.equal(result.pause, true)
  assert.equal(result.reason, "RECOVERY_SELL_FAILED_MIN_PROFIT")
  assert.equal(result.freeQuantity, "0")
})

test("pauses when actual remaining inventory is below keepQuantity", () => {
  const result = evaluateRecoveryCompletion({
    ...baseInput,
    activeQuantity: "0.999",
  })
  assert.equal(result.eligible, false)
  assert.equal(result.pause, true)
  assert.equal(result.reason, "INSUFFICIENT_ACTIVE_INVENTORY_FOR_FREE_ALLOCATION")
  assert.equal(result.freeQuantity, "0")
})

test("continues recovery without pausing when profit is below the floor but sellable inventory remains", () => {
  const result = evaluateRecoveryCompletion({
    ...baseInput,
    activeQuantity: "1.25",
    keepQuantity: "1",
    netSellProceeds: "10.009",
  })

  assert.deepEqual(result, {
    eligible: false,
    pause: false,
    reason: "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
    freeQuantity: "0",
    realizedNetProfit: "0.009",
  })
})

test("defers completion while any active residual remains above keepQuantity", () => {
  const result = evaluateRecoveryCompletion({
    ...baseInput,
    activeQuantity: "1.25",
    keepQuantity: "1",
  })
  assert.deepEqual(result, {
    eligible: false,
    pause: false,
    reason: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
    freeQuantity: "0",
    realizedNetProfit: "0.01",
  })
})

test("rejects invalid completion inputs", () => {
  assert.throws(() => evaluateRecoveryCompletion({
    ...baseInput,
    minProfit: "0",
  }))
  assert.throws(() => evaluateRecoveryCompletion({
    ...baseInput,
    minProfit: "0.009",
  }))
  assert.throws(() => evaluateRecoveryCompletion({
    ...baseInput,
    keepQuantity: "-1",
  }))
  assert.throws(() => evaluateRecoveryCompletion({
    ...baseInput,
    sellOrderFullyFilled: "true",
  }))
})


test("completes a profitable cycle when keepQuantity is configured as zero", () => {
  const result = evaluateRecoveryCompletion({
    ...baseInput,
    activeQuantity: "0",
    keepQuantity: "0",
  })

  assert.deepEqual(result, {
    eligible: true,
    pause: false,
    reason: null,
    freeQuantity: "0",
    realizedNetProfit: "0.01",
  })
})


test("does not complete the actual ZRO recovery while the 0.04 residual remains above keepQuantity", () => {
  const result = evaluateRecoveryCompletion({
    sellOrderFullyFilled: true,
    spent: "64.02",
    netSellProceeds: "64.03136454",
    activeQuantity: "0.05",
    keepQuantity: "0.01",
    minProfit: "0.01",
  })

  assert.deepEqual(result, {
    eligible: false,
    pause: false,
    reason: "RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH",
    freeQuantity: "0",
    realizedNetProfit: "0.01136454",
  })
})
