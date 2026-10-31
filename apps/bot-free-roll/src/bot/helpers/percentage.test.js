import test from "node:test"
import assert from "node:assert/strict"

import { percentageToRate, calculatePercentageOf, applyPercentageChange, calculatePercentageChange } from "./percentage.js"

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
