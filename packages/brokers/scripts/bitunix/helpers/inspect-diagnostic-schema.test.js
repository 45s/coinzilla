import assert from "node:assert/strict"
import test from "node:test"
import {
  getDiagnosticSchemaIssueCodes,
  inspectDiagnosticSchema,
} from "./inspect-diagnostic-schema.js"

test("schema diagnostics detect unknown fields, missing required fields, and unexpected types without values", () => {
  const inspection = inspectDiagnosticSchema({
    value: [
      {
        coin: "BTC",
        balance: "1.2300",
        balanceLocked: "0",
        futureField: "private-value",
      },
      {
        coin: "ETH",
        balance: 2,
      },
    ],
    expectedFields: ["coin", "balance", "balanceLocked"],
    requiredFields: ["coin", "balance", "balanceLocked"],
    expectedFieldTypes: {
      coin: ["string"],
      balance: ["string"],
      balanceLocked: ["string"],
    },
  })

  assert.deepEqual(inspection, {
    valueType: "array",
    itemCount: 2,
    observedFields: ["balance", "balanceLocked", "coin", "futureField"],
    unexpectedFields: ["futureField"],
    missingRequiredFields: [{
      index: 1,
      fields: ["balanceLocked"],
    }],
    unexpectedFieldTypes: [{
      index: 1,
      field: "balance",
      expected: ["string"],
      actual: "number",
    }],
    invalidRowIndexes: [],
  }, "Schema diagnostics must report structure mismatches without retaining private response values")
  assert.equal(JSON.stringify(inspection).includes("private-value"), false, "Schema diagnostics must never persist unknown field values")
  assert.equal(JSON.stringify(inspection).includes("1.2300"), false, "Schema diagnostics must never persist financial values")
})

test("schema diagnostics identify an unexpected top-level value type", () => {
  const inspection = inspectDiagnosticSchema({
    value: 123.45,
    expectedValueTypes: ["string"],
  })

  assert.deepEqual(inspection, {
    valueType: "number",
    itemCount: null,
    observedFields: [],
    unexpectedFields: [],
    missingRequiredFields: [],
    unexpectedFieldTypes: [],
    invalidRowIndexes: [],
    unexpectedValueType: {
      expected: ["string"],
      actual: "number",
    },
  }, "scalar response schema drift must be visible without retaining the scalar value")
})

test("diagnostic schema issue codes identify each observed mismatch category", () => {
  assert.deepEqual(getDiagnosticSchemaIssueCodes({
    inspection: {
      unexpectedValueType: true,
      missingRequiredFields: ["id"],
      unexpectedFieldTypes: [],
      invalidRowIndexes: [],
    },
  }), ["unexpected_value_type", "missing_required_fields"], "schema issue codes must describe only observed response-shape mismatches")
})
