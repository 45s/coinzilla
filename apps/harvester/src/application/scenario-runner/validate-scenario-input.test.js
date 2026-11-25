import assert from "node:assert/strict"
import test from "node:test"
import {
  isValidScenarioInputSchema,
  validateScenarioInput,
} from "./validate-scenario-input.js"

const schema = Object.freeze({
  type: "object",
  required: ["minProfit"],
  additionalProperties: false,
  properties: {
    minProfit: {
      type: "string",
      pattern: "^[0-9]+(?:[.][0-9]+)?$",
    },
    enabled: {
      type: "boolean",
    },
  },
})

test("scenario input schema accepts valid object input", () => {
  assert.deepEqual(validateScenarioInput({
    schema,
    input: {
      minProfit: "0.025",
      enabled: true,
    },
  }), {
    valid: true,
    errors: [],
  })
})

test("scenario input validation reports unknown, missing and malformed fields", () => {
  const result = validateScenarioInput({
    schema,
    input: {
      minProfit: "-0.1",
      enabled: "yes",
      unexpected: true,
    },
  })

  assert.equal(result.valid, false)
  assert.deepEqual(result.errors, [
    "Unknown input field: unexpected",
    "Input field minProfit does not match its schema pattern",
    "Input field enabled must be a boolean",
  ])
})

test("scenario input schema rejects invalid regular expressions and unsupported shapes", () => {
  assert.equal(isValidScenarioInputSchema({
    schema: {
      ...schema,
      properties: {
        value: {
          type: "string",
          pattern: "[",
        },
      },
    },
  }), false)
  assert.equal(isValidScenarioInputSchema({
    schema: {
      type: "array",
      required: [],
      additionalProperties: false,
      properties: {},
    },
  }), false)
})

test("scenario input validation rejects non-object input and invalid schema definitions", () => {
  assert.deepEqual(validateScenarioInput({
    schema,
    input: [],
  }), {
    valid: false,
    errors: ["Scenario input must be a JSON object."],
  })
  assert.deepEqual(validateScenarioInput({
    schema: null,
    input: {},
  }), {
    valid: false,
    errors: ["Scenario input schema is invalid."],
  })
})


test("scenario input validation enforces exclusive decimal lower bounds", () => {
  const positiveSchema = Object.freeze({
    ...schema,
    properties: Object.freeze({
      ...schema.properties,
      minProfit: Object.freeze({
        ...schema.properties.minProfit,
        exclusiveMinimum: "0",
      }),
    }),
  })
  assert.deepEqual(validateScenarioInput({
    schema: positiveSchema,
    input: {
      minProfit: "0.0001",
      enabled: true,
    },
  }), {
    valid: true,
    errors: [],
  })
  assert.deepEqual(validateScenarioInput({
    schema: positiveSchema,
    input: {
      minProfit: "0",
      enabled: true,
    },
  }), {
    valid: false,
    errors: ["Input field minProfit must be greater than 0"],
  })
})

test("scenario input schema rejects invalid exclusive decimal bounds", () => {
  assert.equal(isValidScenarioInputSchema({
    schema: {
      ...schema,
      properties: {
        ...schema.properties,
        minProfit: {
          ...schema.properties.minProfit,
          exclusiveMinimum: "not-a-decimal",
        },
      },
    },
  }), false)
})
