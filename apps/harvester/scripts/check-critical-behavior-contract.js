import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defaultLogger } from "@coinzilla/utils"

const APP_ROOT = fileURLToPath(new URL("../", import.meta.url))
const CONTRACT_PATH = path.join(APP_ROOT, "docs", "critical-behaviors.json")

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
    { cwd: APP_ROOT, encoding: "utf8" },
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
  const affectedBehaviorIds = new Set()

  if (typeof readFile !== "function") {
    return {
      errors: ["A file reader is required to validate critical behavior evidence."],
      affectedBehaviorIds: [],
    }
  }
  if (contract?.schemaVersion !== 1 || !Array.isArray(contract.behaviors)) {
    return {
      errors: ["Critical behavior inventory must use schemaVersion 1 and define behaviors."],
      affectedBehaviorIds: [],
    }
  }
  if (!Array.isArray(contract.criticalPathPrefixes) || contract.criticalPathPrefixes.length === 0) {
    errors.push("Critical behavior inventory must define at least one critical source path prefix.")
  }

  const behaviorIds = new Set()
  const sourceOwners = new Map()
  const validKinds = new Set(["normal", "failure", "integration"])

  for (const behavior of contract.behaviors) {
    if (!behavior || typeof behavior.id !== "string" || behavior.id.length === 0) {
      errors.push("Every critical behavior must have a non-empty stable id.")
      continue
    }
    if (behaviorIds.has(behavior.id)) {
      errors.push(`Critical behavior id ${behavior.id} is duplicated.`)
    }
    behaviorIds.add(behavior.id)

    if (typeof behavior.title !== "string" || behavior.title.length === 0) {
      errors.push(`Critical behavior ${behavior.id} must have a descriptive title.`)
    }
    const runtimeStatuses = new Set(["active", "offline-only", "disabled-by-design"])
    if (!runtimeStatuses.has(behavior.runtimeStatus)) {
      errors.push(`Critical behavior ${behavior.id} must declare its runtimeStatus.`)
    }
    if (
      behavior.runtimeStatus !== "active" &&
      (typeof behavior.limitation !== "string" || behavior.limitation.length === 0)
    ) {
      errors.push(`Critical behavior ${behavior.id} must document its runtime limitation.`)
    }
    if (!Array.isArray(behavior.sourceModules) || behavior.sourceModules.length === 0) {
      errors.push(`Critical behavior ${behavior.id} must identify at least one production source module.`)
    }
    if (!Array.isArray(behavior.tests) || behavior.tests.length === 0) {
      errors.push(`Critical behavior ${behavior.id} must identify named regression tests.`)
      continue
    }

    for (const sourcePath of behavior.sourceModules ?? []) {
      if (!isSafeRelativePath(sourcePath) || !sourcePath.startsWith("src/")) {
        errors.push(`Critical behavior ${behavior.id} has an invalid production source path: ${sourcePath}.`)
        continue
      }
      if (!readContractFile({ readFile, relativePath: sourcePath })) {
        errors.push(`Critical behavior ${behavior.id} references missing production source: ${sourcePath}.`)
      }
      const owners = sourceOwners.get(sourcePath) ?? new Set()
      owners.add(behavior.id)
      sourceOwners.set(sourcePath, owners)
    }

    const testKinds = new Set()
    for (const testCase of behavior.tests) {
      if (
        !testCase ||
        !isSafeRelativePath(testCase.path) ||
        !(testCase.path.startsWith("src/") || testCase.path.startsWith("test/")) ||
        typeof testCase.name !== "string" ||
        testCase.name.length === 0 ||
        !validKinds.has(testCase.kind)
      ) {
        errors.push(`Critical behavior ${behavior.id} contains an invalid named test mapping.`)
        continue
      }
      testKinds.add(testCase.kind)
      const testSource = readContractFile({ readFile, relativePath: testCase.path })
      if (typeof testSource !== "string") {
        errors.push(`Critical behavior ${behavior.id} references missing test file: ${testCase.path}.`)
      } else if (!testSource.includes(testCase.name)) {
        errors.push(`Critical behavior ${behavior.id} references missing regression test "${testCase.name}" in ${testCase.path}.`)
      }
    }

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

  for (const changedPath of changedFiles) {
    if (changedPath.endsWith(".test.js")) {
      continue
    }
    const isCriticalPath = contract.criticalPathPrefixes.some((prefix) =>
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

  return {
    errors,
    affectedBehaviorIds: [...affectedBehaviorIds].sort(),
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
    return
  }

  defaultLogger.info({
    message: "Harvester critical behavior inventory validated",
    behaviorCount: contract.behaviors.length,
    affectedBehaviorIds: result.affectedBehaviorIds,
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCriticalBehaviorContractCheck()
}
