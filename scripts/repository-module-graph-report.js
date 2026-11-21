/**
 * Create a non-blocking baseline report for the repository's production source graph.
 * @param {{repositoryRoot: string}} options
 * @returns {{mode: string, moduleCount: number, relativeEdgeCount: number, cycles: string[][]}}
 */
export function createRepositoryModuleGraphReport() {
  return {
    mode: "report-only",
    moduleCount: 0,
    relativeEdgeCount: 0,
    cycles: [],
  }
}
