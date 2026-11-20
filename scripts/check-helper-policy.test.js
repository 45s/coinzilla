import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import {
  findHelperSources,
  analyzeHelperSource,
  findHelperPolicyViolations,
} from "./check-helper-policy.js"

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "helper-policy-"))
  const directory = join(root, "packages", "example", "src", "helpers")
  mkdirSync(directory, { recursive: true })
  return {
    root,
    directory,
  }
}

test("discovers production helper modules and colocated tests", () => {
  const { root, directory } = createFixture()
  try {
    writeFileSync(join(directory, "normalize.js"), "export function normalize({ value }) { return value.trim() }\n")
    writeFileSync(join(directory, "normalize.test.js"), "import test from 'node:test'\n")
    writeFileSync(join(directory, "normalize.fixture.js"), "export const fixture = true\n")

    const sources = findHelperSources(root)

    assert.deepEqual(
      sources.map(({ file, hasTest }) => ({ file, hasTest })),
      [
        {
          file: join(directory, "normalize.js"),
hasTest: true,
        },
      ],
    )
  } finally {
    rmSync(root, { recursive: true,
force: true })
  }
})

test("reports helpers missing a directly associated unit test", () => {
  const { root, directory } = createFixture()
  try {
    writeFileSync(join(directory, "calculate.js"), "export function calculate({ value }) { return value * 2 }\n")
    assert.deepEqual(findHelperPolicyViolations(root), [
      [join(directory, "calculate.js"), ": missing directly associated unit test (calculate.test.js or calculate.spec.js)"].join(""),
    ])
  } finally {
    rmSync(root, { recursive: true,
force: true })
  }
})

test("detects prohibited side-effect APIs and effectful imports", () => {
  assert.deepEqual(
    analyzeHelperSource({
      file: "helpers/effectful.js",
source: "import fs from \"node:fs\"\nexport function read({ path }) { return fs.readFileSync(path) }\nexport function currentTime() { return Date.now() }\n",
    }),
    [
      "helpers/effectful.js: prohibited import from node:fs",
      "helpers/effectful.js: prohibited use of Date.now",
    ],
  )
})

test("detects mutation and stateful classes", () => {
  assert.deepEqual(
    analyzeHelperSource({
      file: "helpers/mutating.js",
source: "export function update({ session }) { session.chronologySource = \"SINGLE_SESSION\"; return session }\nexport class StatefulHelper {}\n",
    }),
    [
      "helpers/mutating.js: possible caller-owned input mutation",
      "helpers/mutating.js: classes are prohibited in helpers",
    ],
  )
})

test("allows pure transforms and deterministic path utilities", () => {
  assert.deepEqual(
    analyzeHelperSource({
      file: "helpers/transform.js",
source: "import path from \"node:path\"\nexport function normalize({ value }) { return path.basename(value.trim()) }\n",
    }),
    [],
  )
})

test("discovers nested helper directories", () => {
  const { root, directory } = createFixture()
  const nestedDirectory = join(directory, "adapters")
  mkdirSync(nestedDirectory)
  try {
    writeFileSync(join(nestedDirectory, "map.js"), "export function map({ value }) { return value }\n")
    writeFileSync(join(nestedDirectory, "map.test.js"), "import test from 'node:test'\n")
    assert.deepEqual(
      findHelperSources(root).map(({ file }) => file),
      [join(nestedDirectory, "map.js")],
    )
  } finally {
    rmSync(root, { recursive: true,
force: true })
  }
})
