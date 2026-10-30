import test from "node:test"
import assert from "node:assert/strict"
import { prepareJournal } from "./prepare-journal.js"

test("returns a failed result when journal setup throws", () => {
  const result = prepareJournal({
    eventBus: {},
    folderPath: undefined,
    logger: {
      error() {},
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 1)
  assert.ok(result.errors[0] instanceof TypeError)
})

test("preserves the setup error when error logging throws", () => {
  const result = prepareJournal({
    eventBus: {},
    folderPath: undefined,
    logger: {
      error() {
        throw new Error("logger failed")
      },
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 1)
  assert.ok(result.errors[0] instanceof TypeError)
})
