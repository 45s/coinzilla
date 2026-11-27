import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

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
  "test",
  "tests",
  "test-support",
  "test-helpers",
  "test-utils",
  "__tests__",
  "__fixtures__",
  "mocks",
  "__mocks__",
  "spec",
  "specs",
  "testdata",
  "test-fixtures",
  "spec-fixtures",
  "__test__",
  "__snapshots__",
  "snapshots",
  "e2e",
  "integration-test",
  "integration-tests",
])
const SOURCE_EXTENSION = /\.(?:js|mjs|cjs)$/
const NON_PRODUCTION_EXTENSION = /\.(?:test|spec|fixture|e2e)\.(?:js|mjs|cjs)$/

function isProductionSource({ path }) {
  const fileName = path.split(/[\\/]/).at(-1)
  return SOURCE_EXTENSION.test(fileName) && !NON_PRODUCTION_EXTENSION.test(fileName)
}

function collectProductionSources({ root, relativeDirectory, files }) {
  const absoluteDirectory = join(root, relativeDirectory)
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = [relativeDirectory, entry.name].join("/")
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        collectProductionSources({
          root,
          relativeDirectory: relativePath,
          files,
        })
      }
      continue
    }
    if (entry.isFile() && isProductionSource({ path: relativePath })) {
      files.push(relativePath)
    }
  }
}

function compareLargeModules(...values) {
  const [left, right] = values
  if (right.lines !== left.lines) {
    return right.lines - left.lines
  }
  if (left.path < right.path) {
    return -1
  }
  if (left.path > right.path) {
    return 1
  }
  return 0
}

function countSourceLines({ root, path }) {
  const source = readFileSync(join(root, path), "utf8")
  const lines = source.split(/\r?\n/)
  if (lines.at(-1) === "") {
    lines.pop()
  }
  return lines.length
}

/**
 * Return production JavaScript modules above the requested review threshold.
 * The count excludes a trailing newline and does not include test/spec/fixture files.
 * @param {{ root: string, threshold?: number }} options
 * @returns {{ path: string, lines: number }[]}
 */
export function findLargeProductionModules({ root, threshold = 500 } = {}) {
  if (typeof root !== "string" || root.length === 0) {
    throw new TypeError("root must be a non-empty repository path")
  }
  if (!Number.isSafeInteger(threshold) || threshold < 1) {
    throw new TypeError("threshold must be a positive safe integer")
  }

  const sources = []
  for (const area of SOURCE_AREAS) {
    if (existsSync(join(root, area))) {
      collectProductionSources({
        root,
        relativeDirectory: area,
        files: sources,
      })
    }
  }

  const largeModules = []
  for (const path of sources) {
    const lines = countSourceLines({
      root,
      path,
    })
    if (lines > threshold) {
      largeModules.push({
        path,
        lines,
      })
    }
  }

  return largeModules.sort(compareLargeModules)
}

/**
 * Format the report without treating file size as a failure.
 * @param {{ modules: { path: string, lines: number }[], threshold: number }} options
 * @returns {string}
 */
export function formatLargeProductionModuleReport({ modules, threshold }) {
  if (modules.length === 0) {
    return `No production modules exceed the ${threshold}-line review threshold.\n`
  }
  const rows = modules.map(({ path, lines }) => `- ${path} (${lines} lines)`).join("\n")
  return [
    `Production modules over ${threshold} lines (report-only; size is not a failure):`,
    rows,
    "",
  ].join("\n")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const threshold = 500
  const modules = findLargeProductionModules({
    root,
    threshold,
  })
  process.stdout.write(formatLargeProductionModuleReport({
    modules,
    threshold,
  }))
}
