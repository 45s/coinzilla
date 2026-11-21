import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

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
const violations = validateWorkspaceDependencyPolicy({
  packages,
  allowedDependencies,
})

if (violations.length > 0) {
  process.stderr.write([
    "Workspace dependency policy violations:\n",
    violations.map((violation) => `- ${violation}\n`).join(""),
    "Update the owning package contract and canonical dependency policy together; do not bypass this check.\n",
  ].join(""))
  process.exitCode = 1
} else {
  process.stdout.write([
    `Workspace dependency policy passed for ${packages.length} packages.\n`,
  ].join(""))
}
