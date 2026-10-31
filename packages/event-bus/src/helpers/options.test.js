import test from "node:test"
import assert from "node:assert/strict"

import { validateOptions } from "./options.js"

const defaultLogger = { error() {} }

test("uses the default logger when options are omitted or logger is absent", () => {
  assert.deepEqual(validateOptions({}, defaultLogger), {
    logger: defaultLogger,
    onError: undefined,
  })
  assert.deepEqual(validateOptions({ onError() {} }, defaultLogger), {
    logger: defaultLogger,
    onError: validateOptions({ onError() {} }, defaultLogger).onError,
  })
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

  assert.deepEqual(validateOptions(options, defaultLogger), {
    logger: defaultLogger,
    onError: undefined,
  })
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
  for (const logger of [null, undefined, "logger", 1, () => {}]) {
    if (logger === undefined) continue // Undefined selects the documented default.
    assert.throws(() => validateOptions({ logger }, defaultLogger), /logger must be an object/)
  }

  for (const error of [true, "not-a-function", 1, null]) {
    assert.throws(
      () => validateOptions({ logger: { error } }, defaultLogger),
      /optional error function/,
    )
  }

  assert.deepEqual(validateOptions({ logger: {} }, defaultLogger), {
    logger: {},
    onError: undefined,
  })
})

test("rejects non-function error reporters", () => {
  for (const onError of [null, true, "handler", {}]) {
    assert.throws(
      () => validateOptions({ onError }, defaultLogger),
      /onError must be a function/,
    )
  }
})
