import assert from "node:assert/strict"
import test from "node:test"

import { findPendingMigrations } from "./migration-history.js"

const migration = (version, name = `migration-${version}`) => ({
  version,
  name,
  up() {},
})

test("finds only registered migrations that have not been applied", () => {
  assert.deepEqual(
    findPendingMigrations(
      [migration(1), migration(2), migration(3)],
      [{ version: 1, name: "migration-1" }],
    ).map(({ version }) => version),
    [2, 3],
  )
})

test("accepts a fully applied migration history", () => {
  assert.deepEqual(
    findPendingMigrations(
      [migration(1), migration(2)],
      [
        { version: 1, name: "migration-1" },
        { version: 2, name: "migration-2" },
      ],
    ),
    [],
  )
})

test("rejects removed or renamed applied migrations", () => {
  assert.throws(
    () => findPendingMigrations([migration(2)], [{ version: 1, name: "migration-1" }]),
    /history mismatch at version 1/,
  )
  assert.throws(
    () => findPendingMigrations([migration(1, "renamed")], [{ version: 1, name: "migration-1" }]),
    /history mismatch at version 1/,
  )
})
