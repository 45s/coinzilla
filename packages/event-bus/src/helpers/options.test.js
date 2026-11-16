import test from "node:test"
import assert from "node:assert/strict"

import { validateOptions } from "./options.js"

const defaultLogger = { error() {} }

function validate(options) {
  return validateOptions({
    options,
    defaultLogger,
  })
}

test("uses the default logger when options are empty or omit logger", () => {
  const emptyOptions = validate({})
  assert.equal(emptyOptions.logger, defaultLogger)
  assert.equal(emptyOptions.onError, undefined)

  const onError = () => {}
  const optionsWithReporter = validate({ onError })
  assert.equal(optionsWithReporter.logger, defaultLogger)
  assert.equal(optionsWithReporter.onError, onError)
})

test("accepts supported options and preserves supplied references", () => {
  const logger = { error() {} }
  const onError = () => {}
  const result = validate({
    logger,
    onError,
  })

  assert.equal(result.logger, logger)
  assert.equal(result.onError, onError)
})

test("accepts a null-prototype plain options object", () => {
  const options = Object.create(null)
  options.logger = defaultLogger

  const result = validate(options)
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
      () => validate(options),
      {
        name: "TypeError",
        message: "EventBus options must be a plain object",
      },
    )
  }
})

test("rejects unknown string and symbol option keys", () => {
  assert.throws(
    () => validate({ loger: {} }),
    /Unknown EventBus option: loger/,
  )

  const options = { logger: defaultLogger }
  options[Symbol("unexpected")] = true
  assert.throws(
    () => validate(options),
    /Unknown EventBus option: Symbol\(unexpected\)/,
  )
})

test("rejects invalid logger values and error methods", () => {
  for (const logger of [null, "logger", 1, () => {}]) {
    assert.throws(
      () => validate({ logger }),
      /logger must be an object/,
    )
  }

  for (const error of [true, "not-a-function", 1, null]) {
    assert.throws(
      () => validate({
        logger: { error },
      }),
      /optional error function/,
    )
  }

  const loggerWithoutError = {}
  assert.equal(
    validate({ logger: loggerWithoutError }).logger,
    loggerWithoutError,
  )
})

test("rejects non-function error reporters", () => {
  for (const onError of [null, true, "handler", {}]) {
    assert.throws(
      () => validate({ onError }),
      /onError must be a function/,
    )
  }
})

test("uses the default pending-delivery limit", () => {
  assert.equal(validate({}).maxPending, 1000)
})

test("accepts a positive safe-integer pending-delivery limit", () => {
  for (const maxPending of [1, 2, Number.MAX_SAFE_INTEGER]) {
    assert.equal(validate({ maxPending }).maxPending, maxPending)
  }
})

test("rejects invalid pending-delivery limits", () => {
  for (const maxPending of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "10", null]) {
    assert.throws(
      () => validate({ maxPending }),
      /maxPending must be a positive safe integer/,
    )
  }
})
