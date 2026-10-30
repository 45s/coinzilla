import test from "node:test"
import assert from "node:assert/strict"

import {
  calculateBuyThreshold,
  percentageToRate,
  calculatePercentageOf,
  applyPercentageChange,
  calculatePercentageChange,
  calculateNotional,
  meetsMinimumNotional,
  validateOrderAgainstTradingRules,
  addDecimal,
  absoluteDecimal,
  divideDecimal,
  maxDecimal,
  minDecimal,
  negateDecimal,
  rescaleDecimal,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
  estimateBuyAccounting,
  estimateSellAccounting,
  getFeeRate,
  getFeeRateExact,
  estimateBuyAccountingExact,
  estimateSellAccountingExact,
  calculateSellPlanExact,
  getOrderType,
  getSellFeeRateExact,
  calculateFillAccountingExact,
  calculateSellPlan,
  roundPriceDown,
  roundPriceUp,
  roundQuantityDown,
  roundDecimalToIncrement,
} from "./helpers.js"

test("calculateBuyThreshold applies a percentage drop to the initial reference price", () => {
  const threshold = calculateBuyThreshold({
    referencePrice: 0.07929,
    lastBuyPrice: null,
    priceStepPercent: 0.05,
  })

  assert.ok(Math.abs(threshold - 0.079250355) < 1e-12)
})

test("calculateBuyThreshold uses the last buy price when available", () => {
  const threshold = calculateBuyThreshold({
    referencePrice: 0.07929,
    lastBuyPrice: 0.08,
    priceStepPercent: 0.05,
  })

  assert.ok(Math.abs(threshold - 0.07996) < 1e-12)
})

test("calculateBuyThreshold preserves the configured percentage at different price levels", () => {
  const threshold = calculateBuyThreshold({
    referencePrice: 100,
    lastBuyPrice: null,
    priceStepPercent: 0.05,
  })

  assert.equal(threshold, 99.95)
})

test("calculateBuyThreshold rejects invalid prices and percentages", () => {
  for (const priceStepPercent of [0, -0.05, 100, 101, Number.NaN]) {
    assert.throws(() =>
      calculateBuyThreshold({
        referencePrice: 0.07929,
        lastBuyPrice: null,
        priceStepPercent,
      }),
    )
  }

  assert.throws(() =>
    calculateBuyThreshold({
      referencePrice: 0,
      lastBuyPrice: null,
      priceStepPercent: 0.05,
    }),
  )
})


test("roundPriceDown returns a valid tick without floating-point noise", () => {
  assert.equal(roundPriceDown(0.07905045499999999, 0.00001), 0.07905)
  assert.equal(roundPriceDown(0.1234, 0.05), 0.1)
})

test("roundPriceUp returns a valid tick without floating-point noise", () => {
  assert.equal(roundPriceUp(0.0790500001, 0.00001), 0.07906)
  assert.equal(roundPriceUp(0.101, 0.05), 0.15)
})


test("roundQuantityDown respects exchange quantity steps", () => {
  assert.equal(roundQuantityDown(391.08910891089107, 1), 391)
  assert.equal(roundQuantityDown(4.999, 0.01), 4.99)
  assert.equal(roundQuantityDown(0.009, 0.01), 0)
})

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

test("getFeeRate converts pair commission percentages to a conservative decimal rate", () => {
  assert.equal(getFeeRate({ makerPercent: 0.075, takerPercent: 0.075 }), 0.00075)
  assert.equal(getFeeRate({ makerPercent: 0, takerPercent: 0.075 }), 0.00075)
  assert.equal(getFeeRate({ makerPercent: 0, takerPercent: 0 }), 0)
  assert.equal(getFeeRate({ makerPercent: 0.075, takerPercent: 0.04 }), 0.00075)
})

test("getFeeRate rejects missing or invalid commission percentages", () => {
  for (const value of [undefined, null, -0.01, 100, Number.NaN, Infinity]) {
    assert.throws(() => getFeeRate({ makerPercent: value, takerPercent: 0 }))
    assert.throws(() => getFeeRate({ makerPercent: 0, takerPercent: value }))
  }
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


test("calculateBuyThreshold avoids binary floating-point artifacts", () => {
  const threshold = calculateBuyThreshold({
    referencePrice: 1.554,
    lastBuyPrice: null,
    priceStepPercent: 0.05,
  });

  assert.equal(threshold, 1.553223);
  assert.equal(String(threshold), "1.553223");
});

test("tick and step rounding uses exact decimal increments", () => {
  assert.equal(roundPriceDown(1.5532230000000002, 0.001), 1.553);
  assert.equal(roundPriceUp(1.5530000000000002, 0.001), 1.554);
  assert.equal(roundQuantityDown(0.3, 0.1), 0.3);
  assert.equal(roundQuantityDown(0.29999999999999993, 0.1), 0.2);
});


test("decimal accounting helpers preserve exact sums and comparisons", () => {
  assert.equal(addDecimal({ left: "0.1", right: "0.2" }), "0.3");
  assert.equal(addDecimal({ left: "0.01", right: "0.02" }), "0.03");
  assert.equal(subtractDecimal({ left: "0.3", right: "0.1" }), "0.2");
  assert.equal(multiplyDecimal({ left: "0.1", right: "0.2" }), "0.02");
  assert.equal(compareDecimal({ left: "0.30000000000000001", right: "0.3" }), 1);
  assert.equal(compareDecimal({ left: "1.2", right: "1.20" }), 0);
});

test("buy and sell quote accounting return exact decimal strings", () => {
  const buy = estimateBuyAccounting({
    quantity: 100,
    price: 0.1,
    feeRate: 0.001,
  });
  const sell = estimateSellAccounting({
    quantity: 100,
    price: 0.1,
    feeRate: 0.001,
  });

  assert.equal(buy.estimatedCost, "10.01");
  assert.equal(sell.estimatedProceeds, "9.99");
});

test("repeated quote-cost accumulation does not drift", () => {
  let cycleCost = "0";

  for (let fill = 0; fill < 100; fill += 1) {
    const accounting = estimateBuyAccounting({
      quantity: 0.1,
      price: 0.1,
      feeRate: 0,
    });

    cycleCost = addDecimal({
      left: cycleCost,
      right: accounting.estimatedCost,
    });
  }

  assert.equal(cycleCost, "1");
});

test("minimum-profit comparison has no arbitrary floating-point tolerance", () => {
  const required = addDecimal({ left: "12.34", right: "0.01" });

  assert.equal(compareDecimal({ left: "12.35", right: required }), 0);
  assert.equal(compareDecimal({ left: "12.34999999", right: required }), -1);
});

test("decimal helpers reject invalid decimal input", () => {
  assert.throws(() => addDecimal({ left: "not-a-number", right: "1" }));
  assert.throws(() => compareDecimal({ left: "Infinity", right: "1" }));
});

test("decimal helpers accept valid signed and scientific decimal strings", () => {
  assert.equal(addDecimal({ left: "+1.25", right: "2.5e-1" }), "1.5");
  assert.equal(addDecimal({ left: "-0.5", right: "1" }), "0.5");
  assert.equal(addDecimal({ left: "1e2", right: "0.01" }), "100.01");
});

test("decimal helpers reject malformed decimal syntax", () => {
  for (const value of [
    "",
    " ",
    "NaN",
    "Infinity",
    "-Infinity",
    "1.2.3",
    "1e",
    "1e+",
    "--1",
    "0x10",
    ".5",
    "1e101",
    "1e-101",
    "1".repeat(257),
    "1e00000",
  ]) {
    assert.throws(
      () => addDecimal({ left: value, right: "1" }),
      { message: /Decimal/ },
      `Expected ${JSON.stringify(value)} to be rejected`,
    );
  }
});

test("decimal helpers reject unsupported input types and non-finite numbers", () => {
  for (const value of [null, undefined, true, {}, [], Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => addDecimal({ left: value, right: "1" }));
  }
});

test("decimal helpers enforce the supported scale and exponent limits", () => {
  assert.equal(addDecimal({ left: "1e-100", right: "0" }), `0.${"0".repeat(99)}1`);
  assert.equal(addDecimal({ left: "1e100", right: "0" }), `1${"0".repeat(100)}`);
  assert.throws(() => addDecimal({ left: "1e-101", right: "0" }));
  assert.throws(() => addDecimal({ left: "1e101", right: "0" }));
});

test("exact decimal division requires explicit scale and rounding", () => {
  assert.equal(divideDecimal({ left: "1", right: "3", scale: 4, rounding: "toward-zero" }), "0.3333");
  assert.equal(divideDecimal({ left: "2", right: "3", scale: 4, rounding: "half-up" }), "0.6667");
  assert.equal(divideDecimal({ left: "-1", right: "6", scale: 2, rounding: "half-up" }), "-0.17");
  assert.equal(divideDecimal({ left: "-1", right: "6", scale: 2, rounding: "toward-zero" }), "-0.16");
  assert.equal(divideDecimal({ left: "1", right: "-6", scale: 2, rounding: "away-from-zero" }), "-0.17");
  assert.equal(divideDecimal({ left: "1.25", right: "0.5", scale: 3, rounding: "half-up" }), "2.5");
});

test("exact decimal division rejects zero divisors and invalid rounding", () => {
  assert.throws(() => divideDecimal({ left: "1", right: "0", scale: 2, rounding: "half-up" }), /zero/);
  assert.throws(() => divideDecimal({ left: "1", right: "2", scale: 2 }), /rounding/);
  assert.throws(() => divideDecimal({ left: "1", right: "2", scale: -1, rounding: "half-up" }), /scale/);
  assert.throws(() => divideDecimal({ left: "1", right: "2", scale: 101, rounding: "half-up" }), /scale/);
});

test("absolute and negate decimal operations preserve exact values", () => {
  assert.equal(absoluteDecimal({ value: "-0.0012300" }), "0.00123");
  assert.equal(absoluteDecimal({ value: "0" }), "0");
  assert.equal(negateDecimal({ value: "12.3400" }), "-12.34");
  assert.equal(negateDecimal({ value: "-0.25" }), "0.25");
});

test("min and max compare decimal values without converting to Number", () => {
  assert.equal(minDecimal({ left: "0.30000000000000001", right: "0.3" }), "0.3");
  assert.equal(maxDecimal({ left: "0.30000000000000001", right: "0.3" }), "0.30000000000000001");
  assert.equal(minDecimal({ left: "-10", right: "-2" }), "-10");
  assert.equal(maxDecimal({ left: "-10", right: "-2" }), "-2");
});

test("rescale decimal applies explicit rounding when reducing precision", () => {
  assert.equal(rescaleDecimal({ value: "1.2349", scale: 2, rounding: "toward-zero" }), "1.23");
  assert.equal(rescaleDecimal({ value: "1.235", scale: 2, rounding: "half-up" }), "1.24");
  assert.equal(rescaleDecimal({ value: "-1.235", scale: 2, rounding: "half-up" }), "-1.24");
  assert.equal(rescaleDecimal({ value: "1.2", scale: 4 }), "1.2");
  assert.throws(() => rescaleDecimal({ value: "1.234", scale: 2 }), /rounding/);
});


test("exact increment rounding uses decimal strings and explicit direction", () => {
  assert.equal(roundDecimalToIncrement({ value: "1.234", increment: "0.01", direction: "down" }), "1.23");
  assert.equal(roundDecimalToIncrement({ value: "1.231", increment: "0.01", direction: "up" }), "1.24");
  assert.equal(roundDecimalToIncrement({ value: "1.235", increment: "0.01", direction: "nearest" }), "1.24");
  assert.equal(roundDecimalToIncrement({ value: "1.234", increment: "0.01", direction: "nearest" }), "1.23");
  assert.equal(roundDecimalToIncrement({ value: "0.3", increment: "0.1", direction: "down" }), "0.3");
});

test("exact increment rounding supports large and tiny increments", () => {
  assert.equal(roundDecimalToIncrement({ value: "12345678901234567890.123", increment: "0.05", direction: "down" }), "12345678901234567890.1");
  assert.equal(roundDecimalToIncrement({ value: "0.00000000000000012349", increment: "0.0000000000000000001", direction: "down" }), "0.0000000000000001234");
  assert.equal(roundDecimalToIncrement({ value: "0.00000000000000012349", increment: "0.0000000000000000001", direction: "up" }), "0.0000000000000001235");
});

test("exact increment rounding handles disabled increments and rejects unsafe inputs", () => {
  assert.equal(roundDecimalToIncrement({ value: "1.2300", increment: "0", direction: "down" }), "1.23");
  assert.throws(() => roundDecimalToIncrement({ value: 1.23, increment: "0.01", direction: "down" }), /decimal strings/);
  assert.throws(() => roundDecimalToIncrement({ value: "1", increment: "-0.01", direction: "down" }), /non-negative/);
  assert.throws(() => roundDecimalToIncrement({ value: "1", increment: "0.01", direction: "sideways" }), /direction/);
});


test("percentage points convert to exact decimal fee rates", () => {
  assert.equal(percentageToRate({ percent: "0.075" }), "0.00075");
  assert.equal(percentageToRate({ percent: "1" }), "0.01");
  assert.equal(percentageToRate({ percent: "0" }), "0");
  assert.equal(percentageToRate({ percent: "12.3456789" }), "0.123456789");
});

test("percentage calculations preserve tiny values and high precision", () => {
  assert.equal(calculatePercentageOf({ value: "0.00000001", percent: "0.075" }), "0.0000000000075");
  assert.equal(calculatePercentageOf({ value: "123456789.123456789", percent: "0.0001" }), "123.456789123456789");
});

test("percentage changes apply increases and decreases exactly", () => {
  assert.equal(applyPercentageChange({ value: "100", percent: "1.25" }), "101.25");
  assert.equal(applyPercentageChange({ value: "100", percent: "-1.25" }), "98.75");
  assert.equal(applyPercentageChange({ value: "0.00000001", percent: "-0.075" }), "0.0000000099925");
});

test("percentage change calculation uses explicit scale and rounding", () => {
  assert.equal(calculatePercentageChange({ from: "100", to: "101.25", scale: 4, rounding: "half-up" }), "1.25");
  assert.equal(calculatePercentageChange({ from: "100", to: "98.75", scale: 4, rounding: "half-up" }), "-1.25");
  assert.equal(calculatePercentageChange({ from: "3", to: "4", scale: 6, rounding: "half-up" }), "33.333333");
  assert.equal(calculatePercentageChange({ from: "1000000000000", to: "1000000000001", scale: 10, rounding: "half-up" }), "0.0000000001");
});

test("percentage helpers reject non-string financial inputs and invalid division", () => {
  assert.throws(() => percentageToRate({ percent: 0.075 }), { message: "percent must be a decimal string" });
  assert.throws(() => calculatePercentageOf({ value: 1, percent: "1" }), { message: "value must be a decimal string" });
  assert.throws(() => applyPercentageChange({ value: "1", percent: 1 }), { message: "percent must be a decimal string" });
  assert.throws(() => calculatePercentageChange({ from: "0", to: "1", scale: 4, rounding: "half-up" }), { message: "Cannot divide by zero" });
  assert.throws(() => calculatePercentageChange({ from: "1", to: "2", scale: 4 }), { message: /rounding/ });
  assert.throws(() => calculatePercentageChange({ from: "1", to: "2", scale: 99, rounding: "half-up" }));
});


test("notional calculation multiplies exact decimal price and quantity", () => {
  assert.equal(calculateNotional({ price: "0.1", quantity: "99.9" }), "9.99");
  assert.equal(calculateNotional({ price: "123456789.123456789", quantity: "0.00000001" }), "1.23456789123456789");
  assert.equal(calculateNotional({ price: "0.00000001", quantity: "0.00000001" }), "0.0000000000000001");
});

test("minimum notional check distinguishes below, equal, and above boundaries", () => {
  const minimum = "10";

  assert.equal(meetsMinimumNotional({ price: "2", quantity: "4.999", minNotional: minimum }), false);
  assert.equal(meetsMinimumNotional({ price: "2", quantity: "5", minNotional: minimum }), true);
  assert.equal(meetsMinimumNotional({ price: "2", quantity: "5.001", minNotional: minimum }), true);
  assert.equal(meetsMinimumNotional({ price: "0.1", quantity: "100", minNotional: "10.0000000000000000001" }), false);
});

test("notional helpers reject invalid financial inputs", () => {
  assert.throws(() => calculateNotional({ price: 2, quantity: "5" }), { message: "price must be a decimal string" });
  assert.throws(() => calculateNotional({ price: "0", quantity: "5" }), { message: "price must be greater than zero" });
  assert.throws(() => calculateNotional({ price: "-1", quantity: "5" }), { message: "price must be greater than zero" });
  assert.throws(() => calculateNotional({ price: "2", quantity: "-1" }), { message: "quantity must be non-negative" });
  assert.throws(() => meetsMinimumNotional({ price: "2", quantity: "5", minNotional: -1 }), { message: "minNotional must be a decimal string" });
  assert.throws(() => meetsMinimumNotional({ price: "2", quantity: "5", minNotional: "-1" }), { message: "minNotional must be non-negative" });
});


test("trading-rule validator accepts a valid limit order", () => {
  const result = validateOrderAgainstTradingRules({
    order: { type: "LIMIT", price: "10.25", quantity: "2" },
    rules: {
      priceIncrement: "0.05",
      quantityIncrement: "0.1",
      minQuantity: "0.5",
      maxQuantity: "10",
      minNotional: "10",
      maxNotional: "200",
      minPrice: "1",
      maxPrice: "100",
      supportedOrderTypes: ["LIMIT"],
    },
  });

  assert.deepEqual(result, { valid: true, reasons: [] });
});

test("trading-rule validator returns structured reasons for every violated rule", () => {
  const result = validateOrderAgainstTradingRules({
    order: { type: "MARKET", price: "0.123", quantity: "0.09" },
    rules: {
      priceIncrement: "0.05",
      quantityIncrement: "0.1",
      minQuantity: "0.1",
      maxQuantity: "5",
      minNotional: "1",
      maxNotional: "10",
      minPrice: "1",
      maxPrice: "20",
      supportedOrderTypes: ["LIMIT"],
    },
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.reasons.map(({ code }) => code), [
    "UNSUPPORTED_ORDER_TYPE",
    "PRICE_INCREMENT",
    "QUANTITY_INCREMENT",
    "MIN_QUANTITY",
    "MIN_PRICE",
    "MIN_NOTIONAL",
  ]);
  assert.ok(result.reasons.every(({ code, field, message }) =>
    typeof code === "string" && typeof field === "string" && typeof message === "string"));
});

test("trading-rule validator enforces exact notional and price-band boundaries", () => {
  const rules = {
    priceIncrement: "0.01",
    quantityIncrement: "0.1",
    minNotional: "10",
    referencePrice: "100",
    minPriceMultiplier: "0.9",
    maxPriceMultiplier: "1.1",
    supportedOrderTypes: ["LIMIT"],
  };

  assert.equal(validateOrderAgainstTradingRules({
    order: { type: "LIMIT", price: "90", quantity: "0.1" },
    rules,
  }).valid, false);
  assert.equal(validateOrderAgainstTradingRules({
    order: { type: "LIMIT", price: "90", quantity: "1" },
    rules,
  }).valid, true);
  assert.equal(validateOrderAgainstTradingRules({
    order: { type: "LIMIT", price: "110.01", quantity: "1" },
    rules,
  }).reasons[0].code, "PRICE_ABOVE_PERCENT_BAND");
});

test("trading-rule validator rejects incomplete or malformed canonical rules", () => {
  assert.throws(() => validateOrderAgainstTradingRules({
    order: { type: "LIMIT", price: "1", quantity: "1" },
    rules: { priceIncrement: "0.01", quantityIncrement: "0.01" },
  }), /supportedOrderTypes/);

  assert.throws(() => validateOrderAgainstTradingRules({
    order: { type: "LIMIT", price: "1", quantity: "1" },
    rules: { priceIncrement: "0", quantityIncrement: "0.01", supportedOrderTypes: ["LIMIT"] },
  }), /priceIncrement/);

  assert.throws(() => validateOrderAgainstTradingRules({
    order: { type: "LIMIT", price: "1", quantity: "1" },
    rules: {
      priceIncrement: "0.01",
      quantityIncrement: "0.01",
      minPriceMultiplier: "0.9",
      supportedOrderTypes: ["LIMIT"],
    },
  }), /Percent price bands require/);
});


test("trading-rule validator reports non-positive order values without throwing", () => {
  const result = validateOrderAgainstTradingRules({
    order: { type: "LIMIT", price: "0", quantity: "-1" },
    rules: {
      priceIncrement: "0.01",
      quantityIncrement: "0.01",
      supportedOrderTypes: ["LIMIT"],
    },
  });

  assert.deepEqual(result.reasons.map(({ code }) => code), [
    "PRICE_NOT_POSITIVE",
    "QUANTITY_NOT_POSITIVE",
  ]);
});

test("trading-rule validator rejects inconsistent rule bounds", () => {
  assert.throws(() => validateOrderAgainstTradingRules({
    order: { type: "LIMIT", price: "1", quantity: "1" },
    rules: {
      priceIncrement: "0.01",
      quantityIncrement: "0.01",
      minQuantity: "2",
      maxQuantity: "1",
      supportedOrderTypes: ["LIMIT"],
    },
  }), /must not exceed/);
});


test("exact fee and fill accounting preserve decimal strings", () => {
  const feeRate = getFeeRateExact({ makerPercent: 0.075, takerPercent: 0.075 });
  assert.equal(feeRate, "0.00075");

  assert.deepEqual(
    estimateBuyAccountingExact({ quantity: "100", price: "0.1", feeRate }),
    { netQuantity: "99.925", estimatedCost: "10.0075" },
  );
  assert.deepEqual(
    estimateSellAccountingExact({ quantity: "100", price: "0.1", feeRate }),
    { estimatedProceeds: "9.9925", estimatedBaseDeduction: "100.075" },
  );
});

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


test("zero maker commission selects post-only orders and zero SELL fee reserve", () => {
  assert.equal(getOrderType({ makerPercent: 0 }), "LIMIT_MAKER");
  assert.equal(getSellFeeRateExact({ makerPercent: 0, takerPercent: 0.075 }), "0");
  assert.equal(getOrderType({ makerPercent: 0.075 }), "LIMIT");
  assert.equal(getSellFeeRateExact({ makerPercent: 0.075, takerPercent: 0.1 }), "0.001");
  assert.throws(() => getSellFeeRateExact({ makerPercent: 0, takerPercent: -0.1 }));
  assert.throws(() => getOrderType({ makerPercent: -0.1 }));
});

test("actual BUY commissions are applied in the asset Binance charged", () => {
  assert.deepEqual(calculateFillAccountingExact({
    side: "BUY",
    quantity: "100",
    quoteQuantity: "10",
    commissionAmount: "0.075",
    commissionAsset: "DOGE",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
  }), {
    baseQuantity: "99.925",
    quoteQuantity: "10",
  });

  assert.deepEqual(calculateFillAccountingExact({
    side: "BUY",
    quantity: "100",
    quoteQuantity: "10",
    commissionAmount: "0.01",
    commissionAsset: "FDUSD",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
  }), {
    baseQuantity: "100",
    quoteQuantity: "10.01",
  });
});

test("actual SELL commissions are applied in the asset Binance charged", () => {
  assert.deepEqual(calculateFillAccountingExact({
    side: "SELL",
    quantity: "50",
    quoteQuantity: "5",
    commissionAmount: "0.0375",
    commissionAsset: "FDUSD",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
  }), {
    baseQuantity: "50",
    quoteQuantity: "4.9625",
  });

  assert.deepEqual(calculateFillAccountingExact({
    side: "SELL",
    quantity: "50",
    quoteQuantity: "5",
    commissionAmount: "0.01",
    commissionAsset: "DOGE",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
  }), {
    baseQuantity: "50.01",
    quoteQuantity: "5",
  });
});

test("zero commissions do not require an inferred commission asset", () => {
  assert.deepEqual(calculateFillAccountingExact({
    side: "BUY",
    quantity: "10",
    quoteQuantity: "2",
    commissionAmount: "0",
    commissionAsset: null,
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
  }), {
    baseQuantity: "10",
    quoteQuantity: "2",
  });
});

test("third-asset and incomplete commissions fail closed", () => {
  const base = {
    side: "BUY",
    quantity: "10",
    quoteQuantity: "2",
    baseAsset: "DOGE",
    quoteAsset: "FDUSD",
  };

  assert.throws(() => calculateFillAccountingExact({
    ...base,
    commissionAmount: "0.01",
    commissionAsset: "BNB",
  }), /Unsupported commission asset/);

  assert.throws(() => calculateFillAccountingExact({
    ...base,
    commissionAmount: "0.01",
    commissionAsset: null,
  }), /must include its asset/);
});
