import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ensure } from "./index.js"

const namedValue = ([value, name]) => ({
  value,
  name,
})

const rangedValue = ([value, min, max, name]) => ({
  value,
  min,
  max,
  name,
})

const choiceValue = ([value, values, name]) => ({
  value,
  values,
  name,
})

const rangeOptions = ([min, max]) => ({
  min,
  max,
})

const transformOptions = (transform) => ({
  transform,
})

const predicateOptions = (predicate) => ({
  predicate,
})

const expectError = ([target, method, options, errorName, pattern, message]) => {
  assert.throws(
    () => target[method](options),
    {
      name: errorName,
      message: pattern,
    },
    message,
  )
}

const normalizeSymbol = (symbol) => symbol.trim().toUpperCase()
const lowercase = (value) => value.toLowerCase()
const uppercase = (value) => value.toUpperCase()
const isEven = (value) => value % 2 === 0

describe("ensure direct assertions", () => {
  it("returns valid primitive values without coercion", () => {
    const callback = () => {}
    assert.equal(ensure.string(namedValue(["", "label"])), "", "string assertion must accept empty strings")
    assert.equal(ensure.nonEmptyString(namedValue([" BTC ", "symbol"])), " BTC ", "non-empty string assertion must preserve whitespace")
    assert.equal(ensure.boolean(namedValue([false, "enabled"])), false, "boolean assertion must accept false")
    assert.equal(ensure.number(namedValue([0, "amount"])), 0, "finite number assertion must accept zero")
    assert.equal(ensure.integer(namedValue([-3, "count"])), -3, "integer assertion must accept signed integers")
    assert.equal(ensure.safeInteger(namedValue([Number.MAX_SAFE_INTEGER, "count"])), Number.MAX_SAFE_INTEGER, "safe integer assertion must accept the safe upper boundary")
    assert.equal(ensure.function(namedValue([callback, "callback"])), callback, "function assertion must return the original function")
  })

  it("validates inclusive numeric ranges and positive integer constraints", () => {
    assert.equal(ensure.integerInRange(rangedValue([250, 250, 60000, "intervalMs"])), 250, "integer range must include its lower boundary")
    assert.equal(ensure.integerInRange(rangedValue([60000, 250, 60000, "intervalMs"])), 60000, "integer range must include its upper boundary")
    assert.equal(ensure.numberInRange(rangedValue([1.25, 1, 2, "ratio"])), 1.25, "number range must accept decimals within inclusive bounds")
    assert.equal(ensure.positiveInteger(namedValue([1, "attempts"])), 1, "positive integer assertion must accept one")
    assert.equal(ensure.nonNegativeInteger(namedValue([0, "offset"])), 0, "non-negative integer assertion must accept zero")
  })

  it("validates arrays, strings and uniqueness without mutation", () => {
    const symbols = ["BTC", "ETH"]
    assert.equal(ensure.array(namedValue([symbols, "symbols"])), symbols, "array assertion must preserve identity")
    assert.equal(ensure.nonEmptyArray(namedValue([symbols, "symbols"])), symbols, "non-empty array assertion must preserve identity")
    assert.equal(ensure.strings(namedValue([symbols, "symbols"])), symbols, "string-array assertion must preserve identity")
    assert.equal(ensure.nonEmptyStrings(namedValue([symbols, "symbols"])), symbols, "non-empty string-array assertion must preserve identity")
    assert.equal(ensure.unique(namedValue([symbols, "symbols"])), symbols, "unique assertion must preserve identity")
    assert.deepEqual(symbols, ["BTC", "ETH"], "array assertions must not mutate caller-owned arrays")
  })

  it("validates object shapes, nullability and allowed choices", () => {
    const record = Object.create(null)
    record.value = 1
    assert.equal(ensure.object(namedValue([record, "record"])), record, "object assertion must accept null-prototype objects")
    assert.equal(ensure.plainObject(namedValue([record, "record"])), record, "plain-object assertion must accept null-prototype records")
    assert.equal(ensure.defined(namedValue([null, "nullable"])), null, "defined assertion must allow null")
    assert.equal(ensure.notNull(namedValue([false, "enabled"])), false, "not-null assertion must allow false")
    assert.equal(ensure.oneOf(choiceValue(["spot", ["spot", "futures"], "marketType"])), "spot", "choice assertion must return a matching option")
  })
})

describe("ensure error semantics", () => {
  it("rejects invalid primitive types and empty strings", () => {
    expectError([ensure, "string", namedValue([12, "symbol"]), "TypeError", /symbol must be a string/, "string assertion must identify its field and type"])
    expectError([ensure, "nonEmptyString", namedValue(["  ", "symbol"]), "TypeError", /symbol must be a non-empty string/, "non-empty string assertion must reject whitespace"])
    expectError([ensure, "boolean", namedValue([0, "enabled"]), "TypeError", /enabled must be a boolean/, "boolean assertion must reject numeric values"])
    expectError([ensure, "number", namedValue(["2", "price"]), "TypeError", /price must be a finite number/, "number assertion must not coerce strings"])
    expectError([ensure, "integer", namedValue([1.5, "count"]), "TypeError", /count must be an integer/, "integer assertion must reject fractional values"])
    expectError([ensure, "safeInteger", namedValue([Number.MAX_SAFE_INTEGER + 1, "count"]), "TypeError", /count must be a safe integer/, "safe integer assertion must reject precision-unsafe values"])
    expectError([ensure, "function", namedValue([null, "callback"]), "TypeError", /callback must be a function/, "function assertion must reject non-callable values"])
  })

  it("rejects invalid collection shapes and indexed values", () => {
    expectError([ensure, "array", namedValue([{}, "symbols"]), "TypeError", /symbols must be an array/, "array assertion must reject non-arrays"])
    expectError([ensure, "nonEmptyArray", namedValue([[], "symbols"]), "TypeError", /symbols must be a non-empty array/, "non-empty array assertion must reject empty arrays"])
    expectError([ensure, "strings", namedValue([["BTC", 2], "symbols"]), "TypeError", /symbols\[1\] must be a string/, "string-array assertion must identify invalid indices"])
    expectError([ensure, "nonEmptyStrings", namedValue([["BTC", " "], "symbols"]), "TypeError", /symbols\[1\] must be a non-empty string/, "non-empty string-array assertion must reject blank elements"])
    expectError([ensure, "nonEmptyStrings", namedValue([[], "symbols"]), "TypeError", /symbols must be a non-empty array/, "non-empty string-array assertion must reject empty arrays"])
    expectError([ensure, "unique", namedValue([["BTC", "BTC"], "symbols"]), "TypeError", /symbols must contain unique values/, "unique assertion must reject duplicates"])
  })

  it("rejects invalid object shapes, null and disallowed choices", () => {
    expectError([ensure, "object", namedValue([null, "config"]), "TypeError", /config must be an object/, "object assertion must reject null"])
    expectError([ensure, "object", namedValue([[], "config"]), "TypeError", /config must be an object/, "object assertion must reject arrays"])
    expectError([ensure, "plainObject", namedValue([new Date(), "config"]), "TypeError", /config must be a plain object/, "plain-object assertion must reject class instances"])
    expectError([ensure, "defined", namedValue([undefined, "field"]), "TypeError", /field must be defined/, "defined assertion must reject undefined"])
    expectError([ensure, "notNull", namedValue([null, "field"]), "TypeError", /field must not be null or undefined/, "not-null assertion must reject null"])
    expectError([ensure, "oneOf", choiceValue(["margin", ["spot", "futures"], "marketType"]), "TypeError", /marketType must be one of the allowed values/, "choice assertion must reject unknown options"])
  })

  it("uses RangeError for values outside inclusive numeric bounds", () => {
    expectError([ensure, "integerInRange", rangedValue([249, 250, 60000, "intervalMs"]), "RangeError", /intervalMs must be an integer between 250 and 60000/, "integer range must reject values below the minimum"])
    expectError([ensure, "integerInRange", rangedValue([60001, 250, 60000, "intervalMs"]), "RangeError", /intervalMs must be an integer between 250 and 60000/, "integer range must reject values above the maximum"])
    expectError([ensure, "numberInRange", rangedValue([-0.1, 0, 1, "ratio"]), "RangeError", /ratio must be a number between 0 and 1/, "number range must reject values below the minimum"])
    expectError([ensure, "positiveInteger", namedValue([0, "attempts"]), "RangeError", /attempts must be a positive safe integer/, "positive integer assertion must reject zero"])
    expectError([ensure, "nonNegativeInteger", namedValue([-1, "offset"]), "RangeError", /offset must be a non-negative safe integer/, "non-negative integer assertion must reject negative values"])
  })

  it("rejects malformed bounds and assertion options", () => {
    expectError([ensure, "integerInRange", rangedValue([1, 2, 1, "count"]), "TypeError", /min must be less than or equal to max/, "integer range must reject reversed bounds"])
    expectError([ensure, "integerInRange", rangedValue([1, 0.5, 2, "count"]), "TypeError", /min must be a safe integer/, "integer range must reject fractional bounds"])
    expectError([ensure, "numberInRange", rangedValue([1, NaN, 2, "ratio"]), "TypeError", /min must be a finite number/, "number range must reject non-finite bounds"])
    expectError([ensure, "oneOf", choiceValue(["x", [], "choice"]), "TypeError", /values must be a non-empty array/, "choice assertion must reject an empty allowed-value list"])
    expectError([ensure, "string", null, "TypeError", /options must be an object/, "assertions must reject null options"])
    expectError([ensure, "string", undefined, "TypeError", /options must be an object/, "assertions must reject missing options"])
    expectError([ensure, "string", namedValue(["x", ""]), "TypeError", /name must be a non-empty string/, "field labels must not be empty"])
    expectError([ensure, "string", { get value() { throw new Error("must not run") } }, "TypeError", /options.value must not be an accessor/, "assertions must not invoke option getters"])
  })

  it("formats hostile values safely and rejects revoked proxies", () => {
    const hostileValue = { toString() { throw new Error("must not be called") } }
    expectError([ensure, "number", namedValue([hostileValue, "price"]), "TypeError", /price must be a finite number \(received object\)/, "error formatting must not invoke caller-controlled coercion"])
    const revokedProxy = Proxy.revocable([], {})
    revokedProxy.revoke()
    expectError([ensure, "array", namedValue([revokedProxy.proxy, "items"]), "TypeError", /items must be an array/, "revoked proxies must fail validation safely"])
  })
})

describe("ensure fluent pipelines", () => {
  it("normalizes symbol arrays without mutating the source", () => {
    const source = [" btcusdt ", "ethusdt"]
    const result = ensure
      .chain(namedValue([source, "symbols"]))
      .array()
      .nonEmpty()
      .nonEmptyStrings()
      .map(transformOptions(normalizeSymbol))
      .unique()
      .value
    assert.deepEqual(result, ["BTCUSDT", "ETHUSDT"], "pipeline must validate and normalize in order")
    assert.deepEqual(source, [" btcusdt ", "ethusdt"], "pipeline transforms must not mutate source values")
    assert.notEqual(result, source, "map must return a new array")
  })

  it("supports primitive and string transformations", () => {
    const result = ensure
      .chain(namedValue(["  Coinzilla  ", "name"]))
      .string()
      .nonEmpty()
      .trim()
      .lowercase()
      .value
    assert.equal(result, "coinzilla", "string pipeline must apply validation and transformations in order")
    assert.equal(ensure.chain(namedValue([500, "intervalMs"])).integer().between(rangeOptions([250, 60000])).value, 500, "numeric pipeline must return its validated value")
    assert.equal(ensure.chain(namedValue(["Coinzilla", "name"])).uppercase().value, "COINZILLA", "uppercase must transform a valid string")
    assert.equal(ensure.chain(namedValue(["COINZILLA", "name"])).lowercase().value, "coinzilla", "lowercase must transform a valid string")
  })

  it("filters intentionally while preserving the original collection", () => {
    const source = [1, 2, 3, 4]
    const result = ensure
      .chain(namedValue([source, "values"]))
      .array()
      .integers()
      .filter(predicateOptions(isEven))
      .value
    assert.deepEqual(result, [2, 4], "filter must retain only explicitly selected items")
    assert.deepEqual(source, [1, 2, 3, 4], "filter must not mutate the source array")
  })

  it("returns independent chain objects", () => {
    const first = ensure.chain(namedValue([["btc"], "symbols"])).array()
    const second = first.map(transformOptions(uppercase))
    assert.deepEqual(first.value, ["btc"], "subsequent transforms must not change prior chain values")
    assert.deepEqual(second.value, ["BTC"], "transformations must return a distinct chain")
  })

  it("rejects invalid pipeline operations with useful errors", () => {
    const emptyArray = ensure.chain(namedValue([[], "values"]))
    const invalidSymbols = ensure.chain(namedValue([["BTC", 2], "symbols"]))
    const blankSymbols = ensure.chain(namedValue([["BTC", " "], "symbols"]))
    const duplicateSymbols = ensure.chain(namedValue([["x", "x"], "symbols"]))
    const stringChain = ensure.chain(namedValue(["x", "name"]))
    const numberChain = ensure.chain(namedValue([1, "count"]))
    const arrayChain = ensure.chain(namedValue([[1], "values"]))
    expectError([emptyArray, "nonEmpty", undefined, "TypeError", /values must be a non-empty array/, "non-empty pipeline must reject empty arrays"])
    expectError([invalidSymbols, "strings", undefined, "TypeError", /symbols\[1\] must be a string/, "pipeline string validation must identify invalid elements"])
    expectError([blankSymbols, "nonEmptyStrings", undefined, "TypeError", /symbols\[1\] must be a non-empty string/, "pipeline non-empty strings must reject blanks"])
    expectError([emptyArray, "nonEmptyStrings", undefined, "TypeError", /values must be a non-empty array/, "pipeline non-empty strings must reject empty arrays"])
    expectError([arrayChain, "integers", undefined, "TypeError", /values\[0\] must be an integer/, "pipeline integer validation must reject fractional elements"])
    expectError([duplicateSymbols, "unique", undefined, "TypeError", /symbols must contain unique values/, "pipeline uniqueness must reject duplicates"])
    expectError([stringChain, "map", transformOptions(normalizeSymbol), "TypeError", /name must be an array/, "map must require an array"])
    expectError([arrayChain, "map", transformOptions(null), "TypeError", /transform must be a function/, "map must reject non-function transforms"])
    expectError([arrayChain, "filter", predicateOptions(1), "TypeError", /predicate must be a function/, "filter must reject non-function predicates"])
    expectError([numberChain, "between", rangeOptions([2, 0]), "TypeError", /min must be less than or equal to max/, "pipeline range must reject reversed bounds"])
    expectError([numberChain, "trim", undefined, "TypeError", /count must be a string/, "trim must reject non-string values"])
    expectError([numberChain, "uppercase", undefined, "TypeError", /count must be a string/, "uppercase must reject non-string values"])
    expectError([numberChain, "lowercase", undefined, "TypeError", /count must be a string/, "lowercase must reject non-string values"])
  })
})
