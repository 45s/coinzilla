import { existsSync, readFileSync, readdirSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"

const DEPENDENCY_SECTIONS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
])

const PACKAGE_NAME_PATTERN = /^@coinzilla\/[a-z0-9-]+$/

/**
 * Parse the workspace dependency allowlist from the canonical Domain Ownership document.
 * @param {string} markdown Canonical Domain Ownership Markdown.
 * @returns {Record<string, string[]>}
 */
export function parseWorkspaceDependencyPolicy(markdown) {
  const heading = "## Workspace package dependency policy"
  const headingIndex = markdown.indexOf(heading)
  if (headingIndex < 0) {
    throw new Error("Workspace package dependency policy section is missing.")
  }

  const section = markdown.slice(headingIndex + heading.length).split(/^## /m)[0]
  const tableLines = section.split(/\r?\n/).filter((line) => line.trim().startsWith("|"))
  if (tableLines.length < 3) {
    throw new Error("Workspace package dependency policy table is incomplete.")
  }

  const headerCells = parseTableCells(tableLines[0])
  if (
    headerCells.length !== 2 ||
    headerCells[0] !== "Consumer" ||
    headerCells[1] !== "Allowed direct workspace dependencies"
  ) {
    throw new Error("Workspace package dependency policy table has an unexpected header.")
  }

  const separatorCells = parseTableCells(tableLines[1])
  if (separatorCells.length !== 2 || separatorCells.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
    throw new Error("Workspace package dependency policy table has an invalid separator.")
  }

  const allowedDependencies = {}
  for (const line of tableLines.slice(2)) {
    const cells = parseTableCells(line)
    if (cells.length !== 2) {
      throw new Error("Malformed workspace dependency policy row; expected exactly two cells.")
    }

    const consumer = parsePackageNameCell(cells[0], "consumer")
    if (Object.hasOwn(allowedDependencies, consumer)) {
      throw new Error(`Duplicate workspace dependency policy row for ${consumer}.`)
    }

    const dependencies = parseAllowedDependencyCell(cells[1])
    if (new Set(dependencies).size !== dependencies.length) {
      throw new Error(`Duplicate allowed dependency in workspace dependency policy row for ${consumer}.`)
    }
    allowedDependencies[consumer] = dependencies.sort()
  }

  if (Object.keys(allowedDependencies).length === 0) {
    throw new Error("Workspace package dependency policy contains no package rows.")
  }

  return allowedDependencies
}

/**
 * Discover direct-child workspace packages and their declared workspace dependencies.
 * @param {string} rootDirectory Repository root.
 * @returns {Array<{name: string, workspaceDependencies: Array<{name: string, version: string, section: string}>}>}
 */
export function readWorkspacePackages(rootDirectory) {
  const workspaceFile = resolve(rootDirectory, "pnpm-workspace.yaml")
  const workspaceContent = readFileSync(workspaceFile, "utf8")
  const workspaceLines = workspaceContent.split(/\r?\n/)
  const packagesHeadingIndex = workspaceLines.findIndex((line) => line.trim() === "packages:")
  if (packagesHeadingIndex < 0) {
    throw new Error("pnpm-workspace.yaml is missing its packages section.")
  }

  const patterns = []
  for (const line of workspaceLines.slice(packagesHeadingIndex + 1)) {
    if (line.trim() === "") {
      continue
    }
    if (!/^\s/.test(line)) {
      break
    }

    const match = line.match(/^\s*-\s*["']([^"']+)["']\s*$/)
    if (!match) {
      throw new Error(`Unsupported pnpm workspace package pattern line: ${line.trim()}.`)
    }
    patterns.push(match[1])
  }

  if (patterns.length === 0) {
    throw new Error("pnpm-workspace.yaml contains no supported workspace package patterns.")
  }

  const manifests = []
  for (const pattern of patterns) {
    if (!pattern.endsWith("/*") || pattern.includes("..") || isAbsolute(pattern)) {
      throw new Error(`Unsupported workspace package pattern "${pattern}"; expected a safe direct-child /* pattern.`)
    }

    const parentRelativePath = pattern.slice(0, -2)
    const parentDirectory = resolve(rootDirectory, parentRelativePath)
    const relativeParentPath = relative(resolve(rootDirectory), parentDirectory)
    if (relativeParentPath.startsWith("..") || isAbsolute(relativeParentPath)) {
      throw new Error(`Workspace package pattern escapes the repository root: "${pattern}".`)
    }
    if (!existsSync(parentDirectory)) {
      throw new Error(`Workspace package directory does not exist: ${parentRelativePath}.`)
    }

    const entries = readdirSync(parentDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const manifestPath = resolve(parentDirectory, entry.name, "package.json")
      if (!existsSync(manifestPath)) {
        continue
      }

      let manifest
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
      } catch (error) {
        throw new Error(`Could not parse workspace package manifest ${relative(resolve(rootDirectory), manifestPath)}: ${error.message}`, {
          cause: error,
        })
      }

      if (typeof manifest.name !== "string" || manifest.name.trim() === "") {
        throw new Error(`Workspace package manifest is missing a package name: ${relative(resolve(rootDirectory), manifestPath)}.`)
      }
      manifests.push({
        name: manifest.name,
        manifest,
      })
    }
  }

  const packageNames = new Set()
  for (const entry of manifests) {
    if (packageNames.has(entry.name)) {
      throw new Error(`Duplicate workspace package manifest name: ${entry.name}.`)
    }
    packageNames.add(entry.name)
  }

  return manifests.map(({ name, manifest }) => {
    const workspaceDependencies = []
    for (const section of DEPENDENCY_SECTIONS) {
      const dependencies = manifest[section] ?? {}
      if (typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies)) {
        throw new Error(`Workspace package ${name} has an invalid ${section} object.`)
      }

      for (const [dependencyName, version] of Object.entries(dependencies)) {
        if (packageNames.has(dependencyName) || (typeof version === "string" && version.startsWith("workspace:"))) {
          workspaceDependencies.push({
            name: dependencyName,
            version,
            section,
          })
        }
      }
    }

    workspaceDependencies.sort((left, right) =>
      left.name.localeCompare(right.name) || left.section.localeCompare(right.section),
    )
    return {
      name,
      workspaceDependencies,
    }
  }).sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Validate workspace package manifests against the canonical allowlist and detect cycles.
 * @param {{packages: Array<{name: string, workspaceDependencies: Array<{name: string, version: string, section: string}>}>, allowedDependencies: Record<string, string[]>}} options
 * @returns {string[]}
 */
export function validateWorkspaceDependencyPolicy({ packages, allowedDependencies }) {
  const violations = []
  const packagesByName = new Map()
  for (const workspacePackage of packages) {
    if (packagesByName.has(workspacePackage.name)) {
      violations.push(`Duplicate workspace package manifest name: ${workspacePackage.name}.`)
      continue
    }
    packagesByName.set(workspacePackage.name, workspacePackage)
  }

  const packageNames = new Set(packagesByName.keys())
  const policyNames = new Set(Object.keys(allowedDependencies))

  for (const packageName of packageNames) {
    if (!policyNames.has(packageName)) {
      violations.push(`Workspace package ${packageName} is missing a dependency policy row.`)
    }
  }
  for (const policyName of policyNames) {
    if (!packageNames.has(policyName)) {
      violations.push(`Dependency policy contains unknown workspace package ${policyName}.`)
    }
  }

  for (const [consumer, allowedTargets] of Object.entries(allowedDependencies)) {
    if (!Array.isArray(allowedTargets)) {
      violations.push(`Dependency policy row for ${consumer} must contain an array of allowed packages.`)
      continue
    }
    for (const target of allowedTargets) {
      if (!packageNames.has(target)) {
        violations.push(`Dependency policy for ${consumer} references unknown workspace package ${target}.`)
      }
    }
  }

  const dependencyGraph = new Map()
  for (const [packageName, workspacePackage] of packagesByName) {
    const allowedTargets = new Set(allowedDependencies[packageName] ?? [])
    const actualTargets = new Set()
    const graphTargets = new Set()

    for (const dependency of workspacePackage.workspaceDependencies) {
      const { name: target, version, section } = dependency
      if (!packageNames.has(target)) {
        violations.push(`Workspace package ${packageName} declares ${target} in ${section}, but no matching workspace package manifest exists.`)
        continue
      }

      if (typeof version !== "string" || !version.startsWith("workspace:")) {
        violations.push(`Workspace dependency ${packageName} -> ${target} in ${section} must use the workspace: protocol.`)
      }
      if (!allowedTargets.has(target)) {
        violations.push(`Forbidden workspace dependency ${packageName} -> ${target} in ${section}; update the dependency policy only after owner approval.`)
      }

      actualTargets.add(target)
      graphTargets.add(target)
    }

    for (const target of actualTargets) {
      if (!allowedTargets.has(target)) {
        continue
      }
    }
    dependencyGraph.set(packageName, [...graphTargets].sort())
  }

  const visitState = new Map()
  const traversalStack = []
  const reportedCycles = new Set()

  function visitPackage(packageName) {
    visitState.set(packageName, "visiting")
    traversalStack.push(packageName)

    for (const dependencyName of dependencyGraph.get(packageName) ?? []) {
      if (visitState.get(dependencyName) === "visiting") {
        const cycleStartIndex = traversalStack.indexOf(dependencyName)
        const cyclePath = [...traversalStack.slice(cycleStartIndex), dependencyName]
        const cycleDescription = cyclePath.join(" -> ")
        if (!reportedCycles.has(cycleDescription)) {
          violations.push(`Workspace package dependency cycle detected: ${cycleDescription}.`)
          reportedCycles.add(cycleDescription)
        }
      } else if (visitState.get(dependencyName) !== "visited") {
        visitPackage(dependencyName)
      }
    }

    traversalStack.pop()
    visitState.set(packageName, "visited")
  }

  for (const packageName of [...packageNames].sort()) {
    if (!visitState.has(packageName)) {
      visitPackage(packageName)
    }
  }

  return [...new Set(violations)].sort()
}

function parseTableCells(line) {
  const trimmedLine = line.trim()
  if (!trimmedLine.startsWith("|") || !trimmedLine.endsWith("|")) {
    return []
  }
  return trimmedLine.slice(1, -1).split("|").map((cell) => cell.trim())
}

function parsePackageNameCell(cell, cellLabel) {
  const match = cell.match(/^`(@coinzilla\/[a-z0-9-]+)`$/)
  if (!match || !PACKAGE_NAME_PATTERN.test(match[1])) {
    throw new Error(`Malformed workspace dependency policy ${cellLabel}: ${cell}.`)
  }
  return match[1]
}

function parseAllowedDependencyCell(cell) {
  if (cell === "None") {
    return []
  }

  const dependencies = cell.split(",").map((value) => parsePackageNameCell(value.trim(), "dependency"))
  return dependencies
}
