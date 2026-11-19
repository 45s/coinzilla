import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as utils from "./index.js"

describe("@coinzilla/utils public validation API", () => {
  it("does not expose the retired Validator and VR compatibility API", () => {
    assert.equal(
      utils.Validator,
      undefined,
      "The public Utils entry point must not expose the retired Validator facade after ensure becomes the supported API",
    )
    assert.equal(
      utils.VR,
      undefined,
      "The public Utils entry point must not expose the retired declarative VR rule set",
    )
  })
})
