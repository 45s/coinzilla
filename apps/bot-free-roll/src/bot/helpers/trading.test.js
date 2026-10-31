import test from "node:test"
import assert from "node:assert/strict"


test("notional calculation multiplies exact decimal price and quantity", () => {

test("minimum notional check distinguishes below, equal, and above boundaries", () => {

test("notional helpers reject invalid financial inputs", () => {

test("trading-rule validator accepts a valid limit order", () => {

test("trading-rule validator returns structured reasons for every violated rule", () => {

test("trading-rule validator enforces exact notional and price-band boundaries", () => {

test("trading-rule validator rejects incomplete or malformed canonical rules", () => {

test("trading-rule validator reports non-positive order values without throwing", () => {

test("trading-rule validator rejects inconsistent rule bounds", () => {

test("trading-rule validation does not mutate order or exchange rules", () => {
  const order = { type: "LIMIT", price: "10", quantity: "2" };
  const rules = { priceIncrement: "0.01", quantityIncrement: "0.1", supportedOrderTypes: ["LIMIT"] };
  const originalOrder = structuredClone(order);
  const originalRules = structuredClone(rules);
  validateOrderAgainstTradingRules({ order, rules });
  assert.deepEqual(order, originalOrder);
  assert.deepEqual(rules, originalRules);
});
