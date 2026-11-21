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
 * @param {{markdown: string}} options
 * @returns {Record<string, string[]>}
 */
export function parseWorkspaceDependencyPolicy({ markdown }) {
  const heading = "## Workspace package dependency policy"
  const headingIndex = markdown.indexOf(heading)
  if (headingIndex < 0) {
    throw new Error("Workspace package dependency policy section is missing.")
  }

  const [section] = markdown.slice(headingIndex + heading.length).split(/^## /m)
  const tableLines = section.split(/\r?\n/).filter((line) => line.trim().startsWith("|"))
  if (tableLines.length < 3) {
    throw new Error("Workspace package dependency policy table is incomplete.")
  }

  const headerCells = parseTableCells({ line: tableLines[0] })
  if (
    headerCells.length !== 2 ||
    headerCells[0] !== "Consumer" ||
    headerCells[1] !== "Allowed direct workspace dependencies"
  ) {
    throw new Error("Workspace package dependency policy table has an unexpected header.")
  }

  const separatorCells = parseTableCells({ line: tableLines[1] })
  if (separatorCells.length !== 2 || separatorCells.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
    throw new Error("Workspace package dependency policy table has an invalid separator.")
  }

  const allowedDependencies = {}
  for (const line of tableLines.slice(2)) {
    const cells = parseTableCells({ line })
    if (cells.length !== 2) {
      throw new Error("Malformed workspace dependency policy row; expected exactly two cells.")
    }

    const consumer = parsePackageNameCell({
      cell: cells[0],
      cellLabel: "consumer",
    })
    if (Object.hasOwn(allowedDependencies, consumer)) {
      throw new Error(`Duplicate workspace dependency policy row for ${consumer}.`)
    }

    const dependencies = parseAllowedDependencyCell({ cell: cells[1] })
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
 * @param {{rootDirectory: string}} options
 * @returns {Array<{name: string, publicSubpaths: string[], workspaceDependencies: Array<{name: string, version: string, section: string}>}>}
 */
export function readWorkspacePackages({ rootDirectory }) {
  const patterns = readWorkspacePatterns({ rootDirectory })
  const manifests = readWorkspaceManifests({
    rootDirectory,
    patterns,
  })
  const packageNames = new Set(manifests.map((entry) => entry.name))

  return manifests.map(({ name, manifest }) => ({
    name,
    publicSubpaths: readWorkspacePackagePublicSubpaths({ manifest }),
    workspaceDependencies: readWorkspacePackageDependencies({
      manifest,
      packageNames,
      packageName: name,
    }),
  }))
}

function readWorkspacePatterns({ rootDirectory }) {
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
  return patterns.sort()
}

function readWorkspaceManifests({ rootDirectory, patterns }) {
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

    const entryNames = readdirSync(parentDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    for (const entryName of entryNames) {
      const manifestPath = resolve(parentDirectory, entryName, "package.json")
      if (!existsSync(manifestPath)) {
        continue
      }
      manifests.push(readWorkspaceManifest({
        manifestPath,
        rootDirectory,
      }))
    }
  }

  const packageNames = new Set()
  for (const entry of manifests) {
    if (packageNames.has(entry.name)) {
      throw new Error(`Duplicate workspace package manifest name: ${entry.name}.`)
    }
    packageNames.add(entry.name)
  }
  return manifests
}

function readWorkspaceManifest({ manifestPath, rootDirectory }) {
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
  return {
    name: manifest.name,
    manifest,
  }
}

function readWorkspacePackagePublicSubpaths({ manifest }) {
  const { exports } = manifest
  if (typeof exports !== "object" || exports === null || Array.isArray(exports)) {
    return []
  }

  return Object.entries(exports)
    .filter(([subpath, target]) => subpath.startsWith("./") && target !== null)
    .map(([subpath]) => subpath)
    .sort()
}

function readWorkspacePackageDependencies({ manifest, packageNames, packageName }) {
  const workspaceDependencies = []
  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = manifest[section] ?? {}
    if (typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies)) {
      throw new Error(`Workspace package ${packageName} has an invalid ${section} object.`)
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
  return workspaceDependencies
}

/**
 * Validate workspace package manifests against the canonical allowlist and detect cycles.
 * @param {{packages: Array<{name: string, publicSubpaths?: string[], workspaceDependencies: Array<{name: string, version: string, section: string}>}>, allowedDependencies: Record<string, string[]>, sourceImports?: Array<{file: string, specifier: string}>}} options
 * @returns {string[]}
 */
export function validateWorkspaceDependencyPolicy({ packages, allowedDependencies, sourceImports = [] }) {
  const packagesByName = new Map()
  const violations = []
  for (const workspacePackage of packages) {
    if (packagesByName.has(workspacePackage.name)) {
      violations.push(`Duplicate workspace package manifest name: ${workspacePackage.name}.`)
    } else {
      packagesByName.set(workspacePackage.name, workspacePackage)
    }
  }

  const packageNames = new Set(packagesByName.keys())
  violations.push(...findPolicyDeclarationViolations({
    packageNames,
    allowedDependencies,
  }))
  const { dependencyGraph, edgeViolations } = buildWorkspaceDependencyGraph({
    packagesByName,
    allowedDependencies,
  })
  violations.push(...edgeViolations)
  violations.push(...findWorkspaceDependencyCycles({ dependencyGraph }))
  violations.push(...findWorkspacePackageImportViolations({
    packagesByName,
    sourceImports,
  }))
  return [...new Set(violations)].sort()
}

function findWorkspacePackageImportViolations({ packagesByName, sourceImports }) {
  const violations = []

  for (const { file, specifier } of sourceImports) {
    const match = typeof specifier === "string"
      ? specifier.match(/^(@coinzilla\/[a-z0-9-]+)(?:\/(.*))?$/)
      : null
    if (!match) {
      continue
    }

    const [, packageName, subpath] = match
    const workspacePackage = packagesByName.get(packageName)
    if (!workspacePackage) {
      violations.push(file + ': imports unknown workspace package "' + packageName + '".')
      continue
    }
    if (subpath === undefined) {
      continue
    }

    const requestedSubpath = "./" + subpath
    const publicSubpaths = workspacePackage.publicSubpaths ?? []
    const isPublicSubpath = publicSubpaths.some((exportedSubpath) => (
      matchesWorkspacePackageExport({
        requestedSubpath,
        exportedSubpath,
      })
    ))
    if (!isPublicSubpath) {
      violations.push(file + ': workspace package import "' + specifier + '" uses an unexported subpath of "' + packageName + '".')
    }
  }

  return violations
}

function matchesWorkspacePackageExport({ requestedSubpath, exportedSubpath }) {
  const wildcardIndex = exportedSubpath.indexOf("*")
  if (wildcardIndex < 0) {
    return requestedSubpath === exportedSubpath
  }
  if (exportedSubpath.indexOf("*", wildcardIndex + 1) >= 0) {
    return false
  }

  const prefix = exportedSubpath.slice(0, wildcardIndex)
  const suffix = exportedSubpath.slice(wildcardIndex + 1)
  if (!requestedSubpath.startsWith(prefix) || !requestedSubpath.endsWith(suffix)) {
    return false
  }

  const wildcardValue = requestedSubpath.slice(prefix.length, requestedSubpath.length - suffix.length)
  return wildcardValue.length > 0
}

function findPolicyDeclarationViolations({ packageNames, allowedDependencies }) {
  const violations = []
  const policyNames = new Set(Object.keys(allowedDependencies))
  for (const packageName of packageNames) {
    if (!policyNames.has(packageName)) {
      violations.push(`Workspace package ${packageName} is missing policy row for allowed workspace dependencies.`)
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
  return violations
}

function buildWorkspaceDependencyGraph({ packagesByName, allowedDependencies }) {
  const dependencyGraph = new Map()
  const violations = []
  for (const [packageName, workspacePackage] of packagesByName) {
    const allowedTargets = new Set(allowedDependencies[packageName] ?? [])
    const graphTargets = new Set()
    for (const dependency of workspacePackage.workspaceDependencies) {
      const { name: target, version, section } = dependency
      if (!packagesByName.has(target)) {
        violations.push(`Workspace package ${packageName} references unknown workspace package ${target} in ${section}; add the missing manifest or correct the dependency.`)
        continue
      }
      if (typeof version !== "string" || !version.startsWith("workspace:")) {
        violations.push(`Workspace dependency ${packageName} -> ${target} in ${section} must use the workspace: protocol.`)
      }
      if (!allowedTargets.has(target)) {
        violations.push(`Forbidden workspace dependency ${packageName} -> ${target} in ${section}; update the dependency policy only after owner approval.`)
      }
      graphTargets.add(target)
    }
    dependencyGraph.set(packageName, [...graphTargets].sort())
  }
  return {
    dependencyGraph,
    edgeViolations: violations,
  }
}

function findWorkspaceDependencyCycles({ dependencyGraph }) {
  const violations = []
  const visitState = new Map()
  const traversalStack = []
  const reportedCycles = new Set()

  function visitPackage({ packageName }) {
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
        visitPackage({ packageName: dependencyName })
      }
    }
    traversalStack.pop()
    visitState.set(packageName, "visited")
  }

  for (const packageName of [...dependencyGraph.keys()].sort()) {
    if (!visitState.has(packageName)) {
      visitPackage({ packageName })
    }
  }
  return violations
}

function parseTableCells({ line }) {
  const trimmedLine = line.trim()
  if (!trimmedLine.startsWith("|") || !trimmedLine.endsWith("|")) {
    return []
  }
  return trimmedLine.slice(1, -1).split("|").map((cell) => cell.trim())
}

function parsePackageNameCell({ cell, cellLabel }) {
  const match = cell.match(/^`(@coinzilla\/[a-z0-9-]+)`$/)
  if (!match || !PACKAGE_NAME_PATTERN.test(match[1])) {
    throw new Error(`Malformed workspace dependency policy ${cellLabel}: ${cell}.`)
  }
  return match[1]
}

function parseAllowedDependencyCell({ cell }) {
  if (cell === "None") {
    return []
  }
  return cell.split(",").map((value) => parsePackageNameCell({
    cell: value.trim(),
    cellLabel: "dependency",
  }))
}
