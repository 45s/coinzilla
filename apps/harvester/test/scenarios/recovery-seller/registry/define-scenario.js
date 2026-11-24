function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value
  }

  seen.add(value)
  for (const child of Object.values(value)) {
    deepFreeze(child, seen)
  }

  return Object.freeze(value)
}

/**
 * Freeze one declarative RS scenario record.
 *
 * This helper validates only the record container. Cross-reference and
 * completeness checks belong to validateRecoverySellerScenarioRegistry().
 *
 * @param {object} record Declarative scenario record.
 * @returns {object} Deeply frozen scenario record.
 */
export function defineRecoverySellerScenario(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Recovery Seller scenario record must be an object")
  }

  return deepFreeze(record)
}
