import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const SOURCE_AREAS = ["apps", "packages", "scripts"]
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "generated",
  "vendor",
  "fixtures",
  "tests",
])
const VAGUE_MODULE_NAMES = new Set([
  "helper",
  "helpers",
  "utils",
  "common",
  "misc",
])
const REDUNDANT_HELPER_SUFFIX = /(?:-|_)(?:helper|helpers|util|utils)$/
const SOURCE_EXTENSION = /\.(?:js|mjs|cjs)$/
const NON_PRODUCTION_EXTENSION = /\.(?:test|spec|fixture)\.(?:js|mjs|cjs)$/

const normalizeSourcePath = ({ path }) => path.replaceAll("\\", "/")

const isProductionModulePath = ({ path }) => {
  const normalizedPath = normalizeSourcePath({ path })
  const isInSourceArea = SOURCE_AREAS.some((area) =>
    normalizedPath.startsWith(`${area}/`),
  )
  const fileName = normalizedPath.split("/").at(-1)

  return (
    isInSourceArea &&
    SOURCE_EXTENSION.test(fileName) &&
    !NON_PRODUCTION_EXTENSION.test(fileName)
  )
}

/**
 * Find vague or redundant production module filenames.
 * @param {{ file: string }} options
 * @returns {string[]}
 */
export function analyzeModuleFilename({ file }) {
  const fileName = file.split(/[\\/]/).at(-1)
  const extension = fileName.match(/\.(js|mjs|cjs)$/)?.[0]
  if (!extension) {
    return []
  }

  const stem = fileName.slice(0, -extension.length)
  if (VAGUE_MODULE_NAMES.has(stem)) {
    return [`${file}: vague module filename`]
  }

  if (REDUNDANT_HELPER_SUFFIX.test(stem)) {
    return [`${file}: redundant helper/utility filename suffix`]
  }

  return []
}

const collectProductionModuleSources = ({ root, relativeDirectory, files }) => {
  const absoluteDirectory = join(root, relativeDirectory)

  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = [relativeDirectory, entry.name].join("/")
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        collectProductionModuleSources({
          root,
          relativeDirectory: relativePath,
          files,
        })
      }
      continue
    }

    if (entry.isFile() && isProductionModulePath({ path: relativePath })) {
      files.push(relativePath)
    }
  }
}

/**
 * Discover production JavaScript modules across applications, packages and scripts.
 * @param {string} root Repository root.
 * @returns {string[]}
 */
export function findProductionModuleSources(root) {
  const files = []

  for (const area of SOURCE_AREAS) {
    if (existsSync(join(root, area))) {
      collectProductionModuleSources({
        root,
        relativeDirectory: area,
        files,
      })
    }
  }

  return files.sort()
}

/**
 * Scan all production modules for catch-all names and redundant suffixes.
 * @param {string} root Repository root.
 * @returns {string[]}
 */
export function findModuleNamingViolations(root) {
  const violations = []

  for (const file of findProductionModuleSources(root)) {
    violations.push(...analyzeModuleFilename({ file }))
  }

  return violations.sort()
}

/**
 * Scan only changed, existing production module paths.
 * @param {{ root: string, changedPaths: string[] }} options
 * @returns {string[]}
 */
export function findChangedModuleNamingViolations({ root, changedPaths }) {
  const violations = []

  for (const changedPath of changedPaths) {
    const path = normalizeSourcePath({ path: changedPath })
    if (!isProductionModulePath({ path })) {
      continue
    }

    if (!existsSync(join(root, path))) {
      continue
    }

    violations.push(...analyzeModuleFilename({ file: path }))
  }

  return violations.sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const changedNames = process.argv.includes("--changed")
  const baseSha = process.argv.find((argument) => /^[a-f0-9]{40}$/.test(argument))
  let violations

  if (changedNames && !baseSha) {
    violations = ["Changed module-name check requires an exact 40-character base SHA"]
  } else if (changedNames) {
    const diffOutput = execFileSync(
      "git",
      ["diff", "--name-only", `${baseSha}..HEAD`],
      {
        cwd: root,
        encoding: "utf8",
      },
    )
    violations = findChangedModuleNamingViolations({
      root,
      changedPaths: diffOutput.split(/\r?\n/).filter(Boolean),
    })
  } else {
    violations = findModuleNamingViolations(root)
  }

  if (violations.length > 0) {
    process.stderr.write([
      "Production module naming violations:\n",
      violations.map((violation) => `- ${violation}\n`).join(""),
    ].join(""))
    process.exitCode = 1
  } else {
    process.stdout.write("Production module naming policy passed for all scanned source files.\n")
  }
}
