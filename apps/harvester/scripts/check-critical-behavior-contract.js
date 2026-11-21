import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defaultLogger } from "@coinzilla/utils"

const APP_ROOT = fileURLToPath(new URL("../", import.meta.url))
const CONTRACT_PATH = path.join(APP_ROOT, "docs", "critical-behaviors.json")
const VALID_RUNTIME_STATUSES = new Set(["active", "offline-only", "disabled-by-design"])
const VALID_TEST_KINDS = new Set(["normal", "failure", "integration"])

function isSafeRelativePath(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.split("/").includes("..") &&
    !value.includes("\\")
}

function readChangedFiles() {
  const baseSha = process.env.GITHUB_BASE_SHA
  const headSha = process.env.GITHUB_HEAD_SHA
  if (!baseSha || !headSha) {
    return []
  }

  const output = execFileSync(
    "git",
    ["diff", "--name-only", "-z", `${baseSha}...${headSha}`],
    {
      cwd: APP_ROOT,
      encoding: "utf8",
    },
  )
  return output.split("\0")
    .filter(Boolean)
    .map((filePath) => filePath.startsWith("apps/harvester/")
      ? filePath.slice("apps/harvester/".length)
      : filePath)
}

function readContractFile({ readFile, relativePath }) {
  try {
    return readFile(relativePath)
  } catch {
    return undefined
  }
}

function validateRuntimeStatus({ behavior, errors }) {
  if (!VALID_RUNTIME_STATUSES.has(behavior.runtimeStatus)) {
    errors.push(`Critical behavior ${behavior.id} must declare its runtimeStatus.`)
  }
  if (
    behavior.runtimeStatus !== "active" &&
    (typeof behavior.limitation !== "string" || behavior.limitation.length === 0)
  ) {
    errors.push(`Critical behavior ${behavior.id} must document its runtime limitation.`)
  }
}

function validateSourceModules({ behavior, errors, readFile, sourceOwners }) {
  if (!Array.isArray(behavior.sourceModules) || behavior.sourceModules.length === 0) {
    errors.push(`Critical behavior ${behavior.id} must identify at least one production source module.`)
    return
  }

  for (const sourcePath of behavior.sourceModules) {
    if (!isSafeRelativePath(sourcePath) || !sourcePath.startsWith("src/")) {
      errors.push(`Critical behavior ${behavior.id} has an invalid production source path: ${sourcePath}.`)
      continue
    }
    const source = readContractFile({
      readFile,
      relativePath: sourcePath,
    })
    if (typeof source !== "string") {
      errors.push(`Critical behavior ${behavior.id} references missing production source: ${sourcePath}.`)
    }
    const owners = sourceOwners.get(sourcePath) ?? new Set()
    owners.add(behavior.id)
    sourceOwners.set(sourcePath, owners)
  }
}

function isValidTestCase(testCase) {
  return Boolean(
    testCase &&
    isSafeRelativePath(testCase.path) &&
    (testCase.path.startsWith("src/") || testCase.path.startsWith("test/")) &&
    typeof testCase.name === "string" &&
    testCase.name.length > 0 &&
    VALID_TEST_KINDS.has(testCase.kind),
  )
}

function hasNamedTestCase({ testSource, name }) {
  const expectedTitle = JSON.stringify(name)
  const callNames = ["nodeTest", "test", "runDogeTradingReplayTest"]
  for (const line of testSource.split("\n")) {
    const candidate = line.trimStart()
    for (const callName of callNames) {
      const callPrefix = `${callName}(`
      if (!candidate.startsWith(callPrefix)) {
        continue
      }
      const actualTitle = candidate.slice(callPrefix.length).trimStart()
      if (actualTitle.startsWith(expectedTitle)) {
        return true
      }
    }
  }
  return false
}

function validateTestCase({ behavior, testCase, errors, readFile, testKinds }) {
  if (!isValidTestCase(testCase)) {
    errors.push(`Critical behavior ${behavior.id} contains an invalid named test mapping.`)
    return
  }

  testKinds.add(testCase.kind)
  const testSource = readContractFile({
    readFile,
    relativePath: testCase.path,
  })
  if (typeof testSource !== "string") {
    errors.push(`Critical behavior ${behavior.id} references missing test file: ${testCase.path}.`)
  } else if (!hasNamedTestCase({
    testSource,
    name: testCase.name,
  })) {
    errors.push(`Critical behavior ${behavior.id} references missing regression test "${testCase.name}" in ${testCase.path}.`)
  }
}

function validateTestKinds({ behavior, testKinds, errors }) {
  if (!testKinds.has("normal")) {
    errors.push(`Critical behavior ${behavior.id} must map at least one normal-path regression test.`)
  }
  if (!testKinds.has("failure")) {
    errors.push(`Critical behavior ${behavior.id} must map at least one failure-path regression test.`)
  }
  if (behavior.integrationRequired === true && !testKinds.has("integration")) {
    errors.push(`Critical behavior ${behavior.id} requires integration/replay evidence but none is mapped.`)
  }
}

function validateTestMappings({ behavior, errors, readFile }) {
  if (!Array.isArray(behavior.tests) || behavior.tests.length === 0) {
    errors.push(`Critical behavior ${behavior.id} must identify named regression tests.`)
    return
  }

  const testKinds = new Set()
  for (const testCase of behavior.tests) {
    validateTestCase({
      behavior,
      testCase,
      errors,
      readFile,
      testKinds,
    })
  }
  validateTestKinds({
    behavior,
    testKinds,
    errors,
  })
}

function validateBehavior({ behavior, errors, readFile, sourceOwners }) {
  if (!behavior || typeof behavior.id !== "string" || behavior.id.length === 0) {
    errors.push("Every critical behavior must have a non-empty stable id.")
    return
  }
  if (typeof behavior.title !== "string" || behavior.title.length === 0) {
    errors.push(`Critical behavior ${behavior.id} must have a descriptive title.`)
  }
  if (
    behavior.integrationRequired !== undefined &&
    typeof behavior.integrationRequired !== "boolean"
  ) {
    errors.push(`Critical behavior ${behavior.id} must declare integrationRequired as a boolean.`)
  }
  validateRuntimeStatus({
    behavior,
    errors,
  })
  validateSourceModules({
    behavior,
    errors,
    readFile,
    sourceOwners,
  })
  validateTestMappings({
    behavior,
    errors,
    readFile,
  })
}

function validateBehaviorInventory({ behaviors, errors, readFile, sourceOwners }) {
  const behaviorIds = new Set()
  for (const behavior of behaviors) {
    if (behavior?.id && behaviorIds.has(behavior.id)) {
      errors.push(`Critical behavior id ${behavior.id} is duplicated.`)
    }
    if (behavior?.id) {
      behaviorIds.add(behavior.id)
    }
    validateBehavior({
      behavior,
      errors,
      readFile,
      sourceOwners,
    })
  }
}

function validateCriticalPathPrefixes({ contract, errors }) {
  const declaredPrefixes = Array.isArray(contract.criticalPathPrefixes)
    ? contract.criticalPathPrefixes
    : []
  const criticalPathPrefixes = declaredPrefixes.filter((prefix) =>
    isSafeRelativePath(prefix) && prefix.startsWith("src/"),
  )
  if (criticalPathPrefixes.length === 0) {
    errors.push("Critical behavior inventory must define at least one valid critical source path prefix.")
  }
  if (criticalPathPrefixes.length !== declaredPrefixes.length) {
    errors.push("Critical behavior inventory contains an invalid critical source path prefix.")
  }
  return criticalPathPrefixes
}

function validateChangedFiles({ criticalPathPrefixes, changedFiles, sourceOwners, errors }) {
  const affectedBehaviorIds = new Set()
  for (const changedPath of changedFiles) {
    if (!isSafeRelativePath(changedPath)) {
      errors.push(`Changed critical source path is invalid: ${changedPath}.`)
      continue
    }
    if (changedPath.endsWith(".test.js")) {
      continue
    }
    const isCriticalPath = criticalPathPrefixes.some((prefix) =>
      changedPath === prefix || (prefix.endsWith("/") && changedPath.startsWith(prefix)),
    )
    if (!isCriticalPath) {
      continue
    }
    const owners = sourceOwners.get(changedPath)
    if (!owners || owners.size === 0) {
      errors.push(`Changed critical source ${changedPath} has no behavior owner in the inventory.`)
      continue
    }
    for (const behaviorId of owners) {
      affectedBehaviorIds.add(behaviorId)
    }
  }
  return [...affectedBehaviorIds].sort()
}

/**
 * Validate the critical behavior inventory and its named regression evidence.
 *
 * @param {object} options
 * @param {object} options.contract Versioned behavior inventory.
 * @param {string[]} [options.changedFiles] App-relative changed paths.
 * @param {Function} options.readFile Injected app-relative file reader.
 * @returns {{ errors: string[], affectedBehaviorIds: string[] }}
 */
export function validateCriticalBehaviorContract({
  contract,
  changedFiles = [],
  readFile,
} = {}) {
  const errors = []
  if (typeof readFile !== "function") {
    errors.push("A file reader is required to validate critical behavior evidence.")
  }
  if (contract?.schemaVersion !== 1 || !Array.isArray(contract.behaviors)) {
    errors.push("Critical behavior inventory must use schemaVersion 1 and define behaviors.")
  }
  if (Array.isArray(contract?.behaviors) && contract.behaviors.length === 0) {
    errors.push("Critical behavior inventory must define at least one critical behavior.")
  }
  if (errors.length > 0) {
    return {
      errors,
      affectedBehaviorIds: [],
    }
  }

  if (!Array.isArray(changedFiles)) {
    errors.push("Changed critical source paths must be supplied as an array.")
  }
  const criticalPathPrefixes = validateCriticalPathPrefixes({
    contract,
    errors,
  })
  const sourceOwners = new Map()
  validateBehaviorInventory({
    behaviors: contract.behaviors,
    errors,
    readFile,
    sourceOwners,
  })
  const affectedBehaviorIds = validateChangedFiles({
    criticalPathPrefixes,
    changedFiles: Array.isArray(changedFiles) ? changedFiles : [],
    sourceOwners,
    errors,
  })
  return {
    errors,
    affectedBehaviorIds,
  }
}

function runCriticalBehaviorContractCheck() {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"))
  const result = validateCriticalBehaviorContract({
    contract,
    changedFiles: readChangedFiles(),
    readFile: (relativePath) => {
      const absolutePath = path.resolve(APP_ROOT, relativePath)
      if (!absolutePath.startsWith(APP_ROOT)) {
        throw new Error(`Refusing to read outside Harvester: ${relativePath}`)
      }
      return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : undefined
    },
  })

  if (result.errors.length > 0) {
    defaultLogger.error({
      message: "Harvester critical behavior contract validation failed",
      errors: result.errors,
    })
    process.exitCode = 1
  } else {
    defaultLogger.info({
      message: "Harvester critical behavior inventory validated",
      behaviorCount: contract.behaviors.length,
      affectedBehaviorIds: result.affectedBehaviorIds,
    })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCriticalBehaviorContractCheck()
}
