import test from "node:test"
import assert from "node:assert/strict"
import { calculateRecoverySellPlan } from "./recovery-sell-plan.js"

const basePlan = {
  activeQuantity: "100",
  keepQuantity: "1",
  cycleCost: "10",
  saleProceeds: "0",
  minProfit: "0.01",
  feeRate: "0",
  priceTickSize: "0.001",
  quantityStepSize: "1",
}

test("plans a recovery SELL that retains keepQuantity and covers cost plus minProfit", () => {
  const plan = calculateRecoverySellPlan(basePlan)

  assert.deepEqual(plan, {
    quantity: "99",
    price: "0.102",
    requiredNetProceeds: "10.01",
  })
})

test("continues cumulative recovery after confirmed partial SELL proceeds", () => {
  const plan = calculateRecoverySellPlan({
    ...basePlan,
    saleProceeds: "4.5",
  })

  assert.deepEqual(plan, {
    quantity: "99",
    price: "0.056",
    requiredNetProceeds: "5.51",
  })
})

test("reserves base quantity for the configured fee ceiling", () => {
  const plan = calculateRecoverySellPlan({
    ...basePlan,
    feeRate: "0.001",
    quantityStepSize: "0.1",
  })

  assert.equal(plan.quantity, "98.9")
  assert.equal(plan.price, "0.102")
})

test("does not create a SELL when no quantity remains above keepQuantity", () => {
  const plan = calculateRecoverySellPlan({
    ...basePlan,
    activeQuantity: "1",
  })

  assert.deepEqual(plan, {
    quantity: "0",
    price: null,
    requiredNetProceeds: "10.01",
  })
})

test("continues the recovery SELL at a positive tick when proceeds already cover cost and minProfit", () => {
  const plan = calculateRecoverySellPlan({
    ...basePlan,
    saleProceeds: "10.01",
  })

  assert.deepEqual(plan, {
    quantity: "99",
    price: "0.001",
    requiredNetProceeds: "0",
  })
})

test("rejects invalid financial inputs and missing exchange increments", () => {
  for (const overrides of [
    { activeQuantity: "0" },
    { keepQuantity: "-1" },
    { cycleCost: "-1" },
    { saleProceeds: "-1" },
    { minProfit: "0" },
    { feeRate: "-0.1" },
    { feeRate: "1" },
    { priceTickSize: "0" },
    { quantityStepSize: "0" },
    { activeQuantity: "not-a-number" },
  ]) {
    assert.throws(() => calculateRecoverySellPlan({
      ...basePlan,
      ...overrides,
    }))
  }
})
