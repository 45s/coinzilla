import assert from "node:assert/strict"
import test from "node:test"

import { compareDecimal } from "./decimal.js"

test("public decimal subpath exposes exact comparison without loading Node-only utilities", () => {
  assert.equal(compareDecimal({ left: "1.10", right: "1.2" }), -1)
  assert.equal(compareDecimal({ left: "12.00", right: "12" }), 0)
  assert.equal(compareDecimal({ left: "12.01", right: "12" }), 1)
})
