import test from "node:test"
import assert from "node:assert/strict"


test("decimal accounting helpers preserve exact sums and comparisons", () => {

test("repeated quote-cost accumulation does not drift", () => {

test("minimum-profit comparison has no arbitrary floating-point tolerance", () => {

test("decimal helpers reject invalid decimal input", () => {

test("decimal helpers accept valid signed and scientific decimal strings", () => {

test("decimal helpers reject malformed decimal syntax", () => {

test("decimal helpers reject unsupported input types and non-finite numbers", () => {

test("decimal helpers enforce the supported scale and exponent limits", () => {

test("exact decimal division requires explicit scale and rounding", () => {

test("exact decimal division rejects zero divisors and invalid rounding", () => {

test("absolute and negate decimal operations preserve exact values", () => {

test("min and max compare decimal values without converting to Number", () => {

test("rescale decimal applies explicit rounding when reducing precision", () => {

test("exact increment rounding uses decimal strings and explicit direction", () => {

test("exact increment rounding supports large and tiny increments", () => {

test("exact increment rounding handles disabled increments and rejects unsafe inputs", () => {

test("decimal calculations are deterministic and leave input objects unchanged", () => {
  const input = { left: "123456789.123456789", right: "0.000000001" };
  const original = structuredClone(input);
  assert.equal(multiplyDecimal(input), multiplyDecimal(input));
  assert.deepEqual(input, original);
});
