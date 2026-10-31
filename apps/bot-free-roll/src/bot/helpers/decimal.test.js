import test from "node:test"
import assert from "node:assert/strict"

import { addDecimal, absoluteDecimal, divideDecimal, maxDecimal, minDecimal, negateDecimal, rescaleDecimal, compareDecimal, multiplyDecimal, subtractDecimal, roundDecimalToIncrement } from "./decimal.js"
import { estimateBuyAccounting } from "./accounting.js"

test("decimal accounting helpers preserve exact sums and comparisons", () => {
  assert.equal(addDecimal({ left: "0.1", right: "0.2" }), "0.3");
  assert.equal(addDecimal({ left: "0.01", right: "0.02" }), "0.03");
  assert.equal(subtractDecimal({ left: "0.3", right: "0.1" }), "0.2");
  assert.equal(multiplyDecimal({ left: "0.1", right: "0.2" }), "0.02");
  assert.equal(compareDecimal({ left: "0.30000000000000001", right: "0.3" }), 1);
  assert.equal(compareDecimal({ left: "1.2", right: "1.20" }), 0);
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

test("decimal calculations are deterministic and leave input objects unchanged", () => {
  const input = { left: "123456789.123456789", right: "0.000000001" };
  const original = structuredClone(input);
  assert.equal(multiplyDecimal(input), multiplyDecimal(input));
  assert.deepEqual(input, original);
});
