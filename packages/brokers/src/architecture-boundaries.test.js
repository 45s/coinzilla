import assert from "node:assert/strict"
import test from "node:test"

import {
  findForbiddenDependencies,
  withArchitectureFixture,
} from "./test-helpers/architecture-boundaries.js"

test("broker source dependencies point inward across DDD boundaries", async () => {
  const violations = await findForbiddenDependencies(new URL(".", import.meta.url))
  assert.deepEqual(violations, [])
})

test("architecture enforcement reports forbidden imports with file and specifier", async () => {
  await withArchitectureFixture(async ({ sourceRoot, write }) => {
    await write("domain/policy.js", 'import "../infrastructure/binance/client.js"\n')
    await write("application/session.js", 'import "../infrastructure/binance/adapter.js"\n')
    await write("infrastructure/binance/client.js", "export const client = true\n")
    await write("infrastructure/binance/adapter.js", "export const adapter = true\n")

    const violations = await findForbiddenDependencies(sourceRoot)
    assert.deepEqual(violations, [
      {
        file: "application/session.js",
        import: "../infrastructure/binance/adapter.js",
        target: "infrastructure/binance/adapter.js",
        rule: "application must not depend on infrastructure",
      },
      {
        file: "domain/policy.js",
        import: "../infrastructure/binance/client.js",
        target: "infrastructure/binance/client.js",
        rule: "domain must not depend on infrastructure",
      },
    ])
  })
})

test("architecture enforcement permits inward dependencies and composition", async () => {
  await withArchitectureFixture(async ({ sourceRoot, write }) => {
    await write("domain/policy.js", "export const policy = true\n")
    await write("application/session.js", 'import "../domain/policy.js"\n')
    await write("application/ports/client-port.js", "export const port = true\n")
    await write("infrastructure/binance/adapter.js", 'import "../../application/ports/client-port.js"\nimport "../../domain/policy.js"\n')
    await write("bootstrap/create-broker.js", 'import "../infrastructure/binance/adapter.js"\nimport "../application/session.js"\n')

    assert.deepEqual(await findForbiddenDependencies(sourceRoot), [])
  })
})
