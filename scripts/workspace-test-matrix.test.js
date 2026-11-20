import test from "node:test"
import assert from "node:assert/strict"

import { validateWorkspaceTestMatrix } from "./workspace-test-matrix.js"

const packageNames = [
  "@coinzilla/harvester",
  "@coinzilla/brokers",
  "@coinzilla/db",
  "@coinzilla/entities",
  "@coinzilla/indicators",
  "@coinzilla/event-bus",
  "@coinzilla/journal",
  "@coinzilla/notifiers",
  "@coinzilla/utils",
]

function createPackages() {
  return packageNames.map((name) => ({
    name,
    hasTestScript: true,
    hasCoverageScript: true,
  }))
}

test("accepts complete workspace unit-test and coverage matrices", () => {
  const packages = createPackages()
  const errors = validateWorkspaceTestMatrix({
    packages,
    unitTestPackages: packageNames.filter((name) => name !== "@coinzilla/utils"),
    coveragePackages: packageNames,
    utilsTestJobConfigured: true,
  })

  assert.deepEqual(
    errors,
    [],
    "A complete package test matrix with the dedicated Utils job must have no policy findings.",
  )
})

test("reports a workspace package missing from the unit-test matrix", () => {
  const packages = createPackages()
  const errors = validateWorkspaceTestMatrix({
    packages,
    unitTestPackages: packageNames.filter(
      (name) => name !== "@coinzilla/utils" && name !== "@coinzilla/journal",
    ),
    coveragePackages: packageNames,
    utilsTestJobConfigured: true,
  })

  assert.ok(
    errors.some((error) => error.toLowerCase().includes("@coinzilla/journal") && error.toLowerCase().includes("unit-test")),
    "The matrix guard must identify a workspace package omitted from unit-test CI.",
  )
})

test("reports a workspace package missing from the coverage matrix", () => {
  const packages = createPackages()
  const errors = validateWorkspaceTestMatrix({
    packages,
    unitTestPackages: packageNames.filter((name) => name !== "@coinzilla/utils"),
    coveragePackages: packageNames.filter((name) => name !== "@coinzilla/entities"),
    utilsTestJobConfigured: true,
  })

  assert.ok(
    errors.some((error) => error.toLowerCase().includes("@coinzilla/entities") && error.toLowerCase().includes("coverage")),
    "The matrix guard must identify a workspace package omitted from coverage CI.",
  )
})

test("requires every workspace package to expose test and test:coverage scripts", () => {
  const packages = createPackages()
  packages[3] = {
    ...packages[3],
    hasTestScript: false,
    hasCoverageScript: false,
  }
  const errors = validateWorkspaceTestMatrix({
    packages,
    unitTestPackages: packageNames.filter((name) => name !== "@coinzilla/utils"),
    coveragePackages: packageNames,
    utilsTestJobConfigured: true,
  })

  assert.ok(
    errors.some((error) => error.includes("@coinzilla/entities") && error.includes("test script")),
    "The matrix guard must identify a package without the required unit-test command.",
  )
  assert.ok(
    errors.some((error) => error.includes("@coinzilla/entities") && error.includes("test:coverage")),
    "The matrix guard must identify a package without the required coverage command.",
  )
})

test("requires the dedicated Utils job that preserves the existing required check name", () => {
  const errors = validateWorkspaceTestMatrix({
    packages: createPackages(),
    unitTestPackages: packageNames.filter((name) => name !== "@coinzilla/utils"),
    coveragePackages: packageNames,
    utilsTestJobConfigured: false,
  })

  assert.ok(
    errors.some((error) => error.includes("@coinzilla/utils") && error.includes("dedicated")),
    "The matrix guard must prevent removal of the existing required Utils check context.",
  )
})
