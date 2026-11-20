import { existsSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

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
  errors.push(...comparePackages({ label: "Unit-test", expected: expectedUnitPackages, actual: unitTestPackages }))
  errors.push(...comparePackages({ label: "Coverage", expected: packageNames, actual: coveragePackages }))

  if (!packageNames.includes(UTILS_PACKAGE) || !utilsTestJobConfigured) {
    errors.push(
      `${UTILS_PACKAGE} must run once in the dedicated job named "packages/utils tests" to preserve the required check context.`,
    )
  }

  return errors
}

function readWorkspacePackages(rootDirectory) {
  const workspaceContent = readFileSync(resolve(rootDirectory, "pnpm-workspace.yaml"), "utf8")
  const patterns = [...workspaceContent.matchAll(/^\s*-\s*["']([^"']+)["']\s*$/gm)]
    .map((match) => match[1])

  if (patterns.length === 0) {
    throw new Error("pnpm-workspace.yaml contains no supported workspace package patterns.")
  }

  const packages = []

  for (const pattern of patterns) {
    if (!pattern.endsWith("/*")) {
      throw new Error(`Unsupported workspace pattern "${pattern}"; expected a direct-child /* pattern.`)
    }

    const parentDirectory = resolve(rootDirectory, pattern.slice(0, -2))

    if (!existsSync(parentDirectory)) {
      throw new Error(`Workspace directory does not exist: ${pattern.slice(0, -2)}.`)
    }

    for (const entry of readdirSync(parentDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      const manifestPath = resolve(parentDirectory, entry.name, "package.json")

      if (!existsSync(manifestPath)) {
        continue
      }

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
      packages.push({
        name: manifest.name,
        hasTestScript: typeof manifest.scripts?.test === "string",
        hasCoverageScript: typeof manifest.scripts?.["test:coverage"] === "string",
      })
    }
  }

  return packages
}

function readMatrixPackages({ workflowContent, expression, label }) {
  const match = workflowContent.match(expression)

  if (!match) {
    throw new Error(`Could not find the ${label} package matrix in its workflow.`)
  }

  return [...match[1].matchAll(/^\s*-\s*(?:package:\s*)?["']([^"']+)["']\s*$/gm)]
    .map((entry) => entry[1])
}

function checkWorkspaceTestMatrix(rootDirectory) {
  const unitWorkflowPath = resolve(rootDirectory, ".github/workflows/unit-tests.yml")
  const coverageWorkflowPath = resolve(rootDirectory, ".github/workflows/test-coverage.yml")
  const removedUtilsWorkflowPath = resolve(rootDirectory, ".github/workflows/utils-unit-tests.yml")
  const unitWorkflow = readFileSync(unitWorkflowPath, "utf8")
  const coverageWorkflow = readFileSync(coverageWorkflowPath, "utf8")

  const unitTestPackages = readMatrixPackages({
    workflowContent: unitWorkflow,
    expression: /matrix:\s*\n\s*package:\s*\n([\s\S]*?)(?=\n\s*runs-on:)/,
    label: "unit-test",
  })
  const coveragePackages = readMatrixPackages({
    workflowContent: coverageWorkflow,
    expression: /matrix:\s*\n\s*include:\s*\n([\s\S]*?)(?=\n\s*runs-on:)/,
    label: "coverage",
  })
  const utilsTestJobConfigured =
    unitWorkflow.includes("name: packages/utils tests") &&
    unitWorkflow.includes("pnpm --filter @coinzilla/utils test") &&
    !existsSync(removedUtilsWorkflowPath)

  return validateWorkspaceTestMatrix({
    packages: readWorkspacePackages(rootDirectory),
    unitTestPackages,
    coveragePackages,
    utilsTestJobConfigured,
  })
}

const rootDirectory = resolve(fileURLToPath(import.meta.url), "../..")
const errors = checkWorkspaceTestMatrix(rootDirectory)

if (errors.length > 0) {
  process.stderr.write(`Workspace test matrix check failed:\n- ${errors.join("\n- ")}\n`)
  process.exitCode = 1
} else {
  process.stdout.write("Workspace test and coverage matrices match all package manifests.\n")
}
