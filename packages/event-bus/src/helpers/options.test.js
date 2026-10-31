import test from "node:test"
import assert from "node:assert/strict"

import { validateOptions } from "./options.js"

const defaultLogger = { error() {} }

test("uses the default logger when options are empty or omit logger", () => {
  const emptyOptions = validateOptions({}, defaultLogger)
  assert.equal(emptyOptions.logger, defaultLogger)
  assert.equal(emptyOptions.onError, undefined)

  const onError = () => {}
  const optionsWithReporter = validateOptions({ onError }, defaultLogger)
  assert.equal(optionsWithReporter.logger, defaultLogger)
  assert.equal(optionsWithReporter.onError, onError)
})

test("accepts supported options and preserves supplied references", () => {
  const logger = { error() {} }
  const onError = () => {}
  const result = validateOptions({ logger, onError }, defaultLogger)

  assert.equal(result.logger, logger)
  assert.equal(result.onError, onError)
})

test("accepts a null-prototype plain options object", () => {
  const options = Object.create(null)
  options.logger = defaultLogger

  const result = validateOptions(options, defaultLogger)
  assert.equal(result.logger, defaultLogger)
  assert.equal(result.onError, undefined)
})

test("rejects non-plain constructor options", () => {
  for (const options of [
    null,
    undefined,
    [],
    "options",
    42,
    new Date(),
    new (class Options {})(),
  ]) {
    assert.throws(
      () => validateOptions(options, defaultLogger),
      { name: "TypeError", message: "EventBus options must be a plain object" },
    )
  }
})

test("rejects unknown string and symbol option keys", () => {
  assert.throws(
    () => validateOptions({ loger: {} }, defaultLogger),
    /Unknown EventBus option: loger/,
  )

  const options = { logger: defaultLogger }
  options[Symbol("unexpected")] = true
  assert.throws(
    () => validateOptions(options, defaultLogger),
    /Unknown EventBus option: Symbol\(unexpected\)/,
  )
})

test("rejects invalid logger values and error methods", () => {
  for (const logger of [null, "logger", 1, () => {}]) {
    assert.throws(() => validateOptions({ logger }, defaultLogger), /logger must be an object/)
  }

  for (const error of [true, "not-a-function", 1, null]) {
    assert.throws(
      () => validateOptions({ logger: { error } }, defaultLogger),
      /optional error function/,
    )
  }

  const loggerWithoutError = {}
  assert.equal(validateOptions({ logger: loggerWithoutError }, defaultLogger).logger, loggerWithoutError)
})

test("rejects non-function error reporters", () => {
  for (const onError of [null, true, "handler", {}]) {
    assert.throws(
      () => validateOptions({ onError }, defaultLogger),
      /onError must be a function/,
    )
  }
})

test("uses the default pending-delivery limit", () => {
  assert.equal(validateOptions({}, defaultLogger).maxPending, 1000)
})

test("accepts a positive safe-integer pending-delivery limit", () => {
  for (const maxPending of [1, 2, Number.MAX_SAFE_INTEGER]) {
    assert.equal(validateOptions({ maxPending }, defaultLogger).maxPending, maxPending)
  }
})

test("rejects invalid pending-delivery limits", () => {
  for (const maxPending of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "10", null]) {
    assert.throws(
      () => validateOptions({ maxPending }, defaultLogger),
      /maxPending must be a positive safe integer/,
    )
  }
})
