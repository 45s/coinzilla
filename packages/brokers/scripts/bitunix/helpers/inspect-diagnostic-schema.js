function getDiagnosticValueType({ value }) {
  if (value === null) {
    return "null"
  }
  if (Array.isArray(value)) {
    return "array"
  }
  return typeof value
}

function getDiagnosticRows({ value }) {
  if (Array.isArray(value)) {
    return value
  }
  if (value !== null && typeof value === "object") {
    return [value]
  }
  return []
}

function normalizeExpectedTypes({ expected }) {
  return Array.isArray(expected) ? expected : [expected]
}

function getMissingRequiredFields({ row, requiredFields }) {
  return requiredFields.filter((field) => !Object.hasOwn(row, field)).sort()
}

function getUnexpectedFieldTypes({ row, index, expectedFieldTypes }) {
  const mismatches = []
  for (const [field, expected] of Object.entries(expectedFieldTypes)) {
    if (!Object.hasOwn(row, field)) {
      continue
    }
    const expectedTypes = normalizeExpectedTypes({ expected }).slice().sort()
    const actual = getDiagnosticValueType({ value: row[field] })
    if (!expectedTypes.includes(actual)) {
      mismatches.push({
        index,
        field,
        expected: expectedTypes,
        actual,
      })
    }
  }
  return mismatches
}

function inspectDiagnosticRow({
  row,
  index,
  requiredFields,
  expectedFieldTypes,
}) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return {
      fields: [],
      missingRequiredFields: [],
      unexpectedFieldTypes: [],
      invalidRowIndexes: [index],
    }
  }

  const missingFields = getMissingRequiredFields({
    row,
    requiredFields,
  })
  const missingRequiredFields = []
  if (missingFields.length > 0) {
    missingRequiredFields.push({
      index,
      fields: missingFields,
    })
  }
  return {
    fields: Object.keys(row),
    missingRequiredFields,
    unexpectedFieldTypes: getUnexpectedFieldTypes({
      row,
      index,
      expectedFieldTypes,
    }),
    invalidRowIndexes: [],
  }
}

/**
 * Inspect only response shape and field types. Never return field values.
 *
 * @param {{
 *   value: unknown,
 *   expectedFields?: string[],
 *   requiredFields?: string[],
 *   expectedFieldTypes?: Record<string, string|string[]>,
 *   expectedValueTypes?: string[],
 * }} input
 * @returns {{
 *   valueType: string,
 *   itemCount: number|null,
 *   observedFields: string[],
 *   unexpectedFields: string[],
 *   missingRequiredFields: Array<{index: number, fields: string[]}>,
 *   unexpectedFieldTypes: Array<{index: number, field: string, expected: string[], actual: string}>,
 *   invalidRowIndexes: number[],
 * }}
 */
export function inspectDiagnosticSchema({
  value,
  expectedFields = [],
  requiredFields = [],
  expectedFieldTypes = {},
  expectedValueTypes = [],
} = {}) {
  const rows = getDiagnosticRows({ value })
  const observedFields = new Set()
  const missingRequiredFields = []
  const unexpectedFieldTypes = []
  const invalidRowIndexes = []

  for (const [index, row] of rows.entries()) {
    const inspected = inspectDiagnosticRow({
      row,
      index,
      requiredFields,
      expectedFieldTypes,
    })
    for (const field of inspected.fields) {
      observedFields.add(field)
    }
    missingRequiredFields.push(...inspected.missingRequiredFields)
    unexpectedFieldTypes.push(...inspected.unexpectedFieldTypes)
    invalidRowIndexes.push(...inspected.invalidRowIndexes)
  }

  const sortedObservedFields = [...observedFields].sort()
  const allowedFields = new Set(expectedFields)
  const unexpectedFields = sortedObservedFields.filter((field) => !allowedFields.has(field))

  const inspection = {
    valueType: getDiagnosticValueType({ value }),
    itemCount: Array.isArray(value) ? value.length : null,
    observedFields: sortedObservedFields,
    unexpectedFields,
    missingRequiredFields,
    unexpectedFieldTypes,
    invalidRowIndexes,
  }
  if (expectedValueTypes.length > 0) {
    const expected = expectedValueTypes.slice().sort()
    if (!expected.includes(inspection.valueType)) {
      inspection.unexpectedValueType = {
        expected,
        actual: inspection.valueType,
      }
    }
  }
  return inspection
}

export function getDiagnosticSchemaIssueCodes({ inspection }) {
  const issues = []
  if (inspection.unexpectedValueType) {
    issues.push("unexpected_value_type")
  }
  if (inspection.missingRequiredFields.length > 0) {
    issues.push("missing_required_fields")
  }
  if (inspection.unexpectedFieldTypes.length > 0) {
    issues.push("unexpected_field_types")
  }
  if (inspection.invalidRowIndexes.length > 0) {
    issues.push("invalid_rows")
  }
  return issues
}
