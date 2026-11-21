import { collectRepositoryJavaScriptModules } from "./repository-module-discovery.js"
import { createModuleDependencyGraph } from "./module-dependency-graph.js"
import { findDependencyCycles } from "./module-dependency-cycles.js"

/**
 * Create a non-blocking baseline report for the repository's production source graph.
 *
 * Cycle components are reported as data and do not make this function fail. The
 * caller decides when reviewed architectural rules are ready to become gates.
 *
 * @param {{repositoryRoot: string}} options
 * @returns {{mode: "report-only", moduleCount: number, relativeEdgeCount: number, cycles: string[][]}}
 */
export function createRepositoryModuleGraphReport({ repositoryRoot }) {
  const modules = collectRepositoryJavaScriptModules({
    repositoryRoot,
  })
  const graph = createModuleDependencyGraph({
    modules,
  })
  const cycles = findDependencyCycles(graph)

  return {
    mode: "report-only",
    moduleCount: graph.nodes.length,
    relativeEdgeCount: graph.edges.length,
    cycles,
  }
}
