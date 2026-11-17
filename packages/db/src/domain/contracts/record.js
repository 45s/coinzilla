const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function readOwnDescriptors({ value, label }) {
  try {
    return {
      prototype: Object.getPrototypeOf(value),
      descriptors: Object.getOwnPropertyDescriptors(value),
    }
  } catch (error) {
    throw new TypeError(`${label} must be a readable plain object`, {
      cause: error,
    })
  }
}

function cloneJsonArray({ value, ancestors, label }) {
  const { prototype, descriptors } = readOwnDescriptors({
    value,
    label,
  })
  if (prototype !== Array.prototype) {
    throw new TypeError(`${label} must contain plain arrays`)
  }

  const length = descriptors.length.value
  const clone = new Array(length)

  for (const key of Reflect.ownKeys(descriptors)) {
    if (key === "length") {
      continue
    }
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)) {
      throw new TypeError(`${label} arrays must not contain custom properties`)
    }

    const descriptor = descriptors[key]
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label} arrays must contain data elements only`)
    }
    clone[Number(key)] = cloneJsonValue({
      value: descriptor.value,
      ancestors,
      label,
    })
  }

  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(descriptors, String(index))) {
      throw new TypeError(`${label} must not contain sparse arrays`)
    }
  }

  return clone
}

function cloneJsonObject({ value, ancestors, label }) {
  const { prototype, descriptors } = readOwnDescriptors({
    value,
    label,
  })
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must contain only plain objects`)
  }

  const clone = {}
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} must not contain symbol keys`)
    }

    const descriptor = descriptors[key]
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label} must contain enumerable data properties only`)
    }

    Object.defineProperty(clone, key, {
      value: cloneJsonValue({
        value: descriptor.value,
        ancestors,
        label,
      }),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }

  return clone
}

function cloneJsonValue({ value, ancestors, label }) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value !== "object") {
    throw new TypeError(`${label} must contain only JSON-safe values`)
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${label} must not contain circular references`)
  }

  ancestors.add(value)
  const clone = Array.isArray(value)
    ? cloneJsonArray({
      value,
      ancestors,
      label,
    })
    : cloneJsonObject({
      value,
      ancestors,
      label,
    })
  ancestors.delete(value)
  return clone
}

function assertPlainRecord({ value, label }) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`)
  }

  return cloneJsonObject({
    value,
    ancestors: new Set([value]),
    label,
  })
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
  const snapshot = assertPlainRecord({
    value: record,
    label: "Record",
  })

  if (!Object.hasOwn(snapshot, "id")) {
    throw new TypeError("Record must contain its own string id property")
  }

  validateRecordIdentifier(snapshot.id)

  return JSON.stringify(snapshot)
}

export function serializeChanges(changes) {
  const snapshot = assertPlainRecord({
    value: changes,
    label: "Record changes",
  })

  if (Object.hasOwn(snapshot, "id")) {
    throw new TypeError("Record changes cannot modify the record identifier")
  }

  return JSON.stringify(snapshot)
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
  const snapshot = assertPlainRecord({
    value: query,
    label: "Read query",
  })

  const supportedKeys = new Set(["filter", "sort", "limit", "offset"])
  for (const key of Object.keys(snapshot)) {
    if (!supportedKeys.has(key)) {
      throw new TypeError(`Read query contains unsupported option "${key}"`)
    }
  }

  const {
    filter: rawFilter = {},
    sort: rawSort = [],
    limit,
    offset = 0,
  } = snapshot
  const filter = validateFilter(rawFilter)
  const sort = validateSort(rawSort)

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
