import assert from "node:assert/strict"
import test from "node:test"

import { findForbiddenDependencies } from "./test-helpers/architecture-boundaries.js"

test("broker source dependencies point inward across DDD boundaries", async () => {
  const violations = await findForbiddenDependencies(new URL(".", import.meta.url))
  assert.deepEqual(violations, [])
})
