import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import {
  analyzeModuleFilename,
  findModuleNamingViolations,
  findChangedModuleNamingViolations,
} from "./check-module-naming.js"

const createFixture = () => {
  const root = mkdtempSync(join(tmpdir(), "module-naming-"))
  return { root }
}

test("rejects catch-all module names and redundant helper or utility suffixes", () => {
  for (const file of ["helper.js", "helpers.js", "utils.js", "common.js", "misc.js"]) {
    assert.deepEqual(
      analyzeModuleFilename({ file }),
      [`${file}: vague module filename`],
      `${file} must be rejected as a catch-all module name`,
    )
  }

  for (const file of ["account-utils.js", "runtime-helpers.js", "value-helper.js", "balance-util.js"]) {
    assert.deepEqual(
      analyzeModuleFilename({ file }),
      [`${file}: redundant helper/utility filename suffix`],
      `${file} must be rejected for a redundant helper/utility suffix`,
    )
  }
})

test("allows descriptive module names and locally scoped adapters", () => {
  for (const file of [
    "state-predicates.js",
    "testnet-account-balances.js",
    "reconcile-journal-account-snapshot-records.js",
    "adapter.js",
    "constants.js",
    "index.js",
  ]) {
    assert.deepEqual(
      analyzeModuleFilename({ file }),
      [],
      `${file} communicates a responsibility or has an unambiguous local role`,
    )
  }
})

test("scans production JavaScript across apps, packages, and repository scripts", () => {
  const { root } = createFixture()
  const app = join(root, "apps", "example", "src")
  const pkg = join(root, "packages", "example", "src")
  const scripts = join(root, "scripts")
  const ignored = join(root, "apps", "example", "node_modules", "vendor")
  mkdirSync(app, { recursive: true })
  mkdirSync(pkg, { recursive: true })
  mkdirSync(scripts, { recursive: true })
  mkdirSync(ignored, { recursive: true })

  try {
    writeFileSync(join(app, "helpers.js"), "export const value = true\n")
    writeFileSync(join(app, "helpers.test.js"), "export const test = true\n")
    writeFileSync(join(app, "fixture-utils.fixture.js"), "export const fixture = true\n")
    writeFileSync(join(pkg, "testnet-utils.js"), "export const value = true\n")
    writeFileSync(join(pkg, "adapter.js"), "export const value = true\n")
    writeFileSync(join(scripts, "runtime-helpers.js"), "export const value = true\n")
    writeFileSync(join(ignored, "ignored-utils.js"), "export const value = true\n")

    assert.deepEqual(
      findModuleNamingViolations({ root }),
      [
        "apps/example/src/helpers.js: vague module filename",
        "packages/example/src/testnet-utils.js: redundant helper/utility filename suffix",
        "scripts/runtime-helpers.js: redundant helper/utility filename suffix",
      ].sort(),
      "the full scan must inspect all production source areas and ignore tests, fixtures, and vendored files",
    )
  } finally {
    rmSync(root, {
      recursive: true,
      force: true,
    })
  }
})

test("checks only changed existing production module paths", () => {
  const { root } = createFixture()
  const app = join(root, "apps", "example", "src")
  const scripts = join(root, "scripts")
  mkdirSync(app, { recursive: true })
  mkdirSync(scripts, { recursive: true })

  try {
    writeFileSync(join(app, "testnet-utils.js"), "export const value = true\n")
    writeFileSync(join(scripts, "legacy-helper.js"), "export const value = true\n")
    writeFileSync(join(app, "valid-module.js"), "export const value = true\n")
    writeFileSync(join(app, "valid-module.test.js"), "export const test = true\n")

    assert.deepEqual(
      findChangedModuleNamingViolations({
        root,
        changedPaths: [
          "apps/example/src/testnet-utils.js",
          "scripts/legacy-helper.js",
          "apps/example/src/valid-module.js",
          "apps/example/src/valid-module.test.js",
          "apps/example/src/deleted-common.js",
          "docs/readme.md",
        ],
      }),
      [
        "apps/example/src/testnet-utils.js: redundant helper/utility filename suffix",
        "scripts/legacy-helper.js: redundant helper/utility filename suffix",
      ],
      "the changed-file scan must ignore deleted paths, tests, documentation, and correctly named modules",
    )
  } finally {
    rmSync(root, {
      recursive: true,
      force: true,
    })
  }
})
