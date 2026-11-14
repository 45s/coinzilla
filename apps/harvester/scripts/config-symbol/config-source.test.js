import test from "node:test"
import assert from "node:assert/strict"
import { insertPairConfiguration } from "./config-source.js"

const pairConfig = {
  enabled: true,
  investment: 100,
  settings: {
    pricePrecision: 4,
    quantityPrecision: 2,
  },
}

const source = [
  'import { EXTERNAL_ORDERS_POLICIES } from "../../src/domain/external-orders-policy.js";',
  "// Keep this strategy-level comment unchanged.",
  "// The text \"pairs: {\" in this comment is not a configuration property.",
  "export const CG_COIN_GRABBER_CONFIG = {",
  "  enabled: true,",
  "  settings: {",
  "    conservative: { enabled: true },",
  "    recovery: { enabled: false },",
  "  },",
  "  pairs: {",
  "    // This manually maintained pair and its source formatting must remain unchanged.",
  '    LINKFDUSD: { enabled: true, externalOrdersPolicy: EXTERNAL_ORDERS_POLICIES.IGNORE },',
  "  },",
  "};",
  "",
].join("\n")

test("inserts one new pair into the pairs object without generated markers", () => {
  const updated = insertPairConfiguration({ source, symbol: "ADAFDUSD", pairConfig })

  assert.ok(updated.includes('    "ADAFDUSD": {'), "The generated pair must be inserted directly into the strategy pairs object.")
  assert.ok(updated.includes('      "investment": 100'), "The generated pair must retain its validated investment value.")
  assert.ok(updated.includes('        "pricePrecision": 4'), "Nested generated pair settings must be serialized completely.")
  assert.ok(updated.includes("LINKFDUSD: { enabled: true, externalOrdersPolicy: EXTERNAL_ORDERS_POLICIES.IGNORE },"), "Existing pair source, including enum expressions, must remain byte-for-byte unchanged.")
  assert.ok(updated.includes("// This manually maintained pair and its source formatting must remain unchanged."), "Comments inside the pairs object must remain intact.")
  assert.ok(updated.includes("// Keep this strategy-level comment unchanged."), "Comments outside the pairs object must remain intact.")
  assert.equal(updated.includes("GENERATED PAIR"), false, "The updated configuration must not require or introduce generated-region markers.")
})

test("inserts a pair into an empty pairs object", () => {
  const emptyPairsSource = [
    "export const CG_COIN_GRABBER_CONFIG = {",
    "  pairs: {},",
    "};",
    "",
  ].join("\n")
  const updated = insertPairConfiguration({ source: emptyPairsSource, symbol: "ADAFDUSD", pairConfig })

  assert.ok(updated.includes('"ADAFDUSD": {'), "The generator must support an initially empty pairs object.")
  assert.ok(updated.includes('"investment": 100'), "An empty pairs object must receive the complete validated pair configuration.")
})

test("rejects a missing or ambiguous pairs object instead of guessing where to write", () => {
  const missingPairsSource = source.replace("  pairs: {", "  markets: {")
  const duplicatePairsSource = source.replace("  pairs: {", "  pairs: {},\n  pairs: {")

  assert.throws(
    () => insertPairConfiguration({ source: missingPairsSource, symbol: "ADAFDUSD", pairConfig }),
    /pairs object/i,
    "A configuration without the canonical strategy pairs object must fail closed.",
  )
  assert.throws(
    () => insertPairConfiguration({ source: duplicatePairsSource, symbol: "ADAFDUSD", pairConfig }),
    /ambiguous|exactly one/i,
    "Multiple pairs objects must be rejected because the intended insertion target is ambiguous.",
  )
})

test("rejects invalid generated symbols and pair values before changing source", () => {
  for (const invalidInput of [
    { symbol: "ada-fdusd", pairConfig },
    { symbol: "ADAFDUSD", pairConfig: null },
    { symbol: "ADAFDUSD", pairConfig: [] },
  ]) {
    assert.throws(
      () => insertPairConfiguration({ source, ...invalidInput }),
      /symbol|pair config/i,
      "Invalid generated symbol or pair configuration must be rejected before source transformation.",
    )
  }
})
