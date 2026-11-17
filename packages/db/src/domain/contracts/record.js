const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function assertPlainRecord({ value, label }) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`)
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }

  return value
}

function assertJsonValue({ value, ancestors, label }) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return
  }

  if (typeof value !== "object") {
    throw new TypeError(`${label} must contain only JSON-safe values`)
  }

  if (ancestors.has(value)) {
    throw new TypeError(`${label} must not contain circular references`)
  }

  ancestors.add(value)

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError(`${label} must not contain sparse arrays`)
      }
      assertJsonValue({
        value: value[index],
        ancestors,
        label,
      })
    }
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must contain only plain objects`)
    }

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new TypeError(`${label} must not contain symbol keys`)
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`${label} must contain enumerable data properties only`)
      }

      assertJsonValue({
        value: descriptor.value,
        ancestors,
        label,
      })
    }
  }

  ancestors.delete(value)
}

export function validateCollectionName(collection) {
  if (typeof collection !== "string" || collection.trim() === "" || collection !== collection.trim()) {
    throw new TypeError("Collection name must be a non-empty string without surrounding whitespace")
  }

  return collection
}

export function validateRecordIdentifier(identifier) {
  if (typeof identifier !== "string" || identifier.trim() === "" || identifier !== identifier.trim()) {
    throw new TypeError("Record identifier must be a non-empty string without surrounding whitespace")
  }

  return identifier
}

export function serializeRecord(record) {
  assertPlainRecord({
    value: record,
    label: "Record",
  })
  assertJsonValue({
    value: record,
    ancestors: new Set(),
    label: "Record",
  })

  if (!Object.hasOwn(record, "id")) {
    throw new TypeError("Record must contain its own string id property")
  }

  validateRecordIdentifier(record.id)

  return JSON.stringify(record)
}

export function serializeChanges(changes) {
  assertPlainRecord({
    value: changes,
    label: "Record changes",
  })
  assertJsonValue({
    value: changes,
    ancestors: new Set(),
    label: "Record changes",
  })

  if (Object.hasOwn(changes, "id")) {
    throw new TypeError("Record changes cannot modify the record identifier")
  }

  return JSON.stringify(changes)
}

function validateFilter(filter) {
  assertPlainRecord({
    value: filter,
    label: "Query filter",
  })

  for (const [field, value] of Object.entries(filter)) {
    if (!FIELD_NAME_PATTERN.test(field)) {
      throw new TypeError(`Filter field "${field}" is not a supported field name`)
    }

    const isScalar = value === null
      || typeof value === "string"
      || typeof value === "boolean"
      || (typeof value === "number" && Number.isFinite(value))

    if (!isScalar) {
      throw new TypeError(`Filter value for "${field}" must be a JSON scalar`)
    }
  }

  return filter
}

function validateSort(sort) {
  if (!Array.isArray(sort)) {
    throw new TypeError("Query sort must be an array")
  }

  const fields = new Set()

  return sort.map((entry) => {
    assertPlainRecord({
      value: entry,
      label: "Sort entry",
    })

    const { field, direction } = entry
    if (typeof field !== "string" || !FIELD_NAME_PATTERN.test(field)) {
      throw new TypeError("Sort field must be a supported field name")
    }
    if (direction !== "asc" && direction !== "desc") {
      throw new TypeError("Sort direction must be asc or desc")
    }
    if (fields.has(field)) {
      throw new TypeError(`Sort field "${field}" must not be repeated`)
    }

    fields.add(field)
    return Object.freeze({
      field,
      direction,
    })
  })
}

export function normalizeReadQuery(query = {}) {
  assertPlainRecord({
    value: query,
    label: "Read query",
  })

  const supportedKeys = new Set(["filter", "sort", "limit", "offset"])
  for (const key of Object.keys(query)) {
    if (!supportedKeys.has(key)) {
      throw new TypeError(`Read query contains unsupported option "${key}"`)
    }
  }

  const filter = validateFilter(query.filter ?? {})
  const sort = validateSort(query.sort ?? [])
  const limit = query.limit
  const offset = query.offset ?? 0

  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new TypeError("Query limit must be a positive safe integer")
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError("Query offset must be a non-negative safe integer")
  }

  return {
    filter,
    sort,
    limit,
    offset,
  }
}
