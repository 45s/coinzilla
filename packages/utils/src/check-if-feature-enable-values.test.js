import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { checkIfFeatureEnable } from "./check-if-feature-enable.js"

const original = process.env.COINZILLA_TEST_FEATURE
afterEach(() => {
  if (original === undefined) delete process.env.COINZILLA_TEST_FEATURE
  else process.env.COINZILLA_TEST_FEATURE = original
})

describe("checkIfFeatureEnable environment values", () => {
  it("enables only when the value is exactly 1", () => {
    const logger = { warn() {}, error() {} }
    for (const value of ["true", "yes", "0", "", "01"]) {
      process.env.COINZILLA_TEST_FEATURE = value
      assert.equal(checkIfFeatureEnable({ envVarName: "COINZILLA_TEST_FEATURE", logger }), false)
    }
    process.env.COINZILLA_TEST_FEATURE = "1"
    assert.equal(checkIfFeatureEnable({ envVarName: "COINZILLA_TEST_FEATURE", logger }), true)
  })

  it("warns when the feature is not enabled", () => {
    const warnings = []
    process.env.COINZILLA_TEST_FEATURE = "0"
    assert.equal(checkIfFeatureEnable({ envVarName: "COINZILLA_TEST_FEATURE", logger: { warn: (value) => warnings.push(value) } }), false)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0].why, /COINZILLA_TEST_FEATURE/)
  })
})
