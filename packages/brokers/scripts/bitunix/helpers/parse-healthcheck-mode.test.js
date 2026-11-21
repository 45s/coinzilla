import assert from "node:assert/strict"
import test from "node:test"
import { parseBitunixHealthcheckMode } from "./parse-healthcheck-mode.js"

test("default Bitunix health-check mode remains read-only report publishing", () => {
  assert.equal(parseBitunixHealthcheckMode({ args: [] }), "publish")
})

test("explicit CLI arguments select each supported mode", () => {
  assert.equal(parseBitunixHealthcheckMode({ args: ["--local"] }), "local")
  assert.equal(parseBitunixHealthcheckMode({ args: ["--publish"] }), "publish")
  assert.equal(parseBitunixHealthcheckMode({ args: ["--place-order"] }), "place-order")
  assert.equal(parseBitunixHealthcheckMode({ args: ["--help"] }), "help")
})

test("unknown and conflicting CLI modes fail before a command is run", () => {
  assert.throws(() => parseBitunixHealthcheckMode({ args: ["--place-order", "--local"] }), /only one.*mode/i)
  assert.throws(() => parseBitunixHealthcheckMode({ args: ["--force"] }), /only one.*mode/i)
  assert.throws(() => parseBitunixHealthcheckMode({ args: [null] }), /array of strings/i)
})
