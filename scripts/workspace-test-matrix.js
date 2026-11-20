const UTILS_PACKAGE = "@coinzilla/utils"

function findDuplicates(values) {
  const seen = new Set()
  const duplicates = new Set()

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
    } else {
      seen.add(value)
    }
  }

  return [...duplicates]
}

function comparePackages({ label, expected, actual }) {
  const errors = []
  const duplicates = findDuplicates(actual)
  const missing = expected.filter((name) => !actual.includes(name))
  const unexpected = actual.filter((name) => !expected.includes(name))

  if (duplicates.length > 0) {
    errors.push(`${label} matrix contains duplicate packages: ${[...new Set(duplicates)].join(", ")}.`)
  }

  if (missing.length > 0) {
    errors.push(`${label} matrix is missing workspace packages: ${missing.join(", ")}.`)
  }

  if (unexpected.length > 0) {
    errors.push(`${label} matrix contains packages outside the expected workspace set: ${unexpected.join(", ")}.`)
  }

  return errors
}

/**
 * Validate package manifests against the explicit unit-test and coverage matrices.
 * @param {object} options
 * @param {{name: string, hasTestScript: boolean, hasCoverageScript: boolean}[]} options.packages
 * @param {string[]} options.unitTestPackages
 * @param {string[]} options.coveragePackages
 * @param {boolean} options.utilsTestJobConfigured
 * @returns {string[]}
 */
export function validateWorkspaceTestMatrix({
  packages,
  unitTestPackages,
  coveragePackages,
  utilsTestJobConfigured,
}) {
  const errors = []
  const packageNames = packages.map(({ name }) => name)
  const duplicateWorkspacePackages = findDuplicates(packageNames)

  if (duplicateWorkspacePackages.length > 0) {
    errors.push(
      `Workspace manifests contain duplicate package names: ${[...new Set(duplicateWorkspacePackages)].join(", ")}.`,
    )
  }

  for (const pkg of packages) {
    if (!pkg.hasTestScript) {
      errors.push(`${pkg.name} is missing the required package test script.`)
    }

    if (!pkg.hasCoverageScript) {
      errors.push(`${pkg.name} is missing the required test:coverage script.`)
    }
  }

  const expectedUnitPackages = packageNames.filter((name) => name !== UTILS_PACKAGE)
  errors.push(
    ...comparePackages({
      label: "Unit-test",
      expected: expectedUnitPackages,
      actual: unitTestPackages,
    }),
  )
  errors.push(
    ...comparePackages({
      label: "Coverage",
      expected: packageNames,
      actual: coveragePackages,
    }),
  )

  if (!packageNames.includes(UTILS_PACKAGE) || !utilsTestJobConfigured) {
    errors.push(
      `${UTILS_PACKAGE} must run once in the dedicated job named "packages/utils tests" to preserve the required check context.`,
    )
  }

  return errors
}
