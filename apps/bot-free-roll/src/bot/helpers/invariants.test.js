import test from "node:test";
import assert from "node:assert/strict";

import {
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  roundDecimalToIncrement,
  subtractDecimal,
} from "./decimal.js";
import { calculatePercentageChange } from "./percentage.js";
import {
  calculateCommissionRateExact,
  calculateFillAccountingExact,
  estimateBuyAccountingExact,
  estimateSellAccountingExact,
} from "./accounting.js";
import { calculateSellPlanExact } from "./order-planning.js";
import { calculateBuyThresholdExact } from "./price.js";
import { validateOrderAgainstTradingRules } from "./trading-rules.js";

test("decimal arithmetic identities hold across a deterministic input set", () => {
  for (let index = 1; index <= 100; index += 1) {
    const left = `${index}.${String((index * 17) % 100).padStart(2, "0")}`;
    const right = `${(index % 13) + 1}.${String((index * 31) % 100).padStart(2, "0")}`;

    assert.equal(addDecimal({ left, right }), addDecimal({ left: right, right: left }));
    assert.equal(multiplyDecimal({ left, right }), multiplyDecimal({ left: right, right: left }));
    assert.equal(compareDecimal({
      left: subtractDecimal({
        left: addDecimal({ left, right }),
        right,
      }),
      right: left,
    }), 0);
    assert.equal(
      Math.sign(compareDecimal({ left, right })),
      -Math.sign(compareDecimal({ left: right, right: left })),
    );
    assert.equal(compareDecimal({ left, right: left }), 0);
  }
});

test("increment rounding is bounded, monotonic, and idempotent", () => {
  const increment = "0.0007";
  let previousValue = "0";
  let previousRoundedDown = "0";

  for (let index = 1; index <= 250; index += 1) {
    const value = `0.${String((index * 137) % 100000).padStart(5, "0")}`;
    const roundedDown = roundDecimalToIncrement({
      value,
      increment,
      direction: "down",
    });
    const roundedUp = roundDecimalToIncrement({
      value,
      increment,
      direction: "up",
    });

    assert.ok(compareDecimal({ left: roundedDown, right: value }) <= 0);
    assert.ok(compareDecimal({ left: roundedUp, right: value }) >= 0);
    assert.ok(compareDecimal({
      left: subtractDecimal({ left: roundedUp, right: roundedDown }),
      right: increment,
    }) <= 0);
    assert.equal(roundDecimalToIncrement({
      value: roundedDown,
      increment,
      direction: "down",
    }), roundedDown);

    if (compareDecimal({ left: value, right: previousValue }) >= 0) {
      assert.ok(compareDecimal({ left: roundedDown, right: previousRoundedDown }) >= 0);
    }

    previousValue = value;
    previousRoundedDown = roundedDown;
  }
});

test("exact buy threshold uses the last buy as its reference and respects boundaries", () => {
  assert.equal(calculateBuyThresholdExact({
    referencePrice: "100",
    lastBuyPrice: null,
    priceStepPercent: "0.05",
  }), "99.95");
  assert.equal(calculateBuyThresholdExact({
    referencePrice: "100",
    lastBuyPrice: "80",
    priceStepPercent: "0.1",
  }), "79.92");
  assert.throws(() => calculateBuyThresholdExact({
    referencePrice: "100",
    lastBuyPrice: "0",
    priceStepPercent: "0.1",
  }));
  assert.throws(() => calculateBuyThresholdExact({
    referencePrice: "100",
    lastBuyPrice: null,
    priceStepPercent: "100",
  }));
});

test("percentage change is exact at positive, negative, and zero-change boundaries", () => {
  assert.equal(calculatePercentageChange({
    from: "100",
    to: "100.01",
    scale: 4,
    rounding: "half-up",
  }), "0.01");
  assert.equal(calculatePercentageChange({
    from: "100",
    to: "99.99",
    scale: 4,
    rounding: "half-up",
  }), "-0.01");
  assert.equal(calculatePercentageChange({
    from: "0.00000001",
    to: "0.00000002",
    scale: 4,
    rounding: "half-up",
  }), "100");
  assert.equal(calculatePercentageChange({
    from: "123.45",
    to: "123.45",
    scale: 8,
    rounding: "half-up",
  }), "0");
});

test("buy and sell accounting preserve exact fee and quantity invariants", () => {
  const buy = estimateBuyAccountingExact({
    quantity: "12.345",
    price: "0.123456",
    feeRate: "0.001",
  });
  const sell = estimateSellAccountingExact({
    quantity: "12.345",
    price: "0.123456",
    feeRate: "0.001",
  });

  assert.equal(buy.netQuantity, "12.332655");
  assert.equal(buy.estimatedCost, "1.52558838432");
  assert.equal(sell.estimatedProceeds, "1.52254025568");
  assert.equal(sell.estimatedBaseDeduction, "12.357345");
  assert.ok(compareDecimal({ left: buy.netQuantity, right: "0" }) > 0);
  assert.ok(compareDecimal({ left: sell.estimatedProceeds, right: "0" }) > 0);
});

test("fill accounting handles commission assets and rejects fees exceeding a fill", () => {
  const cases = [
    {
      side: "BUY",
      quantity: "10",
      quoteQuantity: "2",
      commissionAmount: "0.1",
      commissionAsset: "BASE",
      expected: { baseQuantity: "9.9", quoteQuantity: "2" },
    },
    {
      side: "BUY",
      quantity: "10",
      quoteQuantity: "2",
      commissionAmount: "0.01",
      commissionAsset: "QUOTE",
      expected: { baseQuantity: "10", quoteQuantity: "2.01" },
    },
    {
      side: "SELL",
      quantity: "10",
      quoteQuantity: "2",
      commissionAmount: "0.1",
      commissionAsset: "BASE",
      expected: { baseQuantity: "10.1", quoteQuantity: "2" },
    },
    {
      side: "SELL",
      quantity: "10",
      quoteQuantity: "2",
      commissionAmount: "0.01",
      commissionAsset: "QUOTE",
      expected: { baseQuantity: "10", quoteQuantity: "1.99" },
    },
  ];

  for (const scenario of cases) {
    assert.deepEqual(calculateFillAccountingExact({
      side: scenario.side,
      quantity: scenario.quantity,
      quoteQuantity: scenario.quoteQuantity,
      commissionAmount: scenario.commissionAmount,
      commissionAsset: scenario.commissionAsset,
      baseAsset: "BASE",
      quoteAsset: "QUOTE",
    }), scenario.expected);
  }

  const common = {
    side: "BUY",
    quantity: "10",
    quoteQuantity: "2",
    baseAsset: "BASE",
    quoteAsset: "QUOTE",
  };

  assert.throws(() => calculateFillAccountingExact({
    ...common,
    commissionAmount: "10",
    commissionAsset: "BASE",
  }), /Commission exceeds/);
  assert.throws(() => calculateFillAccountingExact({
    ...common,
    side: "SELL",
    commissionAmount: "2.01",
    commissionAsset: "QUOTE",
  }), /Commission exceeds/);
  assert.throws(() => calculateFillAccountingExact({
    ...common,
    commissionAmount: "-0.01",
    commissionAsset: "QUOTE",
  }), /non-negative/);
  assert.throws(() => calculateFillAccountingExact({
    ...common,
    quantity: "0",
    commissionAmount: "0",
    commissionAsset: null,
  }), /non-negative/);
});

test("commission rate conversion rejects incomplete and unsupported fee data", () => {
  const common = {
    price: "0.25",
    quoteQuantity: "2.5",
    baseAsset: "BASE",
    quoteAsset: "QUOTE",
  };

  assert.equal(calculateCommissionRateExact({
    ...common,
    commissionAmount: "0.01",
    commissionAsset: "QUOTE",
  }), "0.004");
  assert.equal(calculateCommissionRateExact({
    ...common,
    commissionAmount: "0.04",
    commissionAsset: "BASE",
  }), "0.004");
  assert.throws(() => calculateCommissionRateExact({
    ...common,
    commissionAmount: "0.01",
    commissionAsset: "THIRD",
  }), /Unsupported commission asset/);
  assert.throws(() => calculateCommissionRateExact({
    ...common,
    commissionAmount: "0.01",
    commissionAsset: null,
  }), /Unsupported commission asset/);
});

test("exact SELL plans never consume the keep quantity and cover required net proceeds", () => {
  const scenarios = [
    {
      activeQuantity: "100",
      keepQuantity: "1",
      cycleCost: "10",
      saleProceeds: "1",
      minProfit: "0.01",
      feeRate: "0.001",
      priceTickSize: "0.01",
      quantityStepSize: "0.1",
    },
    {
      activeQuantity: "0.123456",
      keepQuantity: "0.000006",
      cycleCost: "0.0000123456",
      saleProceeds: "0",
      minProfit: "0.0000001",
      feeRate: "0",
      priceTickSize: "0.00000001",
      quantityStepSize: "0.000001",
    },
    {
      activeQuantity: "1000",
      keepQuantity: "10",
      cycleCost: "50.25",
      saleProceeds: "5.25",
      minProfit: "0.05",
      feeRate: "0.0025",
      priceTickSize: "0.0001",
      quantityStepSize: "0.01",
    },
  ];

  for (const scenario of scenarios) {
    const plan = calculateSellPlanExact(scenario);

    assert.ok(compareDecimal({ left: plan.quantity, right: "0" }) > 0);
    assert.ok(compareDecimal({ left: plan.price, right: "0" }) > 0);

    const reservedBase = multiplyDecimal({
      left: plan.quantity,
      right: addDecimal({ left: "1", right: scenario.feeRate }),
    });
    const sellableBase = subtractDecimal({
      left: scenario.activeQuantity,
      right: scenario.keepQuantity,
    });
    assert.ok(compareDecimal({ left: reservedBase, right: sellableBase }) <= 0);

    const netProceeds = multiplyDecimal({
      left: multiplyDecimal({ left: plan.quantity, right: plan.price }),
      right: subtractDecimal({ left: "1", right: scenario.feeRate }),
    });
    assert.ok(compareDecimal({
      left: netProceeds,
      right: plan.requiredNetProceeds,
    }) >= 0);
  }
});

test("SELL planning returns no order when quantity cannot reach one exchange step", () => {
  const plan = calculateSellPlanExact({
    activeQuantity: "1.0001",
    keepQuantity: "1",
    cycleCost: "10",
    saleProceeds: "0",
    minProfit: "0.01",
    feeRate: "0.001",
    priceTickSize: "0.01",
    quantityStepSize: "0.01",
  });

  assert.deepEqual(plan, {
    quantity: "0",
    price: null,
    requiredNetProceeds: "10.01",
  });
});

test("trading-rule validation is deterministic and does not mutate nested inputs", () => {
  const order = {
    type: "LIMIT",
    price: "10.05",
    quantity: "2.5",
    metadata: { source: "test" },
  };
  const rules = {
    priceIncrement: "0.05",
    quantityIncrement: "0.1",
    minQuantity: "0.5",
    maxQuantity: "10",
    minNotional: "10",
    maxNotional: "200",
    minPrice: "1",
    maxPrice: "100",
    supportedOrderTypes: ["LIMIT"],
    metadata: { source: "fixture" },
  };
  const originalOrder = structuredClone(order);
  const originalRules = structuredClone(rules);

  const first = validateOrderAgainstTradingRules({ order, rules });
  const second = validateOrderAgainstTradingRules({ order, rules });

  assert.deepEqual(first, { valid: true, reasons: [] });
  assert.deepEqual(second, first);
  assert.deepEqual(order, originalOrder);
  assert.deepEqual(rules, originalRules);
});
