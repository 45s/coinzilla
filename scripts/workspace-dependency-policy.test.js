import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"

import {
  parseWorkspaceDependencyPolicy,
  readWorkspacePackages,
  validateWorkspaceDependencyPolicy,
} from "./workspace-dependency-policy.js"

const policy = [
  "## Workspace package dependency policy",
  "",
  "| Consumer | Allowed direct workspace dependencies |",
  "| --- | --- |",
  "| `@coinzilla/app` | `@coinzilla/core` |",
  "| `@coinzilla/core` | None |",
  "",
].join("\n")

function createPackages() {
  return [
    {
      name: "@coinzilla/app",
      workspaceDependencies: [
        {
          name: "@coinzilla/core",
          version: "workspace:*",
          section: "dependencies",
        },
      ],
    },
    {
      name: "@coinzilla/core",
      workspaceDependencies: [],
    },
  ]
}

test("parses the canonical package dependency allowlist", () => {
  assert.deepEqual(
    parseWorkspaceDependencyPolicy(policy),
    {
      "@coinzilla/app": ["@coinzilla/core"],
      "@coinzilla/core": [],
    },
    "The policy parser must preserve each package's allowed direct dependencies.",
  )
})

test("rejects a missing policy section and duplicate package rows", () => {
  assert.throws(
    () => parseWorkspaceDependencyPolicy("# No dependency policy here"),
    /Workspace package dependency policy section is missing/,
    "A missing canonical policy section must fail closed.",
  )
  assert.throws(
    () => parseWorkspaceDependencyPolicy(policy.replace(
      "| `@coinzilla/core` | None |",
      "| `@coinzilla/app` | None |",
    )),
    /Duplicate workspace dependency policy row/,
    "Duplicate consumer rows must not be silently overwritten.",
  )
})

test("accepts manifests whose workspace dependencies match the canonical allowlist", () => {
  assert.deepEqual(
    validateWorkspaceDependencyPolicy({
      packages: createPackages(),
      allowedDependencies: parseWorkspaceDependencyPolicy(policy),
    }),
    [],
    "A valid acyclic workspace dependency graph must pass.",
  )
})

test("reports forbidden workspace dependency directions", () => {
  const packages = createPackages()
  packages[1].workspaceDependencies.push({
    name: "@coinzilla/app",
    version: "workspace:*",
    section: "dependencies",
  })
  const violations = validateWorkspaceDependencyPolicy({
    packages,
    allowedDependencies: parseWorkspaceDependencyPolicy(policy),
  })
  assert.ok(
    violations.some((violation) => violation.includes("@coinzilla/core") && violation.includes("@coinzilla/app")),
    "A package importing a forbidden workspace dependency must be identified.",
  )
})

test("detects dependency cycles and prints the cycle path", () => {
  const packages = createPackages()
  packages[1].workspaceDependencies.push({
    name: "@coinzilla/app",
    version: "workspace:*",
    section: "dependencies",
  })
  const cyclePolicy = {
    "@coinzilla/app": ["@coinzilla/core"],
    "@coinzilla/core": ["@coinzilla/app"],
  }
  const violations = validateWorkspaceDependencyPolicy({
    packages,
    allowedDependencies: cyclePolicy,
  })
  assert.ok(
    violations.some((violation) => violation.includes("dependency cycle") &&
      violation.includes("@coinzilla/app") && violation.includes("@coinzilla/core")),
    "A cycle must report the participating packages rather than only a generic failure.",
  )
})

test("rejects stale allowlist entries and missing policy rows", () => {
  const violations = validateWorkspaceDependencyPolicy({
    packages: createPackages(),
    allowedDependencies: {
      "@coinzilla/app": ["@coinzilla/unknown"],
    },
  })
  assert.ok(
    violations.some((violation) => violation.includes("@coinzilla/core") && violation.includes("missing policy")),
    "Every discovered workspace package must have one policy row.",
  )
  assert.ok(
    violations.some((violation) => violation.includes("@coinzilla/unknown") && violation.includes("unknown")),
    "Policy references to packages outside the workspace must be reported.",
  )
})

test("requires workspace protocol for dependencies that target another workspace package", () => {
  const packages = createPackages()
  packages[0].workspaceDependencies[0].version = "^1.0.0"
  const violations = validateWorkspaceDependencyPolicy({
    packages,
    allowedDependencies: parseWorkspaceDependencyPolicy(policy),
  })
  assert.ok(
    violations.some((violation) => violation.includes("@coinzilla/app") &&
      violation.includes("@coinzilla/core") && violation.includes("workspace:")),
    "Workspace package edges must use the workspace protocol instead of a registry version.",
  )
})

test("discovers workspace packages and dependencies from every manifest dependency section", () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-dependency-policy-"))
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n  - "packages/*"\n')
    mkdirSync(join(root, "apps", "app"), { recursive: true })
    mkdirSync(join(root, "packages", "core"), { recursive: true })
    writeFileSync(join(root, "apps", "app", "package.json"), JSON.stringify({
      name: "@coinzilla/app",
      dependencies: {
        "@coinzilla/core": "workspace:*",
        "external-package": "^1.0.0",
      },
      devDependencies: { "@coinzilla/core": "workspace:^" },
    }))
    writeFileSync(join(root, "packages", "core", "package.json"), JSON.stringify({
      name: "@coinzilla/core",
    }))
    assert.deepEqual(
      readWorkspacePackages(root),
      [
        {
          name: "@coinzilla/app",
          workspaceDependencies: [
            { name: "@coinzilla/core", version: "workspace:*", section: "dependencies" },
            {
          name: "@coinzilla/core",
          version: "workspace:^",
          section: "devDependencies",
        },
          ],
        },
        {
          name: "@coinzilla/core",
          workspaceDependencies: [],
        },
      ],
      "The scanner must discover actual workspace packages and include runtime and development edges.",
    )
  } finally {
    rmSync(root, {
      recursive: true,
      force: true,
    })
  }
})
