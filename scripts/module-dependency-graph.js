import { posix } from "node:path"

import { extractModuleImports } from "./module-import-analysis.js"
import { resolveRelativeModuleImport } from "./module-import-resolution.js"

const normalizeModulePath = ({ path }) => posix.normalize(path.replaceAll("\\", "/"))

const isRepositoryRelativePath = ({ path }) => (
  path !== ".." &&
  !path.startsWith("../") &&
  !path.startsWith("/")
)

/**
 * Build a deterministic graph for repository JavaScript modules.
 *
 * Nodes include isolated source files. Edges include only relative imports that
 * resolve to another supplied JavaScript module; package and builtin imports
 * are intentionally left for the workspace-package graph.
 *
 * @param {{modules: Array<{file: string, source: string}>}} options
 * @returns {{nodes: string[], edges: Array<{from: string, to: string, specifier: string, kind: string}>}}
 * @throws {Error|SyntaxError} If source paths are duplicated/invalid or source cannot be parsed.
 */
export function createModuleDependencyGraph({ modules }) {
  const sourceByPath = new Map()

  for (const module of modules) {
    const file = normalizeModulePath({ path: module.file })

    if (!isRepositoryRelativePath({ path: file })) {
      throw new Error(`Module source path must remain inside the repository: ${module.file}`)
    }

    if (sourceByPath.has(file)) {
      throw new Error(`Duplicate module source path: ${file}`)
    }

    sourceByPath.set(file, module.source)
  }

  const nodes = [...sourceByPath.keys()].sort()
  const edges = []

  for (const file of nodes) {
    const source = sourceByPath.get(file)
    const imports = extractModuleImports({
      file,
      source,
    })

    for (const { specifier, kind } of imports) {
      const target = resolveRelativeModuleImport({
        importerPath: file,
        specifier,
        sourceFiles: nodes,
      })

      if (target) {
        edges.push({
          from: file,
          to: target,
          specifier,
          kind,
        })
      }
    }
  }

  return {
    nodes,
    edges,
  }
}
