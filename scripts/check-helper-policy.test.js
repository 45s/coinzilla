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
  return { root, directory }
}

test("discovers production helper modules and their directly associated tests", () => {
  const { root, directory } = createFixture()
  try {
    writeFileSync(join(directory, "normalize.js"), "export function normalize({ value }) { return value.trim() }\n")
    writeFileSync(join(directory, "normalize.test.js"), "import test from 'node:test'\n")
    writeFileSync(join(directory, "normalize.test-fixture.js"), "export const fixture = true\n")

    const sources = findHelperSources(root)

    assert.deepEqual(
      sources.map(({ file, hasTest }) => ({ file, hasTest })),
      [{ file: join(directory, "normalize.js"), hasTest: true }],
      "The policy scanner must discover production helpers while excluding tests and fixture files.",
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("reports helper modules without a directly associated unit test", () => {
  const { root, directory } = createFixture()
  try {
    writeFileSync(join(directory, "calculate.js"), "export function calculate({ value }) { return value * 2 }\n")

    const violations = findHelperPolicyViolations(root)

    assert.deepEqual(
      violations,
      [join(directory, "calculate.js") + ": missing directly associated unit test (calculate.test.js or calculate.spec.js)"],
      "Every production helper module must have a colocated unit test with a matching filename.",
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("detects prohibited side-effect APIs and effectful imports", () => {
  const violations = analyzeHelperSource({
    file: "helpers/effectful.js",
    source: "import fs from \\\"node:fs\\\"\nexport function read({ path }) { return fs.readFileSync(path) }\nexport function currentTime() { return Date.now() }\n",
  })

  assert.deepEqual(
    violations,
    [
      "helpers/effectful.js: prohibited import from node:fs",
      "helpers/effectful.js: prohibited use of Date.now",
    ],
    "Helpers must not depend on filesystem I/O or wall-clock time.",
  )
})

test("detects mutation of caller-owned input and stateful classes", () => {
  const violations = analyzeHelperSource({
    file: "helpers/mutating.js",
    source: "export function update({ session }) { session.chronologySource = \\\"SINGLE_SESSION\\\"; return session }\nexport class StatefulHelper {}\n",
  })

  assert.deepEqual(
    violations,
    [
      "helpers/mutating.js: mutation of caller-owned input is prohibited",
      "helpers/mutating.js: stateful classes are prohibited in helpers",
    ],
    "Helpers must not mutate inputs or define stateful classes.",
  )
})

test("allows deterministic pure transformations and path utilities", () => {
  const violations = analyzeHelperSource({
    file: "helpers/transform.js",
    source: "import path from \\\"node:path\\\"\nexport function normalize({ value }) { const normalized = value.trim(); return path.basename(normalized) }\n",
  })

  assert.deepEqual(
    violations,
    [],
    "Pure transformations and deterministic node:path utilities must remain allowed.",
  )
})
