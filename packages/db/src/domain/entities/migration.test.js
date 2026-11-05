import assert from "node:assert/strict"
import test from "node:test"

import { createMigration } from "../../entities/migration.js"

test("a migration has a positive integer version, a unique name, and an up operation", () => {
  const up = () => {}
  const migration = createMigration({ version: 1, name: "create-users", up })

  assert.equal(migration.version, 1)
  assert.equal(migration.name, "create-users")
  assert.equal(migration.up, up)
})

test("migration identity is its version and the entity is immutable", () => {
  const migration = createMigration({
    version: 7,
    name: "add-user-status",
    up() {},
  })

  assert.ok(Object.isFrozen(migration))
  assert.throws(() => {
    migration.name = "renamed"
  }, TypeError)
})

test("migration rejects invalid versions, names, and operations", () => {
  const up = () => {}
  const invalidMigrations = [
    [{ version: 0, name: "zero", up }, /positive safe integer/],
    [{ version: -1, name: "negative", up }, /positive safe integer/],
    [{ version: 1.5, name: "fraction", up }, /positive safe integer/],
    [{ version: Number.MAX_SAFE_INTEGER + 1, name: "unsafe", up }, /positive safe integer/],
    [{ version: 1, name: "", up }, /non-empty name/],
    [{ version: 1, name: "  ", up }, /non-empty name/],
    [{ version: 1, name: "missing-up" }, /up function/],
    [{ version: 1, name: "invalid-up", up: null }, /up function/],
  ]

  for (const [options, expectedError] of invalidMigrations) {
    assert.throws(() => createMigration(options), expectedError)
  }
})

test("migration rejects async functions before they can run", () => {
  let invoked = false

  assert.throws(() => createMigration({
    version: 1,
    name: "async",
    async up() {
      invoked = true
    },
  }), /must be synchronous/)

  assert.equal(invoked, false)
})
