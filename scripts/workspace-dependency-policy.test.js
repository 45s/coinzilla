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

function parsePolicy(markdown) {
  return parseWorkspaceDependencyPolicy({ markdown })
}

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
      publicSubpaths: ["./testing"],
      workspaceDependencies: [],
    },
  ]
}

test("parses the canonical package dependency allowlist", () => {
  assert.deepEqual(
    parsePolicy(policy),
    {
      "@coinzilla/app": ["@coinzilla/core"],
      "@coinzilla/core": [],
    },
    "The policy parser must preserve each package's allowed direct dependencies.",
  )
})

test("rejects a missing policy section and duplicate package rows", () => {
  assert.throws(
    () => parsePolicy("# No dependency policy here"),
    /Workspace package dependency policy section is missing/,
    "A missing canonical policy section must fail closed.",
  )
  assert.throws(
    () => parsePolicy(policy.replace(
      "| `@coinzilla/core` | None |",
      "| `@coinzilla/app` | None |",
    )),
    /Duplicate workspace dependency policy row/,
    "Duplicate consumer rows must not be silently overwritten.",
  )
})

test("rejects malformed dependency policy rows", () => {
  assert.throws(
    () => parsePolicy(policy.replace(
      "| `@coinzilla/core` | None |",
      "| @coinzilla/core | None |",
    )),
    /Malformed workspace dependency policy consumer/,
    "Policy consumers must use the documented package-name cell format.",
  )
})

test("accepts manifests whose workspace dependencies match the canonical allowlist", () => {
  assert.deepEqual(
    validateWorkspaceDependencyPolicy({
      packages: createPackages(),
      allowedDependencies: parseWorkspaceDependencyPolicy({ markdown: policy }),
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
    allowedDependencies: parseWorkspaceDependencyPolicy({ markdown: policy }),
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

test("rejects workspace-protocol dependencies that target an unknown package", () => {
  const packages = createPackages()
  packages[0].workspaceDependencies.push({
    name: "@coinzilla/missing",
    version: "workspace:*",
    section: "dependencies",
  })
  const violations = validateWorkspaceDependencyPolicy({
    packages,
    allowedDependencies: parseWorkspaceDependencyPolicy({ markdown: policy }),
  })
  assert.ok(
    violations.some((violation) => violation.includes("@coinzilla/missing") &&
      violation.includes("unknown workspace package")),
    "A workspace protocol edge without a matching workspace manifest must fail.",
  )
})

test("requires workspace protocol for dependencies that target another workspace package", () => {
  const packages = createPackages()
  packages[0].workspaceDependencies[0].version = "^1.0.0"
  const violations = validateWorkspaceDependencyPolicy({
    packages,
    allowedDependencies: parseWorkspaceDependencyPolicy({ markdown: policy }),
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
      exports: {
        ".": "./src/index.js",
        "./testing": "./test-support/provider-conformance.js",
      },
    }))
    assert.deepEqual(
      readWorkspacePackages({ rootDirectory: root }),
      [
        {
          name: "@coinzilla/app",
          publicSubpaths: [],
          workspaceDependencies: [
            {
              name: "@coinzilla/core",
              version: "workspace:*",
              section: "dependencies",
            },
            {
              name: "@coinzilla/core",
              version: "workspace:^",
              section: "devDependencies",
            },
          ],
        },
        {
          name: "@coinzilla/core",
          publicSubpaths: ["./testing"],
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



test("allows workspace subpaths matched by a declared wildcard export", () => {
  const violations = validateWorkspaceDependencyPolicy({
    packages: [
      {
        name: "@coinzilla/app",
        publicSubpaths: [],
        workspaceDependencies: [],
      },
      {
        name: "@coinzilla/core",
        publicSubpaths: ["./features/*"],
        workspaceDependencies: [],
      },
    ],
    allowedDependencies: {
      "@coinzilla/app": ["@coinzilla/core"],
      "@coinzilla/core": [],
    },
    sourceImports: [
      {
        file: "apps/app/src/feature.js",
        specifier: "@coinzilla/core/features/example",
      },
    ],
  })

  assert.deepEqual(
    violations,
    [],
    "Wildcard package exports must preserve their declared public subpath contract.",
  )
})

test("rejects production imports of private workspace package subpaths", () => {
  const violations = validateWorkspaceDependencyPolicy({
    packages: [
      {
        name: "@coinzilla/app",
        publicSubpaths: [],
        workspaceDependencies: [],
      },
      {
        name: "@coinzilla/core",
        publicSubpaths: [],
        workspaceDependencies: [],
      },
    ],
    allowedDependencies: {
      "@coinzilla/app": ["@coinzilla/core"],
      "@coinzilla/core": [],
    },
    sourceImports: [
      {
        file: "apps/app/src/index.js",
        specifier: "@coinzilla/core/src/internal/value.js",
      },
    ],
  })

  assert.deepEqual(
    violations,
    [
      'apps/app/src/index.js: workspace package import "@coinzilla/core/src/internal/value.js" uses an unexported subpath of "@coinzilla/core".',
    ],
    "Production consumers must use a package root or an explicitly declared public export.",
  )
})

test("allows package roots and explicitly exported workspace subpaths", () => {
  const violations = validateWorkspaceDependencyPolicy({
    packages: [
      {
        name: "@coinzilla/app",
        workspaceDependencies: [],
      },
      {
        name: "@coinzilla/core",
        publicSubpaths: ["./testing", "./features/*"],
        workspaceDependencies: [],
      },
    ],
    allowedDependencies: {
      "@coinzilla/app": ["@coinzilla/core"],
      "@coinzilla/core": [],
    },
    sourceImports: [
      {
        file: "apps/app/src/index.js",
        specifier: "@coinzilla/core",
      },
      {
        file: "apps/app/src/test-support.js",
        specifier: "@coinzilla/core/testing",
      },
      {
        file: "apps/app/src/feature.js",
        specifier: "@coinzilla/core/features/example",
      },
      {
        file: "apps/app/src/node-path.js",
        specifier: "node:path",
      },
      {
        file: "apps/app/src/external.js",
        specifier: "external-package",
      },
    ],
  })

  assert.deepEqual(
    violations,
    [],
    "The root entry point and explicitly exported subpaths must remain importable.",
  )
})

test("rejects unknown workspace package specifiers", () => {
  const violations = validateWorkspaceDependencyPolicy({
    packages: [
      {
        name: "@coinzilla/app",
        workspaceDependencies: [],
      },
    ],
    allowedDependencies: {
      "@coinzilla/app": [],
    },
    sourceImports: [
      {
        file: "apps/app/src/index.js",
        specifier: "@coinzilla/missing",
      },
    ],
  })

  assert.deepEqual(
    violations,
    [
      'apps/app/src/index.js: imports unknown workspace package "@coinzilla/missing".',
    ],
    "Misspelled or undeclared workspace package imports must not pass silently.",
  )
})
