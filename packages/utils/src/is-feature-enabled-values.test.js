import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { isFeatureEnabled } from "./is-feature-enabled.js"

const original = process.env.COINZILLA_TEST_FEATURE
afterEach(() => {
  if (original === undefined) {delete process.env.COINZILLA_TEST_FEATURE}
  else {process.env.COINZILLA_TEST_FEATURE = original}
})

describe("isFeatureEnabled environment values", () => {
  it("enables only when the value is exactly 1", () => {
    const logger = { warn() {},
      error() {} }
    for (const value of ["true", "yes", "0", "", "01"]) {
      process.env.COINZILLA_TEST_FEATURE = value
      assert.equal(isFeatureEnabled({ envVarName: "COINZILLA_TEST_FEATURE",
        logger }), false)
    }
    process.env.COINZILLA_TEST_FEATURE = "1"
    assert.equal(isFeatureEnabled({ envVarName: "COINZILLA_TEST_FEATURE",
      logger }), true)
  })

  it("warns when the feature is not enabled", () => {
    const warnings = []
    process.env.COINZILLA_TEST_FEATURE = "0"
    assert.equal(isFeatureEnabled({ envVarName: "COINZILLA_TEST_FEATURE",
      logger: { warn: (value) => warnings.push(value) } }), false)
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0].envVarName, "COINZILLA_TEST_FEATURE")
    assert.equal(warnings[0].enabled, false)
  })
})
