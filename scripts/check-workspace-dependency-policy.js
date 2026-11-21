import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { extractModuleImports } from "./module-import-analysis.js"
import { collectRepositoryJavaScriptModules } from "./repository-module-discovery.js"
import {
  parseWorkspaceDependencyPolicy,
  readWorkspacePackages,
  validateWorkspaceDependencyPolicy,
} from "./workspace-dependency-policy.js"

const rootDirectory = resolve(fileURLToPath(import.meta.url), "../..")
const policyPath = resolve(rootDirectory, "docs/engineering/DOMAIN_OWNERSHIP.md")
const policyMarkdown = readFileSync(policyPath, "utf8")
const allowedDependencies = parseWorkspaceDependencyPolicy({ markdown: policyMarkdown })
const packages = readWorkspacePackages({ rootDirectory })
const modules = collectRepositoryJavaScriptModules({ repositoryRoot: rootDirectory })
const sourceImports = modules.flatMap(({ file, source }) => (
  extractModuleImports({ file, source }).map(({ specifier }) => ({
    file,
    specifier,
  }))
))
const violations = validateWorkspaceDependencyPolicy({
  packages,
  allowedDependencies,
  sourceImports,
})

if (violations.length > 0) {
  process.stderr.write([
    "Workspace package boundary policy violations:\n",
    violations.map((violation) => `- ${violation}\n`).join(""),
    "Update the owning package contract and canonical dependency policy together; do not bypass this check.\n",
  ].join(""))
  process.exitCode = 1
} else {
  process.stdout.write([
    "Workspace package dependency and public-import policy passed for " +
      packages.length + " packages (" +
      sourceImports.filter(({ specifier }) => specifier.startsWith("@coinzilla/")).length +
      " static workspace imports).\n",
  ].join(""))
}
