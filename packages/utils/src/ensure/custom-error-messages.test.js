import assert from "node:assert/strict"
import test from "node:test"
import { ensure } from "./index.js"

const customMessage = "Domain validation failed"
const accounting = { verified: true }

const arrayAssertion = () => ensure.object({
  value: [],
  name: "accounting",
  errMsg: customMessage,
})
const rangeAssertion = () => ensure.integerInRange({
  value: 0,
  min: 1,
  max: 3,
  name: "attempts",
  errMsg: customMessage,
})
const chainAssertion = () => ensure.chain({
  value: [],
  name: "symbols",
  errMsg: customMessage,
}).nonEmpty()
const invalidBoundsAssertion = () => ensure.integerInRange({
  value: 1,
  min: 2,
  max: 1,
  errMsg: customMessage,
})
const defaultDiagnosticAssertion = () => ensure.object({
  value: [],
  name: "accounting",
})
const invalidMessageAssertion = ({ errMsg }) => ensure.object({
  value: accounting,
  errMsg,
})
const callbackError = new Error("transform callback failed")
const throwingTransform = () => {
  throw callbackError
}
const callbackAssertion = () => ensure.chain({
  value: [1],
  errMsg: customMessage,
}).map({
  transform: throwingTransform,
})

test("object assertions return identity and retain array rejection with custom diagnostics", () => {
  assert.equal(
    ensure.object({
      value: accounting,
      errMsg: customMessage,
    }),
    accounting,
    "A successful assertion must return the original object even with a custom message",
  )
  assert.throws(
    arrayAssertion,
    {
      name: "TypeError",
      message: customMessage,
    },
    "ensure.object must reject arrays using the domain message and preserve TypeError",
  )
})

test("numeric range assertions preserve RangeError with custom diagnostics", () => {
  assert.throws(
    rangeAssertion,
    {
      name: "RangeError",
      message: customMessage,
    },
    "Out-of-range values must use errMsg without changing RangeError",
  )
})

test("fluent chains propagate custom diagnostics to validation steps", () => {
  assert.throws(
    chainAssertion,
    {
      name: "TypeError",
      message: customMessage,
    },
    "A chain-level errMsg must be used for non-empty validation",
  )
})

const assertions = [
  ["string", () => ensure.string({
    value: 1,
    errMsg: customMessage,
  }), "TypeError"],
  ["nonEmptyString", () => ensure.nonEmptyString({
    value: " ",
    errMsg: customMessage,
  }), "TypeError"],
  ["boolean", () => ensure.boolean({
    value: 1,
    errMsg: customMessage,
  }), "TypeError"],
  ["number", () => ensure.number({
    value: "1",
    errMsg: customMessage,
  }), "TypeError"],
  ["integer", () => ensure.integer({
    value: 1.5,
    errMsg: customMessage,
  }), "TypeError"],
  ["safeInteger", () => ensure.safeInteger({
    value: Number.MAX_SAFE_INTEGER + 1,
    errMsg: customMessage,
  }), "TypeError"],
  ["integerInRange", rangeAssertion, "RangeError"],
  ["numberInRange", () => ensure.numberInRange({
    value: 0,
    min: 1,
    max: 2,
    errMsg: customMessage,
  }), "RangeError"],
  ["positiveInteger", () => ensure.positiveInteger({
    value: 0,
    errMsg: customMessage,
  }), "RangeError"],
  ["nonNegativeInteger", () => ensure.nonNegativeInteger({
    value: -1,
    errMsg: customMessage,
  }), "RangeError"],
  ["array", () => ensure.array({
    value: {},
    errMsg: customMessage,
  }), "TypeError"],
  ["nonEmptyArray", () => ensure.nonEmptyArray({
    value: [],
    errMsg: customMessage,
  }), "TypeError"],
  ["strings", () => ensure.strings({
    value: [1],
    errMsg: customMessage,
  }), "TypeError"],
  ["nonEmptyStrings", () => ensure.nonEmptyStrings({
    value: [""],
    errMsg: customMessage,
  }), "TypeError"],
  ["unique", () => ensure.unique({
    value: [1, 1],
    errMsg: customMessage,
  }), "TypeError"],
  ["function", () => ensure.function({
    value: null,
    errMsg: customMessage,
  }), "TypeError"],
  ["object", arrayAssertion, "TypeError"],
  ["plainObject", () => ensure.plainObject({
    value: new Date(),
    errMsg: customMessage,
  }), "TypeError"],
  ["defined", () => ensure.defined({
    value: undefined,
    errMsg: customMessage,
  }), "TypeError"],
  ["notNull", () => ensure.notNull({
    value: null,
    errMsg: customMessage,
  }), "TypeError"],
  ["oneOf", () => ensure.oneOf({
    value: "unknown",
    values: ["known"],
    errMsg: customMessage,
  }), "TypeError"],
  ]

test("every direct assertion replaces its validation diagnostic and preserves error class", () => {
  for (const [assertionName, assertion, errorName] of assertions) {
    assert.throws(
      assertion,
      {
        name: errorName,
        message: customMessage,
      },
      `The ${assertionName} assertion must use errMsg and preserve ${errorName}`,
    )
  }
})

test("invalid custom messages are rejected", () => {
  for (const errMsg of [null, "", "   ", 42, false]) {
    assert.throws(
      invalidMessageAssertion.bind(null, { errMsg }),
      {
        name: "TypeError",
        message: /errMsg must be a non-empty string/,
      },
      "Custom messages must reject null, blank, and non-string values",
    )
  }
})

test("invalid assertion configuration keeps its own diagnostic", () => {
  assert.throws(
    invalidBoundsAssertion,
    {
      name: "TypeError",
      message: "min must be less than or equal to max",
    },
    "Custom messages must not disguise malformed range configuration",
  )
})

test("chain callbacks retain their original errors", () => {
  assert.throws(
    callbackAssertion,
    (error) => error === callbackError,
    "A chain-level errMsg must not rewrite errors thrown by caller-owned transforms",
  )
})

test("omitting errMsg retains the default field-specific diagnostic", () => {
  assert.throws(
    defaultDiagnosticAssertion,
    {
      name: "TypeError",
      message: /accounting must be an object/,
    },
    "Default messages must remain unchanged when errMsg is omitted",
  )
})
