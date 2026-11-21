import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createRepositoryModuleGraphReport } from "./repository-module-graph-report.js"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const report = createRepositoryModuleGraphReport({
  repositoryRoot,
})
const lines = [
  "Repository source dependency graph baseline (report-only)",
  `Production JavaScript modules: ${report.moduleCount}`,
  `Resolved relative dependency edges: ${report.relativeEdgeCount}`,
  `Cycle components: ${report.cycles.length}`,
  ...report.cycles.map((component) => `Cycle component: [${component.join(", ")}]`),
  "Cycle findings are informational; this baseline does not fail CI for existing cycles.",
]

process.stdout.write(`${lines.join("\n")}\n`)
