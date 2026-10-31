import test from "node:test"
import assert from "node:assert/strict"

import { calculateNotional, meetsMinimumNotional, validateOrderAgainstTradingRules } from "./trading-rules.js"

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

test("trading-rule validation does not mutate order or exchange rules", () => {
  const order = { type: "LIMIT", price: "10", quantity: "2" };
  const rules = { priceIncrement: "0.01", quantityIncrement: "0.1", supportedOrderTypes: ["LIMIT"] };
  const originalOrder = structuredClone(order);
  const originalRules = structuredClone(rules);
  validateOrderAgainstTradingRules({ order, rules });
  assert.deepEqual(order, originalOrder);
  assert.deepEqual(rules, originalRules);
});
