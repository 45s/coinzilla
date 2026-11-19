import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ensure } from "./index.js"

describe("ensure direct assertions", () => {
  it("returns accepted values unchanged for primitive assertions", () => {
    assert.equal(ensure.string({ value: "", name: "label" }), "", "string assertion must accept empty strings without coercion")
    assert.equal(ensure.nonEmptyString({ value: "  BTC  ", name: "symbol" }), "  BTC  ", "non-empty string assertion must validate trimmed content but preserve the original string")
    assert.equal(ensure.boolean({ value: false, name: "enabled" }), false, "boolean assertion must accept false without treating it as missing")
    assert.equal(ensure.number({ value: 0, name: "amount" }), 0, "finite number assertion must accept zero")
    assert.equal(ensure.integer({ value: -3, name: "count" }), -3, "integer assertion must accept signed integer values")
    assert.equal(ensure.safeInteger({ value: Number.MAX_SAFE_INTEGER, name: "count" }), Number.MAX_SAFE_INTEGER, "safe integer assertion must accept the upper safe boundary")
    assert.equal(ensure.function({ value: () => {}, name: "callback" }) instanceof Function, true, "function assertion must return the accepted function")
  })

  it("validates integer and numeric inclusive ranges", () => {
    assert.equal(ensure.integerInRange({ value: 250, min: 250, max: 60000, name: "intervalMs" }), 250, "integer range must include its lower bound")
    assert.equal(ensure.integerInRange({ value: 60000, min: 250, max: 60000, name: "intervalMs" }), 60000, "integer range must include its upper bound")
    assert.equal(ensure.numberInRange({ value: 1.25, min: 1, max: 2, name: "ratio" }), 1.25, "numeric range must accept finite decimals within inclusive bounds")
    assert.equal(ensure.positiveInteger({ value: 1, name: "attempts" }), 1, "positive integer assertion must accept one")
    assert.equal(ensure.nonNegativeInteger({ value: 0, name: "offset" }), 0, "non-negative integer assertion must accept zero")
  })

  it("validates array shapes and elements without mutating input", () => {
    const symbols = ["BTC", "ETH"]
    assert.equal(ensure.array({ value: symbols, name: "symbols" }), symbols, "array assertion must preserve the original array identity")
    assert.equal(ensure.nonEmptyArray({ value: symbols, name: "symbols" }), symbols, "non-empty array assertion must preserve the original array identity")
    assert.equal(ensure.strings({ value: symbols, name: "symbols" }), symbols, "string-array assertion must preserve the original array identity")
    assert.equal(ensure.nonEmptyStrings({ value: symbols, name: "symbols" }), symbols, "non-empty string-array assertion must preserve the original array identity")
    assert.equal(ensure.unique({ value: symbols, name: "symbols" }), symbols, "unique assertion must preserve the original array identity")
    assert.deepEqual(symbols, ["BTC", "ETH"], "array assertions must not mutate caller-owned arrays")
  })

  it("validates object, plain-object, defined, nullable and choice constraints", () => {
    const record = Object.create(null)
    record.value = 1
    assert.equal(ensure.object({ value: record, name: "record" }), record, "object assertion must accept null-prototype objects")
    assert.equal(ensure.plainObject({ value: record, name: "record" }), record, "plain-object assertion must accept null-prototype records")
    assert.equal(ensure.defined({ value: null, name: "nullable" }), null, "defined assertion must allow null")
    assert.equal(ensure.notNull({ value: false, name: "enabled" }), false, "not-null assertion must allow false")
    assert.equal(ensure.oneOf({ value: "spot", values: ["spot", "futures"], name: "marketType" }), "spot", "choice assertion must return a matching option")
  })

  it("throws TypeError with parameter-specific messages for invalid types and empty inputs", () => {
    assert.throws(() => ensure.string({ value: 12, name: "symbol" }), { name: "TypeError", message: /symbol must be a string/ }, "string assertion must identify the parameter and required type")
    assert.throws(() => ensure.nonEmptyString({ value: "  ", name: "symbol" }), { name: "TypeError", message: /symbol must be a non-empty string/ }, "blank strings must fail the non-empty string assertion")
    assert.throws(() => ensure.boolean({ value: 0, name: "enabled" }), { name: "TypeError", message: /enabled must be a boolean/ }, "boolean assertion must reject numeric truthy/falsy values")
    assert.throws(() => ensure.number({ value: "2", name: "price" }), { name: "TypeError", message: /price must be a finite number/ }, "number assertion must not coerce numeric strings")
    assert.throws(() => ensure.integer({ value: 1.5, name: "count" }), { name: "TypeError", message: /count must be an integer/ }, "integer assertion must reject fractional values")
    assert.throws(() => ensure.safeInteger({ value: Number.MAX_SAFE_INTEGER + 1, name: "count" }), { name: "TypeError", message: /count must be a safe integer/ }, "safe integer assertion must reject precision-unsafe values")
    assert.throws(() => ensure.function({ value: null, name: "callback" }), { name: "TypeError", message: /callback must be a function/ }, "function assertion must reject non-callable values")
    assert.throws(() => ensure.array({ value: {}, name: "symbols" }), { name: "TypeError", message: /symbols must be an array/ }, "array assertion must reject non-arrays")
    assert.throws(() => ensure.nonEmptyArray({ value: [], name: "symbols" }), { name: "TypeError", message: /symbols must be a non-empty array/ }, "non-empty array assertion must reject empty arrays")
    assert.throws(() => ensure.strings({ value: ["BTC", 2], name: "symbols" }), { name: "TypeError", message: /symbols\[1\] must be a string/ }, "string-array assertion must identify the invalid element index")
    assert.throws(() => ensure.nonEmptyStrings({ value: ["BTC", " "], name: "symbols" }), { name: "TypeError", message: /symbols\[1\] must be a non-empty string/ }, "non-empty string-array assertion must identify blank elements")
    assert.throws(() => ensure.nonEmptyStrings({ value: [], name: "symbols" }), { name: "TypeError", message: /symbols must be a non-empty array/ }, "non-empty string-array assertion must reject empty arrays")
    assert.throws(() => ensure.unique({ value: ["BTC", "BTC"], name: "symbols" }), { name: "TypeError", message: /symbols must contain unique values/ }, "unique assertion must reject duplicate values")
    assert.throws(() => ensure.object({ value: null, name: "config" }), { name: "TypeError", message: /config must be an object/ }, "object assertion must reject null")
    assert.throws(() => ensure.object({ value: [], name: "config" }), { name: "TypeError", message: /config must be an object/ }, "object assertion must reject arrays")
    assert.throws(() => ensure.plainObject({ value: new Date(), name: "config" }), { name: "TypeError", message: /config must be a plain object/ }, "plain-object assertion must reject class instances")
    assert.throws(() => ensure.defined({ value: undefined, name: "field" }), { name: "TypeError", message: /field must be defined/ }, "defined assertion must reject undefined")
    assert.throws(() => ensure.notNull({ value: null, name: "field" }), { name: "TypeError", message: /field must not be null or undefined/ }, "not-null assertion must reject null")
    assert.throws(() => ensure.oneOf({ value: "margin", values: ["spot", "futures"], name: "marketType" }), { name: "TypeError", message: /marketType must be one of the allowed values/ }, "choice assertion must reject values outside the allowed set")
  })

  it("throws RangeError for finite values outside inclusive numeric bounds", () => {
    assert.throws(() => ensure.integerInRange({ value: 249, min: 250, max: 60000, name: "intervalMs" }), { name: "RangeError", message: /intervalMs must be an integer between 250 and 60000/ }, "integer range must reject values below the lower bound")
    assert.throws(() => ensure.integerInRange({ value: 60001, min: 250, max: 60000, name: "intervalMs" }), { name: "RangeError", message: /intervalMs must be an integer between 250 and 60000/ }, "integer range must reject values above the upper bound")
    assert.throws(() => ensure.numberInRange({ value: -0.1, min: 0, max: 1, name: "ratio" }), { name: "RangeError", message: /ratio must be a number between 0 and 1/ }, "number range must reject values below the lower bound")
    assert.throws(() => ensure.positiveInteger({ value: 0, name: "attempts" }), { name: "RangeError", message: /attempts must be a positive safe integer/ }, "positive integer assertion must reject zero")
    assert.throws(() => ensure.nonNegativeInteger({ value: -1, name: "offset" }), { name: "RangeError", message: /offset must be a non-negative safe integer/ }, "non-negative integer assertion must reject negative values")
  })

  it("rejects malformed range configuration", () => {
    assert.throws(() => ensure.integerInRange({ value: 1, min: 2, max: 1, name: "count" }), { name: "TypeError", message: /min must be less than or equal to max/ }, "integer range must reject reversed bounds")
    assert.throws(() => ensure.integerInRange({ value: 1, min: 0.5, max: 2, name: "count" }), TypeError, "integer range must reject fractional bounds")
    assert.throws(() => ensure.numberInRange({ value: 1, min: NaN, max: 2, name: "ratio" }), TypeError, "number range must reject non-finite bounds")
    assert.throws(() => ensure.oneOf({ value: "x", values: [], name: "choice" }), TypeError, "choice assertion must reject an empty allowed-value list")
  })

  it("describes unexpected objects safely without invoking custom coercion", () => {
    const hostileValue = { toString() { throw new Error("must not be called") } }
    assert.throws(() => ensure.number({ value: hostileValue, name: "price" }), { name: "TypeError", message: /price must be a finite number \(received object\)/ }, "error formatting must not execute caller-controlled object coercion")
    const revokedProxy = Proxy.revocable([], {})
    revokedProxy.revoke()
    assert.throws(() => ensure.array({ value: revokedProxy.proxy, name: "items" }), TypeError, "revoked proxies must fail validation without leaking array-detection exceptions")
  })

  it("rejects malformed assertion options and field names", () => {
    assert.throws(() => ensure.string(), TypeError, "assertions must reject missing options instead of silently accepting undefined")
    assert.throws(() => ensure.string({ value: "x", name: "" }), TypeError, "field names must be non-empty strings")
    assert.throws(() => ensure.string(null), TypeError, "assertions must reject null options")
    assert.throws(() => ensure.string({ get value() { throw new Error("must not run") } }), { name: "TypeError", message: /options.value must not be an accessor/ }, "assertions must not invoke option getters")
  })
})

describe("ensure fluent pipelines", () => {
  it("validates, normalizes, and checks uniqueness without mutating the original array", () => {
    const originalSymbols = [" btcusdt ", "ethusdt"]
    const normalizedSymbols = ensure
      .chain({ value: originalSymbols, name: "symbols" })
      .array()
      .nonEmpty()
      .strings()
      .map({ transform: (symbol) => symbol.trim().toUpperCase() })
      .unique()
      .value

    assert.deepEqual(normalizedSymbols, ["BTCUSDT", "ETHUSDT"], "pipeline must apply validation and normalization in order")
    assert.deepEqual(originalSymbols, [" btcusdt ", "ethusdt"], "pipeline transformations must not mutate the caller's original array")
    assert.notEqual(normalizedSymbols, originalSymbols, "pipeline map must return a new array")
  })

  it("supports primitive validation and string transformations", () => {
    const normalizedName = ensure
      .chain({ value: "  Coinzilla  ", name: "name" })
      .string()
      .nonEmpty()
      .trim()
      .lowercase()
      .value

    assert.equal(normalizedName, "coinzilla", "string pipeline must validate and transform the value in sequence")
    assert.equal(ensure.chain({ value: 500, name: "intervalMs" }).integer().between({ min: 250, max: 60000 }).value, 500, "numeric pipeline must return a value after all constraints pass")
  })

  it("supports filtering and preserves the source array", () => {
    const values = [1, 2, 3, 4]
    const evens = ensure.chain({ value: values, name: "values" }).array().integers().filter({ predicate: (value) => value % 2 === 0 }).value
    assert.deepEqual(evens, [2, 4], "pipeline filter must intentionally retain matching values")
    assert.deepEqual(values, [1, 2, 3, 4], "pipeline filter must not mutate its source array")
  })

  it("returns a fresh chain for each operation and leaves prior chain values unchanged", () => {
    const first = ensure.chain({ value: ["btc"], name: "symbols" }).array()
    const second = first.map({ transform: (symbol) => symbol.toUpperCase() })
    assert.deepEqual(first.value, ["btc"], "a later transformation must not alter the previous chain's value")
    assert.deepEqual(second.value, ["BTC"], "transformations must produce a distinct chain with updated value")
  })

  it("rejects invalid pipeline operations with field-aware diagnostics", () => {
    assert.throws(() => ensure.chain({ value: [] }).nonEmpty(), { name: "TypeError", message: /value must be a non-empty array/ }, "non-empty pipeline assertion must reject an empty collection")
    assert.throws(() => ensure.chain({ value: ["BTC", 2], name: "symbols" }).strings(), { name: "TypeError", message: /symbols\[1\] must be a string/ }, "pipeline string validation must identify invalid collection elements")
    assert.throws(() => ensure.chain({ value: ["BTC", " "], name: "symbols" }).nonEmptyStrings(), { name: "TypeError", message: /symbols\[1\] must be a non-empty string/ }, "pipeline non-empty strings must reject blank entries")
    assert.throws(() => ensure.chain({ value: [], name: "symbols" }).nonEmptyStrings(), { name: "TypeError", message: /symbols must be a non-empty array/ }, "pipeline non-empty strings must reject empty arrays")
    assert.throws(() => ensure.chain({ value: [1.5], name: "values" }).integers(), { name: "TypeError", message: /values\[0\] must be an integer/ }, "pipeline integer validation must reject fractional elements")
    assert.throws(() => ensure.chain({ value: ["x", "x"], name: "symbols" }).unique(), { name: "TypeError", message: /symbols must contain unique values/ }, "pipeline uniqueness must reject duplicates")
    assert.throws(() => ensure.chain({ value: "x", name: "name" }).map({ transform: (value) => value }), { name: "TypeError", message: /name must be an array/ }, "map must require an array")
    assert.throws(() => ensure.chain({ value: [1], name: "values" }).map({ transform: null }), TypeError, "map must reject non-function transforms")
    assert.throws(() => ensure.chain({ value: [1], name: "values" }).filter({ predicate: 1 }), TypeError, "filter must reject non-function predicates")
    assert.throws(() => ensure.chain({ value: 1, name: "count" }).between({ min: 2, max: 0 }), TypeError, "pipeline range must reject reversed bounds")
    assert.throws(() => ensure.chain({ value: 1, name: "count" }).trim(), TypeError, "trim must reject non-string pipeline values")
    assert.throws(() => ensure.chain({ value: "x", name: "name" }).uppercase(), TypeError, "uppercase must reject non-string pipeline values")
    assert.throws(() => ensure.chain({ value: "x", name: "name" }).lowercase(), TypeError, "lowercase must reject non-string pipeline values")
  })
})
