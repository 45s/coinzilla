import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs"
import { join } from "node:path"

const SOURCE_ROOTS = Object.freeze(["apps", "packages", "scripts"])
const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  "build",
  "coverage",
  "dist",
  "fixtures",
  "generated",
  "mocks",
  "node_modules",
  "test",
  "test-helpers",
  "test-support",
  "tests",
  "vendor",
  "__fixtures__",
  "__mocks__",
  "__tests__",
])

const EXCLUDED_FILE_SUFFIXES = Object.freeze([
  ".bench.js",
  ".fixture.js",
  ".generated.js",
  ".mock.js",
  ".spec.js",
  ".stories.js",
  ".test.js",
])

const normalizeRepositoryPath = ({ file }) => file.replaceAll("\\", "/")

/**
 * Determine whether a repository-relative JavaScript path is production source.
 *
 * @param {{file: string}} options
 * @returns {boolean}
 */
export function isProductionModulePath({ file }) {
  const normalizedPath = normalizeRepositoryPath({ file })
  const segments = normalizedPath.split("/")
  const root = segments[0]
  const filename = segments.at(-1)
  const hasExcludedDirectory = segments.some((segment) => (
    EXCLUDED_DIRECTORY_NAMES.has(segment.toLowerCase())
  ))
  const hasExcludedSuffix = EXCLUDED_FILE_SUFFIXES.some((suffix) => (
    filename.endsWith(suffix)
  ))
  const isRepositoryRelative = (
    normalizedPath.length > 0 &&
    !normalizedPath.startsWith("/") &&
    !segments.includes("..")
  )

  return (
    SOURCE_ROOTS.includes(root) &&
    normalizedPath.endsWith(".js") &&
    isRepositoryRelative &&
    !hasExcludedDirectory &&
    !hasExcludedSuffix
  )
}

const walkSourceDirectory = ({ directoryPath, relativeDirectory, modules }) => {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const relativePath = `${relativeDirectory}/${entry.name}`
    const absolutePath = join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
        continue
      }

      walkSourceDirectory({
        directoryPath: absolutePath,
        relativeDirectory: relativePath,
        modules,
      })
      continue
    }

    if (!entry.isFile() || !isProductionModulePath({ file: relativePath })) {
      continue
    }

    modules.push({
      file: relativePath,
      source: readFileSync(absolutePath, "utf8"),
    })
  }
}

/**
 * Collect a deterministic production JavaScript inventory from all workspace
 * applications, packages, and repository scripts. Test/fixture/generated paths
 * are intentionally excluded from the production dependency graph.
 *
 * @param {{repositoryRoot: string}} options
 * @returns {Array<{file: string, source: string}>}
 * @throws {Error} If a required source root is missing or no source modules exist.
 */
export function collectRepositoryJavaScriptModules({ repositoryRoot }) {
  const modules = []

  for (const sourceRoot of SOURCE_ROOTS) {
    const directoryPath = join(repositoryRoot, sourceRoot)

    if (!existsSync(directoryPath)) {
      throw new Error(`Required repository source root is missing: ${sourceRoot}`)
    }

    walkSourceDirectory({
      directoryPath,
      relativeDirectory: sourceRoot,
      modules,
    })
  }

  if (modules.length === 0) {
    throw new Error("No production JavaScript modules were found in apps/, packages/, or scripts/.")
  }

  const modulesByPath = new Map(
    modules.map(({ file, source }) => [file, source]),
  )
  const orderedPaths = [...modulesByPath.keys()].sort()

  return orderedPaths.map((file) => ({
    file,
    source: modulesByPath.get(file),
  }))
}
