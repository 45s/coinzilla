import assert from "node:assert/strict"
import test from "node:test"
import { OPERATOR_ACTOR_ROLES } from "./constants.js"

test("exposes the immutable trading operator role contract", () => {
  assert.deepEqual(OPERATOR_ACTOR_ROLES, {
    TRADING_OPERATOR: "trading-operator",
  }, "The trusted application actor role must retain its existing authorization contract.")
  assert.equal(Object.isFrozen(OPERATOR_ACTOR_ROLES), true, "Application actor role values must not be mutable at runtime.")
})
