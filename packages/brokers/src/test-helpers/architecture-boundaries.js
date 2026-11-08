import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const FORBIDDEN_TARGETS = Object.freeze({
  domain: new Set(["application", "infrastructure", "bootstrap"]),
  application: new Set(["infrastructure", "bootstrap"]),
  infrastructure: new Set(["bootstrap"]),
})

const IMPORT_PATTERN =
  /\b(?:import|export)\s+(?:[^"';`]*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g

async function collectJavaScriptFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relativePath = path.posix.join(prefix, entry.name)
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectJavaScriptFiles(absolutePath, relativePath))
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".js") &&
      !entry.name.endsWith(".test.js") &&
      !entry.name.endsWith(".integration.js")
    ) {
      files.push({ absolutePath, relativePath })
    }
  }
  return files
}

function getLayer(relativePath) {
  const [firstSegment] = relativePath.split("/")
  return FORBIDDEN_TARGETS[firstSegment] ? firstSegment : null
}

function resolveLocalTarget(relativePath, specifier) {
  if (!specifier.startsWith(".")) return null
  return path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), specifier))
}

function findImports(source) {
  const imports = []
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    imports.push(match[1] ?? match[2] ?? match[3])
  }
  return imports
}

/**
 * Return forbidden inward-boundary violations in production JavaScript.
 * Test and opt-in integration files are intentionally excluded from the
 * production dependency graph.
 *
 * @param {string|URL} sourceRoot Absolute path or file URL to packages/brokers/src.
 * @returns {Promise<Array<{file: string, import: string, target: string, rule: string}>>}
 */
export async function findForbiddenDependencies(sourceRoot) {
  const root = sourceRoot instanceof URL ? fileURLToPath(sourceRoot) : sourceRoot
  const files = []
  for (const layer of ["domain", "application", "infrastructure", "bootstrap"]) {
    const directory = path.join(root, layer)
    try {
      files.push(...await collectJavaScriptFiles(directory, layer))
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }

  const entryPoint = path.join(root, "index.js")
  try {
    await readFile(entryPoint, "utf8")
    files.push({ absolutePath: entryPoint, relativePath: "index.js" })
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }

  const violations = []
  for (const file of files) {
    const source = await readFile(file.absolutePath, "utf8")
    const sourceLayer = getLayer(file.relativePath)
    if (!sourceLayer) continue

    for (const specifier of findImports(source)) {
      const targetPath = resolveLocalTarget(file.relativePath, specifier)
      if (!targetPath) continue
      const targetLayer = getLayer(targetPath)
      if (!targetLayer || !FORBIDDEN_TARGETS[sourceLayer].has(targetLayer)) continue

      violations.push({
        file: file.relativePath,
        import: specifier,
        target: targetPath,
        rule: `${sourceLayer} must not depend on ${targetLayer}`,
      })
    }
  }

  return violations.sort((left, right) =>
    left.file.localeCompare(right.file) || left.import.localeCompare(right.import),
  )
}

/** Create a temporary source tree for deterministic negative/control tests. */
export async function withArchitectureFixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "brokers-architecture-"))
  const sourceRoot = path.join(directory, "src")
  await mkdir(sourceRoot, { recursive: true })
  try {
    await run({
      sourceRoot,
      write: async (relativePath, source) => {
        const destination = path.join(sourceRoot, relativePath)
        await mkdir(path.dirname(destination), { recursive: true })
        await writeFile(destination, source)
      },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
