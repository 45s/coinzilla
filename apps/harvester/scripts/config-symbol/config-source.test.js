import test from "node:test"
import assert from "node:assert/strict"
import { insertTradingPairConfiguration } from "./config-source.js"
import { EXTERNAL_ORDERS_POLICIES } from "../../src/domain/external-orders-policy.js"
import { TRADING_ENVIRONMENTS } from "../../src/domain/trading-environment.js"

const pairConfig = {
  enabled: true,
  tradingEnvironment: TRADING_ENVIRONMENTS.BOTH,
  enableVolatilityProtection: true,
  externalOrdersPolicy: EXTERNAL_ORDERS_POLICIES.IGNORE,
  investment: 100,
  orderQuantity: 20,
  keepQuantity: 0.1,
  minProfit: 0.01,
  priceStepPercent: 0.05,
  pricePrecision: 4,
  quantityPrecision: 1,
  makerPercent: 0,
  takerPercent: 0.1,
}
const source = [
  "// Operator-maintained external pair configuration.",
  'import { EXTERNAL_ORDERS_POLICIES } from "./src/domain/external-orders-policy.js"',
  'import { TRADING_ENVIRONMENTS } from "./src/domain/trading-environment.js"',
  "export const tradingPairs = {",
  "  LINKFDUSD: { enabled: true },",
  "};",
  "",
].join("\n")

test("inserts a pair into the external tradingPairs map and preserves surrounding source", () => {
  const updated = insertTradingPairConfiguration({ source, symbol: "ADAFDUSD", pairConfig })
  assert.ok(updated.includes("export const tradingPairs = {"), "The external config must keep its named tradingPairs export.")
  assert.ok(updated.includes("LINKFDUSD: { enabled: true }"), "Existing pair source must remain unchanged.")
  assert.ok(updated.includes('"ADAFDUSD": {'), "The new symbol must be inserted into the external map.")
  assert.ok(updated.includes("tradingEnvironment: TRADING_ENVIRONMENTS.BOTH"), "The generator must write the named environment constant instead of a repeated string literal.")
  assert.ok(updated.includes("externalOrdersPolicy: EXTERNAL_ORDERS_POLICIES.IGNORE"), "The generator must preserve the named external-order policy constant.")
  assert.ok(updated.includes("// Operator-maintained external pair configuration."), "Operator comments must survive pair insertion.")
})

test("fails closed when the external tradingPairs export is missing or ambiguous", () => {
  assert.throws(
    () => insertTradingPairConfiguration({ source: "export const other = {};", symbol: "ADAFDUSD", pairConfig }),
    /exactly one tradingPairs object/,
    "The generator must not guess a target when the external pair map is missing.",
  )
  assert.throws(
    () => insertTradingPairConfiguration({ source: "export const tradingPairs = {};\nexport const tradingPairs = {};", symbol: "ADAFDUSD", pairConfig }),
    /exactly one tradingPairs object/,
    "The generator must reject multiple target maps instead of selecting one arbitrarily.",
  )
})

test("rejects unsupported pair enums instead of writing raw string values", () => {
  assert.throws(
    () => insertTradingPairConfiguration({
      source,
      symbol: "ADAFDUSD",
      pairConfig: { ...pairConfig, tradingEnvironment: "paper" },
    }),
    /TRADING_ENVIRONMENTS/,
    "The generator must reject an unsupported environment rather than writing a string literal.",
  )
  assert.throws(
    () => insertTradingPairConfiguration({
      source,
      symbol: "ADAFDUSD",
      pairConfig: { ...pairConfig, externalOrdersPolicy: "adopt" },
    }),
    /EXTERNAL_ORDERS_POLICIES/,
    "The generator must reject an unsupported external-order policy rather than writing a string literal.",
  )
})

test("rejects invalid symbols and pair values before changing source", () => {
  assert.throws(
    () => insertTradingPairConfiguration({ source, symbol: "ada-fdusd", pairConfig }),
    /symbol/,
    "Generated symbols must use the canonical uppercase Binance symbol format.",
  )
  assert.throws(
    () => insertTradingPairConfiguration({ source, symbol: "ADAFDUSD", pairConfig: null }),
    /pair config/,
    "The generator must reject an empty pair configuration before editing source.",
  )
})
