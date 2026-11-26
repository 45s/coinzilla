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
 * Define one immutable Conservative scenario record.
 *
 * The record remains declarative. Cross-reference and evidence checks belong
 * to validateConservativeScenarioRegistry().
 *
 * @param {object} record Conservative scenario definition.
 * @returns {object} Deeply immutable scenario definition.
 */
export function defineConservativeScenario(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Conservative scenario record must be an object")
  }

  return deepFreeze(record)
}
