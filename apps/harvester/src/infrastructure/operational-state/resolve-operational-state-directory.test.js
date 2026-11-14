import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import {
  DEFAULT_OPERATIONAL_STATE_DIRECTORY,
  resolveOperationalStateDirectory,
} from "./resolve-operational-state-directory.js"

const expectedPackageDirectory = fileURLToPath(new URL("../../../recovery-facts", import.meta.url))

test("anchors the default operational-state directory to the Harvester package", () => {
  assert.equal(DEFAULT_OPERATIONAL_STATE_DIRECTORY, expectedPackageDirectory)
  assert.equal(path.basename(DEFAULT_OPERATIONAL_STATE_DIRECTORY), "recovery-facts")
  assert.equal(path.basename(path.dirname(DEFAULT_OPERATIONAL_STATE_DIRECTORY)), "harvester")
})

test("uses the package-local default when no canonical override is configured", () => {
  assert.equal(resolveOperationalStateDirectory({ env: {} }), expectedPackageDirectory)
})

test("ignores the removed legacy environment variable instead of selecting its path", () => {
  assert.equal(
    resolveOperationalStateDirectory({ env: { DURABLE_FACTS_DIRECTORY: "/home/operator/.coinzilla/harvester/recovery-facts" } }),
    expectedPackageDirectory,
  )
})

test("accepts and normalizes only an absolute canonical override", () => {
  assert.equal(
    resolveOperationalStateDirectory({ env: { OPERATIONAL_STATE_DIRECTORY: "/tmp/operational-state/../harvester-state" } }),
    path.resolve("/tmp/operational-state/../harvester-state"),
  )
})

test("rejects relative canonical overrides", () => {
  assert.throws(
    () => resolveOperationalStateDirectory({ env: { OPERATIONAL_STATE_DIRECTORY: "recovery-facts" } }),
    /OPERATIONAL_STATE_DIRECTORY must be a non-empty absolute local filesystem path/,
  )
})
