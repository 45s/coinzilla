import assert from "node:assert/strict"
import test from "node:test"

import { SystemCustomError } from "./index.js"

test("uses the base name and preserves native Error behavior", () => {
  const error = new SystemCustomError("operation failed")

  assert.ok(error instanceof Error)
  assert.equal(error.name, "SystemCustomError")
  assert.equal(error.message, "operation failed")
  assert.match(error.stack, /SystemCustomError: operation failed/)
  assert.equal(Object.hasOwn(error, "cause"), false)
})

test("uses the concrete subclass name without requiring a subclass constructor", () => {
  class MarketDataReadError extends SystemCustomError {}

  const error = new MarketDataReadError("market data unavailable")

  assert.ok(error instanceof SystemCustomError)
  assert.ok(error instanceof Error)
  assert.equal(error.name, "MarketDataReadError")
})

test("preserves native cause identity for Error and non-Error causes", () => {
  const cause = new TypeError("socket closed")
  const error = new SystemCustomError("request failed", { cause })
  const nonErrorCause = "remote failure"
  const wrappedValue = new SystemCustomError("remote request failed", {
    cause: nonErrorCause,
  })

  assert.strictEqual(error.cause, cause, "The original Error cause must not be cloned or replaced.")
  assert.strictEqual(wrappedValue.cause, nonErrorCause, "Native Error cause may preserve a non-Error thrown value.")
})

test("exposes optional code, safe context, and retryable fields as immutable diagnostics", () => {
  const sourceContext = {
    component: "market-data",
    operation: "read",
    symbol: "BTCUSDT",
    attempt: 2,
    recovered: false,
    optionalId: null,
  }
  const error = new SystemCustomError("market data read failed", {
    code: "MARKET_DATA_READ_FAILED",
    context: sourceContext,
    retryable: true,
  })

  sourceContext.symbol = "ETHUSDT"

  assert.equal(error.code, "MARKET_DATA_READ_FAILED")
  assert.deepEqual(error.context, {
    component: "market-data",
    operation: "read",
    symbol: "BTCUSDT",
    attempt: 2,
    recovered: false,
    optionalId: null,
  })
  assert.equal(Object.isFrozen(error.context), true)
  assert.equal(error.retryable, true)
  assert.equal(Object.getOwnPropertyDescriptor(error, "code").writable, false)
  assert.equal(Object.getOwnPropertyDescriptor(error, "context").writable, false)
  assert.equal(Object.getOwnPropertyDescriptor(error, "retryable").writable, false)
  assert.throws(() => {
    error.context.symbol = "ETHUSDT"
  }, TypeError, "A stored error context must not be mutable.")
})

test("omits optional diagnostic fields when they are not supplied", () => {
  const error = new SystemCustomError("operation failed")

  assert.equal(Object.hasOwn(error, "code"), false)
  assert.equal(Object.hasOwn(error, "context"), false)
  assert.equal(Object.hasOwn(error, "retryable"), false)
})

test("accepts undefined optional fields as omitted", () => {
  const error = new SystemCustomError("operation failed", {
    code: undefined,
    context: undefined,
    retryable: undefined,
  })

  assert.equal(Object.hasOwn(error, "code"), false)
  assert.equal(Object.hasOwn(error, "context"), false)
  assert.equal(Object.hasOwn(error, "retryable"), false)
})

test("rejects invalid messages and non-record options", () => {
  for (const message of ["", "   ", 1, null, undefined]) {
    assert.throws(
      () => new SystemCustomError(message),
      TypeError,
      "Error messages must be non-empty strings.",
    )
  }

  for (const options of [null, [], new Date(), new Error("not options")]) {
    assert.throws(
      () => new SystemCustomError("operation failed", options),
      TypeError,
      "Options must be a plain record.",
    )
  }
})

test("rejects unknown options instead of silently accepting misspelled diagnostics", () => {
  assert.throws(
    () => new SystemCustomError("operation failed", {
      retryable: true,
      retriable: true,
    }),
    /unsupported option.*retriable/i,
  )
})

test("validates stable codes and retry classification", () => {
  for (const code of ["", "   ", 1, null]) {
    assert.throws(
      () => new SystemCustomError("operation failed", { code }),
      TypeError,
      "A supplied code must be a non-empty string.",
    )
  }

  for (const retryable of ["true", 1, null]) {
    assert.throws(
      () => new SystemCustomError("operation failed", { retryable }),
      TypeError,
      "A supplied retryable classification must be boolean.",
    )
  }
})

test("requires context to be a plain record of safe scalar values", () => {
  for (const context of [null, [], new Date(), "symbol=BTCUSDT"]) {
    assert.throws(
      () => new SystemCustomError("operation failed", { context }),
      TypeError,
      "Context must be a plain record.",
    )
  }

  for (const context of [
    { request: { headers: { authorization: "secret" } } },
    { values: ["BTCUSDT"] },
    { amount: 1n },
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { value: undefined },
  ]) {
    assert.throws(
      () => new SystemCustomError("operation failed", { context }),
      TypeError,
      "Context values must be detached JSON-safe scalars, not mutable payload objects.",
    )
  }
})

test("rejects context accessors and symbol keys without invoking getters", () => {
  let getterCalls = 0
  const context = {}
  Object.defineProperty(context, "symbol", {
    enumerable: true,
    get() {
      getterCalls += 1
      return "BTCUSDT"
    },
  })

  assert.throws(
    () => new SystemCustomError("operation failed", { context }),
    TypeError,
    "Context accessors must not execute while an error is constructed.",
  )
  assert.equal(getterCalls, 0)

  const symbolContext = { symbol: "BTCUSDT" }
  symbolContext[Symbol("private")] = "value"
  assert.throws(
    () => new SystemCustomError("operation failed", { context: symbolContext }),
    TypeError,
    "Context keys must be stable string identifiers.",
  )
})

test("preserves native non-enumerable cause options", () => {
  const cause = new Error("underlying failure")
  const options = {}
  Object.defineProperty(options, "cause", {
    value: cause,
    enumerable: false,
  })

  const error = new SystemCustomError("operation failed", options)

  assert.strictEqual(error.cause, cause)
})

test("accepts null-prototype context records and falls back for anonymous subclasses", () => {
  const context = Object.create(null)
  context.symbol = "BTCUSDT"
  const error = new SystemCustomError("operation failed", { context })
  const anonymousError = new (class extends SystemCustomError {})("anonymous failure")

  assert.deepEqual(error.context, { symbol: "BTCUSDT" })
  assert.equal(anonymousError.name, "SystemCustomError")
})

test("rejects option accessors, symbol options, and unreadable records", () => {
  let getterCalls = 0
  const accessorOptions = {}
  Object.defineProperty(accessorOptions, "code", {
    enumerable: true,
    get() {
      getterCalls += 1
      return "UNSAFE_CODE"
    },
  })

  assert.throws(
    () => new SystemCustomError("operation failed", accessorOptions),
    TypeError,
  )
  assert.equal(getterCalls, 0)

  const symbolOptions = { code: "VALID_CODE" }
  symbolOptions[Symbol("unknown")] = true
  assert.throws(
    () => new SystemCustomError("operation failed", symbolOptions),
    /unsupported option/i,
  )

  const unreadableOptions = new Proxy({}, {
    getPrototypeOf() {
      throw new Error("proxy trap")
    },
  })
  assert.throws(
    () => new SystemCustomError("operation failed", unreadableOptions),
    /readable plain record/i,
  )
})

test("rejects non-enumerable context facts", () => {
  const context = {}
  Object.defineProperty(context, "symbol", {
    value: "BTCUSDT",
    enumerable: false,
  })

  assert.throws(
    () => new SystemCustomError("operation failed", { context }),
    /enumerable data properties/i,
  )
})

test("preserves an explicit non-retryable classification", () => {
  const error = new SystemCustomError("permanent validation failure", {
    retryable: false,
  })

  assert.equal(Object.hasOwn(error, "retryable"), true)
  assert.equal(error.retryable, false)
})
