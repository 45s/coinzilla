import assert from "node:assert/strict"
import test from "node:test"
import { parseHealthcheckMode } from "./parse-healthcheck-mode.js"

test("default Bitunix health-check mode remains read-only report publishing", () => {
  assert.equal(parseHealthcheckMode({ args: [] }), "publish")
})

test("explicit CLI arguments select each supported mode", () => {
  assert.equal(parseHealthcheckMode({ args: ["--local"] }), "local")
  assert.equal(parseHealthcheckMode({ args: ["--publish"] }), "publish")
  assert.equal(parseHealthcheckMode({ args: ["--place-order"] }), "place-order")
  assert.equal(parseHealthcheckMode({ args: ["--probe-order=limit-buy-1"] }), "probe-order")
  assert.equal(parseHealthcheckMode({ args: ["--help"] }), "help")
  assert.equal(parseHealthcheckMode({ args: ["--version"] }), "version")
})

test("unknown, empty and conflicting CLI modes fail before a command is run", () => {
  assert.throws(() => parseHealthcheckMode({ args: ["--place-order", "--local"] }), /only one.*mode/i)
  assert.throws(() => parseHealthcheckMode({ args: ["--force"] }), /only one.*mode/i)
  assert.throws(() => parseHealthcheckMode({ args: ["--probe-order="] }), /only one.*mode/i)
  assert.throws(() => parseHealthcheckMode({ args: [null] }), /array of strings/i)
})
