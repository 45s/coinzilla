import test from "node:test"
import assert from "node:assert/strict"

import { addDecimal, compareDecimal } from "./decimal.js"
import { getFeeRate, estimateBuyAccountingExact } from "./accounting.js"
import { calculateSellPlanExact, calculateSellPlan } from "./order-planning.js"

test("calculateSellPlan rounds quantity down before calculating profitable price", () => {
  const plan = calculateSellPlan({
    activeQuantity: 396,
    keepQuantity: 1,
    cycleCost: 31.8554,
    saleProceeds: 0,
    minProfit: 0.01,
    feeRate: 0.01,
    priceTickSize: 0.00001,
    quantityStepSize: 1,
  })
  assert.equal(plan.quantity, 391)
  assert.equal(plan.price, 0.08233)
})

test("calculateSellPlan returns readable money precision without floating-point noise", () => {
  const plan = calculateSellPlan({
    activeQuantity: 1584,
    keepQuantity: 1,
    cycleCost: 128.00336,
    saleProceeds: 0,
    minProfit: 0.01,
    feeRate: 0.01,
    priceTickSize: 0.00001,
    quantityStepSize: 1,
  })

  assert.equal(plan.quantity, 1567)
  assert.equal(plan.requiredNetProceeds, 128.01336)
  assert.equal(plan.price, 0.08252)
})

test("calculateSellPlan uses realistic 0.075% commission without the former 1% assumption", () => {
  const plan = calculateSellPlan({
    activeQuantity: 396,
    keepQuantity: 1,
    cycleCost: 31.8554,
    saleProceeds: 0,
    minProfit: 0.01,
    feeRate: getFeeRate({ makerPercent: 0.075, takerPercent: 0.075 }),
    priceTickSize: 0.00001,
    quantityStepSize: 1,
  })

  assert.equal(plan.quantity, 394)
  assert.equal(plan.price, 0.08094)
})

test("exact SELL planning rounds quantity down and price up", () => {
  const plan = calculateSellPlanExact({
    activeQuantity: "396",
    keepQuantity: "1",
    cycleCost: "31.8554",
    saleProceeds: "0",
    minProfit: "0.01",
    feeRate: "0.00075",
    priceTickSize: "0.00001",
    quantityStepSize: "1",
  });

  assert.deepEqual(plan, {
    quantity: "394",
    price: "0.08094",
    requiredNetProceeds: "31.8654",
  });
});

test("exact repeated position accumulation and minimum-profit boundary do not drift", () => {
  let activeQuantity = "0";
  let cycleCost = "0";

  for (let fill = 0; fill < 100; fill += 1) {
    const accounting = estimateBuyAccountingExact({
      quantity: "0.1",
      price: "0.1",
      feeRate: "0",
    });
    activeQuantity = addDecimal({ left: activeQuantity, right: accounting.netQuantity });
    cycleCost = addDecimal({ left: cycleCost, right: accounting.estimatedCost });
  }

  assert.equal(activeQuantity, "10");
  assert.equal(cycleCost, "1");

  const required = addDecimal({ left: cycleCost, right: "0.01" });
  assert.equal(compareDecimal({ left: "1.01", right: required }), 0);
  assert.equal(compareDecimal({ left: "1.00999999", right: required }), -1);
});
