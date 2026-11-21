import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  collectRepositoryJavaScriptModules,
  isProductionModulePath,
} from "./repository-module-discovery.js"

test("includes production JavaScript from apps, packages and repository scripts", () => {
  for (const file of [
    "apps/harvester/src/domain/decision.js",
    "packages/brokers/src/infrastructure/adapter.js",
    "scripts/check-module-graph.js",
  ]) {
    assert.equal(
      isProductionModulePath({ file }),
      true,
      `Production module path "${file}" must be included in the repository scan.`,
    )
  }
})

test("excludes tests, fixtures, generated output and non-source roots", () => {
  for (const file of [
    "apps/harvester/src/domain/decision.test.js",
    "apps/harvester/src/domain/decision.spec.js",
    "apps/harvester/src/__tests__/decision.js",
    "packages/brokers/src/fixtures/broker.js",
    "packages/brokers/src/test-helpers/factory.js",
    "packages/db/dist/index.js",
    "packages/db/node_modules/provider/index.js",
    "docs/examples/example.js",
    "root-script.js",
    "packages/utils/src/index.ts",
  ]) {
    assert.equal(
      isProductionModulePath({ file }),
      false,
      `Non-production module path "${file}" must not enter the source graph.`,
    )
  }
})

test("collects source files deterministically and includes Harvester", () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "coinzilla-module-discovery-"))

  try {
    const files = [
      {
        file: "apps/harvester/src/domain/decision.js",
        source: "export const decision = true\n",
      },
      {
        file: "packages/entities/src/money/value.js",
        source: "export const value = 1\n",
      },
      {
        file: "scripts/check-module-graph.js",
        source: "export const check = true\n",
      },
      {
        file: "apps/harvester/src/domain/decision.test.js",
        source: "throw new Error('test file must be excluded')\n",
      },
      {
        file: "packages/entities/src/fixtures/value.js",
        source: "throw new Error('fixture must be excluded')\n",
      },
    ]

    for (const { file, source } of files) {
      const absolutePath = join(repositoryRoot, ...file.split("/"))
      mkdirSync(join(absolutePath, ".."), { recursive: true })
      writeFileSync(absolutePath, source)
    }

    const modules = collectRepositoryJavaScriptModules({ repositoryRoot })

    assert.deepEqual(
      modules.map(({ file }) => file),
      [
        "apps/harvester/src/domain/decision.js",
        "packages/entities/src/money/value.js",
        "scripts/check-module-graph.js",
      ],
      "The collector must return a stable, sorted production inventory and include Harvester source.",
    )
    assert.deepEqual(
      modules.map(({ source }) => source),
      [
        "export const decision = true\n",
        "export const value = 1\n",
        "export const check = true\n",
      ],
      "The collector must read the source contents associated with each repository-relative path.",
    )
  } finally {
    rmSync(repositoryRoot, {
      recursive: true,
      force: true,
    })
  }
})
