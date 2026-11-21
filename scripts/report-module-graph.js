import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createRepositoryModuleGraphReport } from "./repository-module-graph-report.js"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const report = createRepositoryModuleGraphReport({
  repositoryRoot,
})

console.log("Repository source dependency graph baseline (report-only)")
console.log(`Production JavaScript modules: ${report.moduleCount}`)
console.log(`Resolved relative dependency edges: ${report.relativeEdgeCount}`)
console.log(`Cycle components: ${report.cycles.length}`)

for (const component of report.cycles) {
  console.log(`Cycle component: [${component.join(", ")}]`)
}

console.log("Cycle findings are informational; this baseline does not fail CI for existing cycles.")
