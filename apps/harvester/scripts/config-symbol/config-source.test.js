import test from "node:test"
import assert from "node:assert/strict"
import { replacePairConfiguration } from "./config-source.js"

const pairs = {
  ADAFDUSD: {
    enabled: true,
    investment: 100,
  },
}

const source = [
  'import { NOTIFICATIONS_TG_PROFILES } from "./notifications-tg-profiles.js";',
  "// Keep this comment outside the generated region.",
  "export const appConfig = {",
  "  strategies: {",
  "    CG_coinGrabber: {",
  "      pairs: {",
  "        // BEGIN GENERATED PAIR CONFIGURATION",
  "        // END GENERATED PAIR CONFIGURATION",
  "      },",
  "    },",
  "  },",
  "};",
  "",
].join("\n")

test("replaces only the marked pair entries and preserves all surrounding JavaScript source", () => {
  const updated = replacePairConfiguration({ source, pairs })

  assert.ok(updated.includes('import { NOTIFICATIONS_TG_PROFILES } from "./notifications-tg-profiles.js";'), "The source transformer must preserve imports outside the pair region.")
  assert.ok(updated.includes("// Keep this comment outside the generated region."), "The source transformer must preserve operator comments outside the pair region.")
  assert.ok(updated.includes('"ADAFDUSD": {'), "The generated pair key must be serialized as a valid JavaScript object property.")
  assert.ok(updated.includes('"investment": 100'), "The generated pair values must be serialized without changing their values.")
  assert.equal(updated.split("// BEGIN GENERATED PAIR CONFIGURATION").length - 1, 1, "The transformed source must retain exactly one opening marker.")
  assert.equal(updated.split("// END GENERATED PAIR CONFIGURATION").length - 1, 1, "The transformed source must retain exactly one closing marker.")
})

test("rejects missing, duplicated, or reversed pair-region markers", () => {
  assert.throws(
    () => replacePairConfiguration({ source: source.replace("// BEGIN GENERATED PAIR CONFIGURATION", "// marker removed"), pairs }),
    /marker/i,
    "A missing opening marker must fail closed instead of guessing where to edit source.",
  )
  assert.throws(
    () => replacePairConfiguration({ source: source + source, pairs }),
    /marker/i,
    "Duplicated markers must be rejected because the intended source region would be ambiguous.",
  )
  const reversed = source
    .replace("// BEGIN GENERATED PAIR CONFIGURATION", "// TEMPORARY")
    .replace("// END GENERATED PAIR CONFIGURATION", "// BEGIN GENERATED PAIR CONFIGURATION")
    .replace("// TEMPORARY", "// END GENERATED PAIR CONFIGURATION")
  assert.throws(
    () => replacePairConfiguration({ source: reversed, pairs }),
    /marker/i,
    "Reversed pair-region markers must be rejected rather than rewriting an unrelated section.",
  )
})

test("rejects invalid pair maps before changing source", () => {
  for (const invalidPairs of [null, [], {}]) {
    assert.throws(
      () => replacePairConfiguration({ source, pairs: invalidPairs }),
      /non-empty pair map/i,
      "The source transformer must require a non-empty object of generated pair entries.",
    )
  }
})
