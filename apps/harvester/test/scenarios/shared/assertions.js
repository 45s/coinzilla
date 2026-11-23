import assert from "node:assert/strict"

export function getScenarioRunFailures({ results = [] } = {}) {
  return results.filter((result) => ["FAILED", "TEST_NOT_FOUND", "SKIPPED"].includes(result.status))
}

export function assertScenarioRunSucceeded({ results = [] } = {}) {
  const failures = getScenarioRunFailures({ results })
  assert.equal(
    failures.length,
    0,
    `Conservative scenario execution failed: ${failures.map(({ id, status }) => `${id}=${status}`).join(", ")}`,
  )
}

export function assertVerifiedScenarioEvidence({ scenarios = [] } = {}) {
  const invalid = scenarios.filter((scenario) => (
    scenario.coverageStatus === "VERIFIED" &&
    (!scenario.verification || !/^[a-f0-9]{40}$/i.test(scenario.verification.commit ?? ""))
  ))
  assert.equal(
    invalid.length,
    0,
    `VERIFIED scenarios require exact commit evidence: ${invalid.map(({ id }) => id).join(", ")}`,
  )
}
