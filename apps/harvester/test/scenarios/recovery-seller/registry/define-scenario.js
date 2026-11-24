function deepFreeze(value) {
  const seen = new WeakSet()
  function freeze(current) {
    if (current === null || typeof current !== "object" || seen.has(current)) {
      return current
    }

    seen.add(current)
    for (const child of Object.values(current)) {
      freeze(child)
    }

    return Object.freeze(current)
  }

  return freeze(value)
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
