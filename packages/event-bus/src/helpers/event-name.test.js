import test from "node:test"
import assert from "node:assert/strict"

import { isValidEventName } from "./event-name.js"

test("accepts event names using the documented ASCII alphabet", () => {
  for (const name of [
    "a",
    "Z",
    "0",
    "_",
    "order.filled",
    "Trade.Fill_v2:partial",
    "__proto__",
    "error",
    "newListener",
    "removeListener",
  ]) {
    assert.equal(isValidEventName(name), true, name)
  }
})

test("accepts the exact maximum event-name length", () => {
  assert.equal(isValidEventName("a".padEnd(128, ".")), true)
  assert.equal(isValidEventName("a".padEnd(129, ".")), false)
})

test("rejects empty, overlong, non-string, and non-ASCII event names", () => {
  for (const name of [
    "",
    "a".repeat(129),
    " leading",
    "trailing ",
    "contains space",
    "name/slash",
    "name\\nline",
    "name\\u0000control",
    "évent",
    "事件",
    1,
    null,
    undefined,
    {},
    Symbol("event"),
  ]) {
    assert.equal(isValidEventName(name), false, String(name))
  }
})

test("does not coerce or normalize event names", () => {
  assert.equal(isValidEventName("Order.Filled"), true)
  assert.equal(isValidEventName("order.filled"), true)
  assert.equal(isValidEventName("Order.Filled"), true)
  assert.equal(isValidEventName(" Order.Filled"), false)
})
