import test from "node:test"
import assert from "node:assert/strict"
import { evaluateRecoveryCompletion } from "./recovery-completion.js"

const baseInput = {
  sellOrderFullyFilled: true,
  buyCost: "10",
  netSellProceeds: "10.01",
  activeQuantity: "1.2",
  keepQuantity: "1",
  minProfit: "0.01",
}

test("allocates exactly keepQuantity only after a fully filled profitable recovery SELL", () => {
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

test("retains exactly keepQuantity when residual active inventory is larger", () => {
  const result = evaluateRecoveryCompletion({
    ...baseInput,
    activeQuantity: "1.25",
    keepQuantity: "1",
  })
  assert.equal(result.freeQuantity, "1")
  assert.equal(result.eligible, true)
})

test("rejects invalid completion inputs", () => {
  assert.throws(() => evaluateRecoveryCompletion({
    ...baseInput,
    minProfit: "0",
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
