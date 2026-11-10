import nodeTest from "node:test"
const test = (name, ...args) => nodeTest("[recovery-sell-plan.test.js] " + name, ...args)
import assert from "node:assert/strict"
import { calculateRecoverySellPlan } from "./recovery-sell-plan.js"

const basePlan = {
  activeQuantity: "100",
  keepQuantity: "1",
  positionSpent: "10",
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

test("uses market reference pricing when proceeds already cover cost and minProfit", () => {
  const plan = calculateRecoverySellPlan({
    ...basePlan,
    saleProceeds: "10.01",
  })

  assert.deepEqual(plan, {
    quantity: "99",
    price: null,
    requiredNetProceeds: "0",
  })
})

test("rejects invalid financial inputs and missing exchange increments", () => {
  for (const overrides of [
    { activeQuantity: "0" },
    { keepQuantity: "-1" },
    { positionSpent: "-1" },
    { saleProceeds: "-1" },
    { minProfit: "0" },
    { minProfit: "0.009" },
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

test("rounds the minimum SELL price up only when the exact fee-adjusted price exceeds a tick", () => {
  const exactTick = calculateRecoverySellPlan({
    ...basePlan,
    positionSpent: "9.89",
  })
  const aboveTick = calculateRecoverySellPlan({
    ...basePlan,
    positionSpent: "9.8900001",
  })

  assert.equal(exactTick.requiredNetProceeds, "9.9")
  assert.equal(exactTick.price, "0.1")
  assert.equal(aboveTick.requiredNetProceeds, "9.9000001")
  assert.equal(aboveTick.price, "0.101")
})

test("reserves base-asset SELL commission without crossing the retained inventory boundary", () => {
  const plan = calculateRecoverySellPlan({
    ...basePlan,
    feeRate: "0.001",
    quantityStepSize: "0.1",
  })

  // Independent arithmetic: 98.9 × 1.001 = 98.9989; the next step, 99 × 1.001 = 99.099.
  assert.equal(plan.quantity, "98.9", "The fee reserve and quantity-step rounding must keep the SELL quantity at 98.9.")
  assert.equal(plan.price, "0.102", "The minimum recovery price must remain rounded up to the configured price tick.")
  assert.equal((Number(plan.quantity) * 1.001).toFixed(4), "98.9989", "The fee-adjusted SELL debit must remain below the 99 units available above keepQuantity.")
  assert.equal((99 * 1.001).toFixed(3), "99.099", "The next 0.1 quantity step would debit 99.099 and exceed the 99 units available.")
})
